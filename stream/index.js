const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();

// Import Stripe billing sync helpers
const {
  syncBillingFromSubscription,
  findBillingProfileByStripeCustomer,
  handleSubscriptionDeleted,
  handlePaymentFailed,
  clearPaymentFailure
} = require('./helpers/syncBillingFromStripe');

const app = express();
const port = process.env.STREAM_PORT || 4003;

// Initialize Stripe
let stripe = null;
const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.PAYMENTS_SECRET_KEY;
if (stripeKey && stripeKey !== 'sk_test' && stripeKey.startsWith('sk_')) {
  stripe = require('stripe')(stripeKey);
  console.log('✓ Stripe initialized');
}
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// MongoDB connection string
const mongoUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;

// Connection pool settings to prevent connection explosion
const CONNECTION_POOL_OPTIONS = {
  maxPoolSize: 5,         // Limit connections (webhook service is lightweight)
  minPoolSize: 1,         // Keep minimum connections open
  maxIdleTimeMS: 60000,   // Close idle connections after 60 seconds
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 30000,
};

// Internal Stripe webhook endpoint - for billing profile sync
// Needs raw body for signature verification, must be registered BEFORE express.json() middleware
app.post('/webhooks/internal/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['stripe-signature'];

  let event;
  try {
    const rawBody = req.body;

    // Verify webhook signature if secret is configured
    if (WEBHOOK_SECRET && signature && stripe) {
      event = stripe.webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);
    } else {
      // For development without webhook secret
      event = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString());
    }
  } catch (err) {
    console.error('❌ Stripe webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  console.log(`📨 Stripe webhook received: ${event.type}`);

  try {
    // Use the default mongoose connection's db
    const db = mongoose.connection.db;

    let result;

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        const billingProfile = await findBillingProfileByStripeCustomer(db, customerId);
        if (!billingProfile) {
          console.warn(`⚠️  No billing profile found for Stripe customer: ${customerId}`);
          result = { success: false, reason: 'No billing profile found for customer' };
          break;
        }

        if (!stripe) {
          console.error('❌ Stripe not initialized, cannot sync subscription');
          result = { success: false, reason: 'Stripe not initialized' };
          break;
        }

        const updatedProfile = await syncBillingFromSubscription(db, billingProfile._id, subscription, stripe);
        result = {
          success: true,
          billingProfileId: billingProfile._id,
          plan: updatedProfile?.currentPlan,
          status: updatedProfile?.planStatus
        };
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        const billingProfile = await findBillingProfileByStripeCustomer(db, customerId);
        if (!billingProfile) {
          console.warn(`⚠️  No billing profile found for Stripe customer: ${customerId}`);
          result = { success: false, reason: 'No billing profile found for customer' };
          break;
        }

        await handleSubscriptionDeleted(db, billingProfile._id);
        result = {
          success: true,
          billingProfileId: billingProfile._id,
          action: 'reset_to_free'
        };
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer;

        const billingProfile = await findBillingProfileByStripeCustomer(db, customerId);
        if (!billingProfile) {
          console.warn(`⚠️  No billing profile found for Stripe customer: ${customerId}`);
          result = { success: false, reason: 'No billing profile found for customer' };
          break;
        }

        await handlePaymentFailed(db, billingProfile._id);
        result = {
          success: true,
          billingProfileId: billingProfile._id,
          action: 'grace_period_set'
        };
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;

        // Only handle subscription invoices
        if (!invoice.subscription) {
          result = { success: true, skipped: true, reason: 'Not a subscription invoice' };
          break;
        }

        const customerId = invoice.customer;
        const billingProfile = await findBillingProfileByStripeCustomer(db, customerId);
        if (!billingProfile) {
          console.warn(`⚠️  No billing profile found for Stripe customer: ${customerId}`);
          result = { success: false, reason: 'No billing profile found for customer' };
          break;
        }

        // Clear payment failure if exists
        if (billingProfile.paymentFailedAt) {
          await clearPaymentFailure(db, billingProfile._id);
        }
        result = {
          success: true,
          billingProfileId: billingProfile._id,
          action: 'payment_failure_cleared'
        };
        break;
      }

      default:
        console.log(`⚠️  Unhandled Stripe event type: ${event.type}`);
        result = { success: true, skipped: true, reason: 'Unhandled event type' };
    }

    console.log(`✅ Stripe webhook result:`, result);
    return res.json({ received: true, result });

  } catch (err) {
    console.error(`❌ Error handling Stripe webhook ${event.type}:`, err);
    return res.status(500).json({ error: err.message });
  }
});

// Middleware to parse JSON (for most endpoints)
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'airank-stream' });
});

// Batch processing webhook - handles GCS Pub/Sub notifications
// This endpoint is lightweight and only creates notification documents
// The listener service will watch for these and trigger batcher jobs
app.post('/webhooks/batch', async (req, res) => {
  try {
    const pubsubMessage = req.body;

    console.log(`📨 Batch webhook received`);

    // Verify Pub/Sub message format
    if (!pubsubMessage || !pubsubMessage.message) {
      console.error('Invalid Pub/Sub message format');
      return res.status(400).send('Invalid message format');
    }

    // Decode the Pub/Sub message data
    const messageData = JSON.parse(Buffer.from(pubsubMessage.message.data, 'base64').toString());

    console.log('📦 GCS notification:', messageData);

    // Extract file information from GCS notification
    const { name: fileName, bucket } = messageData;

    if (!fileName || !bucket) {
      console.error('Missing file name or bucket in notification');
      return res.status(400).send('Invalid notification data');
    }

    // Only process output files (not input files)
    if (!fileName.includes('/output/')) {
      console.log('⚠️  Skipping non-output file:', fileName);
      return res.status(200).send('OK');
    }

    // Extract workspaceId from GCS path: batches/output/{workspaceId}/{timestamp}/file.jsonl
    const pathParts = fileName.split('/');
    const outputIndex = pathParts.indexOf('output');
    if (outputIndex === -1 || outputIndex + 1 >= pathParts.length) {
      console.error('Could not extract workspaceId from path:', fileName);
      return res.status(400).send('Invalid file path structure');
    }
    const workspaceId = pathParts[outputIndex + 1];

    console.log(`📍 Extracted workspace ID: ${workspaceId}`);

    // Connect to workspace-specific database using mongoose
    const workspaceUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
    const workspaceDb = mongoose.createConnection(workspaceUri, CONNECTION_POOL_OPTIONS);
    await workspaceDb.asPromise();

    try {
      // Create notification document for the listener to pick up
      // This keeps the stream service lightweight and fast
      const gcsUri = `gs://${bucket}/${fileName}`;
      const notification = {
        provider: 'vertex', // GCS notifications are for Vertex AI batches
        gcsUri,
        bucket,
        fileName,
        workspaceId,
        receivedAt: new Date(),
        processed: false
      };

      await workspaceDb.collection('batchnotifications').insertOne(notification);
      console.log(`✅ Created batch notification document for ${workspaceId}`);
    } finally {
      await workspaceDb.close();
    }

    // Return 200 immediately - processing happens asynchronously
    res.status(200).send('OK');

  } catch (error) {
    console.error('💥 Batch webhook error:', error);
    res.status(500).send('Internal Server Error');
  }
});

// OpenAI batch completion webhook (for future OpenAI webhook support)
// Creates a notification document that the listener will pick up
app.post('/webhooks/openai-batch', async (req, res) => {
  try {
    const batchEvent = req.body;

    console.log(`📨 OpenAI batch webhook received`);

    // Verify OpenAI webhook signature if configured
    // const signature = req.headers['openai-signature'];
    // TODO: Verify signature when OpenAI provides webhook signing

    // Extract batch information
    const { id: batchId, status, metadata } = batchEvent;

    if (!batchId || !metadata?.workspace_id) {
      console.error('Missing batchId or workspace_id in webhook');
      return res.status(400).send('Invalid webhook data');
    }

    const workspaceId = metadata.workspace_id;
    console.log(`📍 Batch ${batchId} for workspace ${workspaceId}: ${status}`);

    // Only process completed batches
    if (status !== 'completed') {
      console.log(`⚠️  Batch not completed yet (${status}), skipping`);
      return res.status(200).send('OK');
    }

    // Connect to workspace-specific database using mongoose
    const workspaceUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
    const workspaceDb = mongoose.createConnection(workspaceUri, CONNECTION_POOL_OPTIONS);
    await workspaceDb.asPromise();

    try {
      // Create notification document for the listener to pick up
      const notification = {
        provider: 'openai',
        batchId,
        status,
        outputFileId: batchEvent.output_file_id,
        errorFileId: batchEvent.error_file_id,
        workspaceId,
        receivedAt: new Date(),
        processed: false
      };

      await workspaceDb.collection('batchnotifications').insertOne(notification);
      console.log(`✅ Created OpenAI batch notification for ${workspaceId}`);
    } finally {
      await workspaceDb.close();
    }

    // Return 200 immediately - processing happens asynchronously
    res.status(200).send('OK');

  } catch (error) {
    console.error('💥 OpenAI batch webhook error:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Graceful shutdown
async function shutdown(signal) {
  console.log(`\n📡 Received ${signal}, shutting down gracefully...`);
  await mongoose.disconnect();
  console.log('✓ MongoDB connection closed');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Connect to MongoDB and start server
mongoose.connect(mongoUri, CONNECTION_POOL_OPTIONS)
  .then(() => {
    console.log(`✓ MongoDB connected (maxPoolSize=${CONNECTION_POOL_OPTIONS.maxPoolSize})`);

    app.listen(port, '0.0.0.0', () => {
      console.log(`🌊 AIRank Stream Service listening on port ${port}`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

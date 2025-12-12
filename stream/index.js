const express = require('express');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.STREAM_PORT || 4003;

// MongoDB connection string
const mongoUri = `${process.env.MONGODB_URI}`;

// Connection pool settings to prevent connection explosion
// Default maxPoolSize=100 can cause hundreds of connections per service
const CONNECTION_POOL_OPTIONS = {
  maxPoolSize: 5,         // Limit connections (webhook service is lightweight)
  minPoolSize: 1,         // Keep minimum connections open
  maxIdleTimeMS: 60000,   // Close idle connections after 60 seconds
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 30000,
};

// Shared MongoDB client (reuse across requests instead of creating per-request)
let mongoClient = null;

async function getMongoClient() {
  if (!mongoClient) {
    const fullUri = `${mongoUri}?${process.env.MONGODB_PARAMS}`;
    mongoClient = new MongoClient(fullUri, CONNECTION_POOL_OPTIONS);
    await mongoClient.connect();
    console.log(`✓ MongoDB connected (maxPoolSize=${CONNECTION_POOL_OPTIONS.maxPoolSize})`);
  }
  return mongoClient;
}

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

    // Get shared MongoDB client (reuses connection pool)
    const client = await getMongoClient();
    const workspaceDb = client.db(`workspace_${workspaceId}`);

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

    // Get shared MongoDB client (reuses connection pool)
    const client = await getMongoClient();
    const workspaceDb = client.db(`workspace_${workspaceId}`);

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
  if (mongoClient) {
    await mongoClient.close();
    console.log('✓ MongoDB connection closed');
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

app.listen(port, '0.0.0.0', () => {
  console.log(`🌊 AIRank Stream Service listening on port ${port}`);
  console.log(`📊 Connection pool: maxPoolSize=${CONNECTION_POOL_OPTIONS.maxPoolSize}`);
});

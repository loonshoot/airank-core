const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const { BillingProfile, BillingProfileMember } = require('../../queries/billingProfile');

// Initialize Stripe - use real key if available, otherwise mock
let stripe;
const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.PAYMENTS_SECRET_KEY;
if (stripeKey && stripeKey !== 'sk_test' && stripeKey.startsWith('sk_')) {
  stripe = require('stripe')(stripeKey);
  console.log('✓ Using real Stripe API');
} else {
  console.log('⚠️  Using mock Stripe (no valid API key found)');
  // Mock Stripe for testing
  stripe = {
    subscriptions: {
      retrieve: async (subscriptionId) => {
        const now = Math.floor(Date.now() / 1000);
        const oneMonth = 30 * 24 * 60 * 60;
        return {
          id: subscriptionId,
          status: 'active',
          current_period_start: now,
          current_period_end: now + oneMonth,
          items: {
            data: [{
              price: {
                id: 'price_test_123',
                product: 'prod_test_123'
              }
            }]
          }
        };
      }
    },
    products: {
      retrieve: async (productId) => {
        return {
          id: productId,
          name: 'Test Plan',
          metadata: {
            plan_id: 'small',
            brands_limit: '4',
            prompts_limit: '10',
            models_limit: '3',
            allowed_models: 'gpt-4o-mini-2024-07-18,claude-3-5-haiku-20241022,gemini-2.5-flash'
          }
        };
      }
    }
  };
}

const typeDefs = gql`
  extend type Mutation {
    confirmSubscription(billingProfileId: ID!): BillingProfile
  }
`;

const resolvers = {
  confirmSubscription: async (parent, { billingProfileId }, { user }) => {
    if (!user) {
      throw new Error('Authentication required');
    }

    const userId = user.sub || user._id;
    const db = mongoose.connection.db;

    // Check user is manager of billing profile using direct collection access
    const billingMember = await db.collection('billingprofilemembers').findOne({
      billingProfileId,
      userId,
      role: 'manager'
    });

    if (!billingMember) {
      throw new Error('Only billing profile managers can confirm subscriptions');
    }

    // Get billing profile using direct collection access
    const billingProfile = await db.collection('billingprofiles').findOne({ _id: billingProfileId });
    if (!billingProfile) {
      throw new Error('Billing profile not found');
    }

    if (!billingProfile.stripeSubscriptionId) {
      throw new Error('No subscription found for this billing profile');
    }

    // Retrieve subscription from Stripe to get latest status
    const subscription = await stripe.subscriptions.retrieve(billingProfile.stripeSubscriptionId);

    // Get the product ID from the subscription
    const productId = subscription.items.data[0]?.price?.product;

    // Fetch product metadata from Stripe to sync entitlements
    const product = productId ? await stripe.products.retrieve(productId) : null;
    const metadata = product?.metadata || {};

    // Parse entitlements from Stripe product metadata
    const allowedModelsStr = metadata.allowed_models || '';
    const allowedModels = allowedModelsStr === '*' ? ['*'] : allowedModelsStr.split(',').filter(Boolean);

    const updateFields = {
      planStatus: subscription.status,
      currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      updatedAt: new Date()
    };

    // Sync plan entitlements from Stripe metadata
    if (metadata.plan_id) {
      updateFields.currentPlan = metadata.plan_id;
    }
    if (metadata.brands_limit) {
      updateFields.brandsLimit = parseInt(metadata.brands_limit, 10);
    }
    if (metadata.prompts_limit) {
      updateFields.promptsLimit = parseInt(metadata.prompts_limit, 10);
    }
    if (metadata.models_limit) {
      updateFields.modelsLimit = parseInt(metadata.models_limit, 10);
    }
    if (metadata.batch_frequency) {
      updateFields.jobFrequency = metadata.batch_frequency;
    }
    if (metadata.data_retention_days) {
      updateFields.dataRetentionDays = parseInt(metadata.data_retention_days, 10);
    }
    if (allowedModels.length > 0) {
      updateFields.allowedModels = allowedModels;
    }

    // Update billing profile with subscription details and entitlements
    await db.collection('billingprofiles').updateOne(
      { _id: billingProfileId },
      { $set: updateFields }
    );

    // Return updated billing profile
    const updatedProfile = await db.collection('billingprofiles').findOne({ _id: billingProfileId });
    return updatedProfile;
  }
};

module.exports = { typeDefs, resolvers };

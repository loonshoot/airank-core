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

    // Check user is manager of billing profile
    const billingMember = await BillingProfileMember().findOne({
      billingProfileId,
      userId: user.sub || user._id,
      role: 'manager'
    });

    if (!billingMember) {
      throw new Error('Only billing profile managers can confirm subscriptions');
    }

    // Get billing profile
    const billingProfile = await BillingProfile().findById(billingProfileId);
    if (!billingProfile) {
      throw new Error('Billing profile not found');
    }

    if (!billingProfile.stripeSubscriptionId) {
      throw new Error('No subscription found for this billing profile');
    }

    // Retrieve subscription from Stripe to get latest status
    const subscription = await stripe.subscriptions.retrieve(billingProfile.stripeSubscriptionId);

    // Update billing profile with subscription details
    billingProfile.planStatus = subscription.status;
    billingProfile.currentPeriodStart = new Date(subscription.current_period_start * 1000);
    billingProfile.currentPeriodEnd = new Date(subscription.current_period_end * 1000);
    billingProfile.updatedAt = new Date();

    await billingProfile.save();

    return billingProfile;
  }
};

module.exports = { typeDefs, resolvers };

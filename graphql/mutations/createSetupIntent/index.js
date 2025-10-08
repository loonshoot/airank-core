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
    customers: {
      create: async ({ name, email, metadata }) => ({
        id: `cus_test_${Date.now()}`,
        name,
        email,
        metadata
      })
    },
    setupIntents: {
      create: async ({ customer, payment_method_types }) => ({
        id: `seti_test_${Date.now()}`,
        customer,
        client_secret: `seti_test_secret_${Date.now()}`,
        payment_method_types
      })
    }
  };
}

const typeDefs = gql`
  type SetupIntentResult {
    clientSecret: String!
  }

  extend type Mutation {
    createSetupIntent(billingProfileId: ID!): SetupIntentResult
  }
`;

const resolvers = {
  createSetupIntent: async (parent, { billingProfileId }, { user }) => {
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
      throw new Error('Only billing profile managers can manage payment methods');
    }

    // Get billing profile using direct collection access
    const billingProfile = await db.collection('billingprofiles').findOne({ _id: billingProfileId });
    if (!billingProfile) {
      throw new Error('Billing profile not found');
    }

    // Create or get Stripe customer
    let customerId = billingProfile.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: billingProfile.name,
        email: user.email,
        metadata: {
          billingProfileId: billingProfile._id.toString()
        }
      });
      customerId = customer.id;

      // Update billing profile with Stripe customer ID
      await db.collection('billingprofiles').updateOne(
        { _id: billingProfileId },
        {
          $set: {
            stripeCustomerId: customerId,
            updatedAt: new Date()
          }
        }
      );
    }

    // Create setup intent for adding payment method
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card']
    });

    return {
      clientSecret: setupIntent.client_secret
    };
  }
};

module.exports = { typeDefs, resolvers };

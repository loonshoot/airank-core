const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const { BillingProfile, BillingProfileMember } = require('../../queries/billingProfile');

// Initialize Stripe - use real key if available, otherwise create a mock for testing
let stripe;
const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.PAYMENTS_SECRET_KEY;
if (stripeKey && stripeKey !== 'sk_test' && stripeKey.startsWith('sk_')) {
  stripe = require('stripe')(stripeKey);
} else {
  // Mock Stripe for testing
  stripe = {
    customers: {
      create: async ({ name, email, metadata }) => {
        console.log(`  [Mock Stripe] Creating customer: ${name}`);
        return {
          id: `cus_test_${Date.now()}`,
          name,
          email,
          metadata
        };
      }
    }
  };
}

const typeDefs = gql`
  extend type Mutation {
    createBillingProfile(name: String!, workspaceId: String): BillingProfile
  }
`;

const resolvers = {
  createBillingProfile: async (_, { name, workspaceId }, { user }) => {
    if (!user) throw new Error('Authentication required');

    // Create billing profile
    const billingProfile = await BillingProfile().create({
      name,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Add user as manager
    await BillingProfileMember().create({
      billingProfileId: billingProfile._id.toString(),
      userId: user.sub || user._id,
      role: 'manager'
    });

    // Create Stripe customer
    try {
      const customer = await stripe.customers.create({
        name,
        email: user.email,
        metadata: {
          billingProfileId: billingProfile._id.toString(),
          workspaceId: workspaceId || '',
          userId: user.sub || user._id
        }
      });
      billingProfile.stripeCustomerId = customer.id;
      await billingProfile.save();
    } catch (error) {
      console.error('Failed to create Stripe customer:', error);
      // Continue anyway - customer can be created later
    }

    return billingProfile;
  }
};

module.exports = { typeDefs, resolvers };

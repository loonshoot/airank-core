const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');

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

    try {
      // Connect to the airank database
      const airankUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
      const airankDb = mongoose.createConnection(airankUri);
      await airankDb.asPromise();

      // If workspaceId provided, check user has permission
      if (workspaceId) {
        const membersCollection = airankDb.collection('members');
        const member = await membersCollection.findOne({
          workspaceId,
          userId: user.sub,
          permissions: 'mutation:updateConfig'
        });

        if (!member) {
          await airankDb.close();
          throw new Error('Unauthorized: You do not have permission to create billing profiles for this workspace');
        }
      }

      // Create billing profile with free tier defaults
      const billingProfileId = new mongoose.Types.ObjectId().toString();
      const billingProfile = {
        _id: billingProfileId,
        name,
        currentPlan: 'free',
        brandsLimit: 1,
        brandsUsed: 0,
        promptsLimit: 4,
        promptsUsed: 0,
        promptCharacterLimit: 150,
        promptsResetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        modelsLimit: 1,
        jobFrequency: 'monthly',
        dataRetentionDays: 30,
        hasPaymentMethod: false,
        isDefault: false,  // User-created profiles are NOT default profiles
        defaultForWorkspaceId: null,  // Not linked to any specific workspace as default
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const billingProfilesCollection = airankDb.collection('billingprofiles');
      await billingProfilesCollection.insertOne(billingProfile);

      // Add user as billing profile manager with full permissions
      const billingProfileMember = {
        _id: new mongoose.Types.ObjectId().toString(),
        billingProfileId,
        userId: user.sub || user._id,
        role: 'manager',
        permissions: {
          attach: true,  // Can attach to workspaces
          modify: true,  // Can modify settings and members
          delete: true   // Can delete the profile
        },
        addedBy: user.sub || user._id, // Creator added themselves
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const billingProfileMembersCollection = airankDb.collection('billingprofilemembers');
      await billingProfileMembersCollection.insertOne(billingProfileMember);

      // Create Stripe customer
      try {
        const customer = await stripe.customers.create({
          name,
          email: user.email,
          metadata: {
            billingProfileId,
            workspaceId: workspaceId || '',
            userId: user.sub || user._id
          }
        });

        await billingProfilesCollection.updateOne(
          { _id: billingProfileId },
          { $set: { stripeCustomerId: customer.id } }
        );
        billingProfile.stripeCustomerId = customer.id;
      } catch (error) {
        console.error('Failed to create Stripe customer:', error);
        // Continue anyway - customer can be created later
      }

      await airankDb.close();
      return billingProfile;
    } catch (error) {
      console.error('Error creating billing profile:', error);
      throw error;
    }
  }
};

module.exports = { typeDefs, resolvers };

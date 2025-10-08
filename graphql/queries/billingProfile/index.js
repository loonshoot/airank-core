const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');

// BillingProfile schema - stores in 'airank' database
const billingProfileSchema = new mongoose.Schema({
  name: String,
  stripeCustomerId: String,
  stripeSubscriptionId: String,
  stripeQuoteId: String,
  quoteStatus: String,

  // Subscription tracking
  currentPlan: { type: String, default: 'free' },
  planStatus: String,
  currentPeriodStart: Date,
  currentPeriodEnd: Date,

  // Payment method tracking
  defaultPaymentMethodId: String,
  hasPaymentMethod: { type: Boolean, default: false },
  paymentMethodLast4: String,
  paymentMethodBrand: String,
  paymentMethodExpMonth: Number,
  paymentMethodExpYear: Number,

  // USAGE TRACKING - stored on billing profile, shared across workspaces
  brandsLimit: { type: Number, default: 1 },
  brandsUsed: { type: Number, default: 0 },

  promptsLimit: { type: Number, default: 4 },      // Monthly query limit
  promptsUsed: { type: Number, default: 0 },
  promptsResetDate: { type: Date },                 // Date to reset monthly counter

  modelsLimit: { type: Number, default: 1 },       // How many different models allowed
  dataRetentionDays: { type: Number, default: 30 }, // How long to keep data

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const billingProfileMemberSchema = new mongoose.Schema({
  billingProfileId: String,
  userId: String,
  role: String // viewer | manager
});

// Register or return existing models
const BillingProfile = () => mongoose.models.BillingProfile ||
  mongoose.model('BillingProfile', billingProfileSchema, 'billingProfiles');

const BillingProfileMember = () => mongoose.models.BillingProfileMember ||
  mongoose.model('BillingProfileMember', billingProfileMemberSchema, 'billingProfileMembers');

// GraphQL typeDefs
const typeDefs = gql`
  type BillingProfileMember {
    _id: ID!
    billingProfileId: ID!
    userId: ID!
    role: String!
  }

  type BillingProfile {
    _id: ID!
    name: String!
    stripeCustomerId: String
    stripeSubscriptionId: String
    stripeQuoteId: String
    quoteStatus: String

    currentPlan: String!
    planStatus: String
    currentPeriodStart: DateTime
    currentPeriodEnd: DateTime

    hasPaymentMethod: Boolean!
    paymentMethodLast4: String
    paymentMethodBrand: String
    paymentMethodExpMonth: Int
    paymentMethodExpYear: Int

    # Usage tracking
    brandsLimit: Int!
    brandsUsed: Int!
    promptsLimit: Int!
    promptsUsed: Int!
    promptsResetDate: DateTime
    modelsLimit: Int!
    dataRetentionDays: Int!

    members: [BillingProfileMember]
  }

  extend type Query {
    billingProfiles(billingProfileId: ID): [BillingProfile]
    billingProfile(billingProfileId: ID!): BillingProfile
  }
`;

// GraphQL resolvers
const resolvers = {
  billingProfiles: async (_, { billingProfileId }, { user }) => {
    if (!user) throw new Error('User not authenticated');

    const userId = user.sub || user._id;
    console.log('Looking up billing profiles for userId:', userId);

    // Use the default mongoose connection to access the airank database
    const db = mongoose.connection.db;

    // Find memberships for this user using direct collection access
    const memberDocs = await db.collection('billingprofilemembers').find({
      userId
    }).toArray();
    console.log('Found billing profile memberships:', memberDocs.length);

    const profileIds = memberDocs.map(m => m.billingProfileId);
    if (profileIds.length === 0) {
      console.log('No billing profile memberships found for user:', userId);
      return [];
    }

    // Find billing profiles using direct collection access
    const filter = billingProfileId
      ? { _id: billingProfileId }
      : { _id: { $in: profileIds } };
    const profiles = await db.collection('billingprofiles').find(filter).toArray();

    return profiles.map((p) => {
      const plainProfile = {
        ...p,
        _id: p._id.toString()
      };

      const membersForProfile = memberDocs
        .filter((m) => m.billingProfileId === plainProfile._id)
        .map((m) => ({
          ...m,
          _id: m._id.toString(),
        }));

      return {
        ...plainProfile,
        members: membersForProfile,
      };
    });
  },

  billingProfile: async (_, { billingProfileId }, { user }) => {
    if (!user) throw new Error('User not authenticated');

    const userId = user.sub || user._id;
    const db = mongoose.connection.db;

    // Check user has access using direct collection access
    const member = await db.collection('billingprofilemembers').findOne({
      billingProfileId,
      userId
    });

    if (!member) {
      throw new Error('Unauthorized');
    }

    const profile = await db.collection('billingprofiles').findOne({ _id: billingProfileId });
    return profile;
  }
};

module.exports = { typeDefs, resolvers, BillingProfile, BillingProfileMember };

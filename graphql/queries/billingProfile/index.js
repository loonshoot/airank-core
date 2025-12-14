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

  // Default profile tracking
  isDefault: { type: Boolean, default: false },  // Is this a workspace default profile?
  defaultForWorkspaceId: { type: String },       // Which workspace is this the default for?

  // USAGE TRACKING - stored on billing profile, shared across workspaces
  brandsLimit: { type: Number, default: 1 },
  brandsUsed: { type: Number, default: 0 },

  promptsLimit: { type: Number, default: 4 },      // Monthly query limit
  promptsUsed: { type: Number, default: 0 },
  promptsResetDate: { type: Date },                 // Date to reset monthly counter

  modelsLimit: { type: Number, default: 1 },       // How many different models allowed
  dataRetentionDays: { type: Number, default: 30 }, // How long to keep data

  // Entitlements
  promptCharacterLimit: { type: Number, default: 25 }, // Max characters per prompt
  allowedModels: [String],                        // Array of model IDs allowed for this plan
  jobFrequency: { type: String, enum: ['monthly', 'daily'], default: 'monthly' },
  nextJobRunDate: Date,                           // When next job should run

  // Subscription timing
  planExpiry: Date,                               // When current subscription period ends

  // Payment failure handling
  paymentFailedAt: Date,                          // When payment first failed
  gracePeriodEndsAt: Date,                        // 30 days from payment failure

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const billingProfileMemberSchema = new mongoose.Schema({
  billingProfileId: String,
  userId: String,
  role: String, // viewer | manager (kept for backwards compatibility)
  permissions: {
    attach: { type: Boolean, default: false },  // Can attach profile to workspaces
    modify: { type: Boolean, default: false },  // Can modify billing profile settings
    delete: { type: Boolean, default: false }   // Can delete billing profile
  },
  addedBy: String, // userId of who added this member
  createdAt: { type: Date, default: Date.now }
});

// Register or return existing models
const BillingProfile = () => mongoose.models.BillingProfile ||
  mongoose.model('BillingProfile', billingProfileSchema, 'billingProfiles');

const BillingProfileMember = () => mongoose.models.BillingProfileMember ||
  mongoose.model('BillingProfileMember', billingProfileMemberSchema, 'billingProfileMembers');

// GraphQL typeDefs
const typeDefs = gql`
  type BillingProfilePermissions {
    attach: Boolean!
    modify: Boolean!
    delete: Boolean!
  }

  type BillingProfileMember {
    _id: ID!
    billingProfileId: ID!
    userId: ID!
    email: String
    role: String!
    permissions: BillingProfilePermissions!
    addedBy: String
    createdAt: DateTime
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

    # Payment collection method: 'charge_automatically' (card) or 'send_invoice' (invoice)
    collectionMethod: String

    # Default profile tracking
    isDefault: Boolean!
    defaultForWorkspaceId: String

    # Usage tracking
    brandsLimit: Int!
    brandsUsed: Int!
    promptsLimit: Int!
    promptsUsed: Int!
    promptsResetDate: DateTime
    modelsLimit: Int!
    dataRetentionDays: Int!

    # Entitlements
    promptCharacterLimit: Int!
    allowedModels: [String]
    jobFrequency: String!
    nextJobRunDate: DateTime

    # Subscription timing
    planExpiry: DateTime

    # Payment failure handling
    paymentFailedAt: DateTime
    gracePeriodEndsAt: DateTime

    members: [BillingProfileMember]
  }

  input BillingProfilePermissionsInput {
    attach: Boolean!
    modify: Boolean!
    delete: Boolean!
  }

  extend type Query {
    billingProfiles(billingProfileId: ID, workspaceId: ID): [BillingProfile]
    billingProfile(billingProfileId: ID!): BillingProfile
  }

  extend type Mutation {
    addBillingProfileMember(
      billingProfileId: ID!
      email: String!
      permissions: BillingProfilePermissionsInput!
    ): BillingProfileMember

    updateBillingProfileMember(
      billingProfileId: ID!
      userId: ID!
      permissions: BillingProfilePermissionsInput!
    ): BillingProfileMember

    removeBillingProfileMember(
      billingProfileId: ID!
      userId: ID!
    ): Boolean

    deleteBillingProfile(
      billingProfileId: ID!
    ): Boolean
  }
`;

// GraphQL resolvers
const resolvers = {
  billingProfiles: async (_, { billingProfileId, workspaceId }, { user }) => {
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

    // Get user's workspace memberships to know which workspaces the user has access to
    const userWorkspaceMemberships = await db.collection('members').find({
      userId
    }).toArray();
    const userWorkspaceIds = userWorkspaceMemberships.map(m => m.workspaceId);

    console.log('User workspace IDs:', userWorkspaceIds);
    console.log('Current workspace context:', workspaceId || 'none');
    console.log('Profiles before filtering:', profiles.map(p => ({
      id: p._id,
      name: p.name,
      isDefault: p.isDefault,
      defaultForWorkspaceId: p.defaultForWorkspaceId
    })));

    // Filter profiles based on whether they're defaults
    const filteredProfiles = profiles.filter(p => {
      // If querying a specific profile, always include it (user has access via membership)
      if (billingProfileId) {
        console.log(`Including specific profile: ${p.name}`);
        return true;
      }

      // If this profile is marked as a default, only show it if:
      // 1. No workspace context: show defaults for ALL user's workspaces
      // 2. Workspace context provided: show ONLY the default for that specific workspace
      if (p.isDefault && p.defaultForWorkspaceId) {
        let include;
        if (workspaceId) {
          // Only include if it's the default for the current workspace
          include = p.defaultForWorkspaceId === workspaceId;
          console.log(`Profile "${p.name}" is default for workspace ${p.defaultForWorkspaceId}. Current workspace: ${workspaceId}. Including: ${include}`);
        } else {
          // Include if user has access to the workspace this is default for
          include = userWorkspaceIds.includes(p.defaultForWorkspaceId);
          console.log(`Profile "${p.name}" is default for workspace ${p.defaultForWorkspaceId}. User has access: ${include}`);
        }
        return include;
      }

      // Non-default profiles are always visible if user is a member
      console.log(`Profile "${p.name}" is NOT default, including it`);
      return true;
    });

    console.log('Profiles after filtering:', filteredProfiles.map(p => ({ id: p._id, name: p.name })));

    // Get all unique user IDs from members
    const allUserIds = [...new Set(memberDocs.map(m => m.userId))];

    // Fetch user emails from users collection
    const users = await db.collection('users').find({
      _id: { $in: allUserIds }
    }).toArray();

    // Create a map of userId -> email
    const userEmailMap = {};
    users.forEach(user => {
      userEmailMap[user._id] = user.email;
    });

    return filteredProfiles.map((p) => {
      const plainProfile = {
        ...p,
        _id: p._id.toString()
      };

      const membersForProfile = memberDocs
        .filter((m) => m.billingProfileId === plainProfile._id)
        .map((m) => ({
          ...m,
          _id: m._id.toString(),
          email: userEmailMap[m.userId] || null,
          permissions: m.permissions || { attach: false, modify: false, delete: false }
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
  },

  addBillingProfileMember: async (_, { billingProfileId, email, permissions }, { user }) => {
    if (!user) throw new Error('User not authenticated');

    const userId = user.sub || user._id;
    const db = mongoose.connection.db;

    // Check if profile is a default profile for any workspace
    const workspace = await db.collection('workspaces').findOne({
      defaultBillingProfileId: billingProfileId
    });

    if (workspace) {
      throw new Error('Cannot add members to default billing profiles. Default profiles are workspace-specific.');
    }

    // Check if current user has modify permission
    const currentMember = await db.collection('billingprofilemembers').findOne({
      billingProfileId,
      userId
    });

    if (!currentMember || !currentMember.permissions?.modify) {
      throw new Error('Unauthorized: You do not have permission to add members to this billing profile');
    }

    // Look up user by email in users collection
    const targetUser = await db.collection('users').findOne({ email: email.toLowerCase() });

    if (!targetUser) {
      throw new Error('User with this email address not found. They must have an account first.');
    }

    const targetUserId = targetUser._id;

    // Check if user is already a member
    const existingMember = await db.collection('billingprofilemembers').findOne({
      billingProfileId,
      userId: targetUserId
    });

    if (existingMember) {
      throw new Error('User is already a member of this billing profile');
    }

    // Add new member
    const newMember = {
      _id: new mongoose.Types.ObjectId(),
      billingProfileId,
      userId: targetUserId,
      role: 'manager', // kept for backwards compatibility
      permissions,
      addedBy: userId,
      createdAt: new Date()
    };

    await db.collection('billingprofilemembers').insertOne(newMember);

    return {
      ...newMember,
      _id: newMember._id.toString()
    };
  },

  updateBillingProfileMember: async (_, { billingProfileId, userId: targetUserId, permissions }, { user }) => {
    if (!user) throw new Error('User not authenticated');

    const userId = user.sub || user._id;
    const db = mongoose.connection.db;

    // Check if profile is a default profile for any workspace
    const workspace = await db.collection('workspaces').findOne({
      defaultBillingProfileId: billingProfileId
    });

    if (workspace) {
      throw new Error('Cannot modify members of default billing profiles. Default profiles are workspace-specific.');
    }

    // Check if current user has modify permission
    const currentMember = await db.collection('billingprofilemembers').findOne({
      billingProfileId,
      userId
    });

    if (!currentMember || !currentMember.permissions?.modify) {
      throw new Error('Unauthorized: You do not have permission to modify members of this billing profile');
    }

    // Get the target member's current permissions
    const targetMember = await db.collection('billingprofilemembers').findOne({
      billingProfileId,
      userId: targetUserId
    });

    if (!targetMember) {
      throw new Error('Member not found');
    }

    // If updating own permissions, check if they're the last member
    if (targetUserId === userId) {
      // Count total members in the billing profile
      const memberCount = await db.collection('billingprofilemembers').countDocuments({
        billingProfileId
      });

      // If they're the only member, they cannot modify their own permissions
      if (memberCount === 1) {
        throw new Error('Cannot modify permissions. You are the only member of this billing profile. Add another member first, or delete the billing profile if you no longer need it.');
      }
    }

    // Update the target member's permissions
    const result = await db.collection('billingprofilemembers').findOneAndUpdate(
      { billingProfileId, userId: targetUserId },
      { $set: { permissions, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );

    if (!result.value) {
      throw new Error('Member not found');
    }

    return {
      ...result.value,
      _id: result.value._id.toString()
    };
  },

  removeBillingProfileMember: async (_, { billingProfileId, userId: targetUserId }, { user }) => {
    if (!user) throw new Error('User not authenticated');

    const userId = user.sub || user._id;
    const db = mongoose.connection.db;

    // Check if profile is a default profile for any workspace
    const workspace = await db.collection('workspaces').findOne({
      defaultBillingProfileId: billingProfileId
    });

    if (workspace) {
      throw new Error('Cannot remove members from default billing profiles. Default profiles are workspace-specific.');
    }

    // Check if current user has modify permission
    const currentMember = await db.collection('billingprofilemembers').findOne({
      billingProfileId,
      userId
    });

    if (!currentMember || !currentMember.permissions?.modify) {
      throw new Error('Unauthorized: You do not have permission to remove members from this billing profile');
    }

    // Count total members in the billing profile
    const memberCount = await db.collection('billingprofilemembers').countDocuments({
      billingProfileId
    });

    // Don't allow removing the last member
    if (memberCount === 1) {
      throw new Error('Cannot remove the last member. A billing profile must have at least one member. Delete the billing profile instead if you no longer need it.');
    }

    // Remove the member
    const result = await db.collection('billingprofilemembers').deleteOne({
      billingProfileId,
      userId: targetUserId
    });

    return result.deletedCount > 0;
  },

  deleteBillingProfile: async (_, { billingProfileId }, { user }) => {
    if (!user) throw new Error('User not authenticated');

    const userId = user.sub || user._id;
    const db = mongoose.connection.db;

    // Check if profile is a default profile for any workspace
    const workspace = await db.collection('workspaces').findOne({
      defaultBillingProfileId: billingProfileId
    });

    if (workspace) {
      throw new Error('Cannot delete default billing profiles. Default profiles are automatically managed per workspace.');
    }

    // Check if current user has delete permission
    const currentMember = await db.collection('billingprofilemembers').findOne({
      billingProfileId,
      userId
    });

    if (!currentMember || !currentMember.permissions?.delete) {
      throw new Error('Unauthorized: You do not have permission to delete this billing profile');
    }

    // Check if profile is currently attached to any workspaces
    const attachedWorkspace = await db.collection('workspaces').findOne({
      billingProfileId
    });

    if (attachedWorkspace) {
      throw new Error('Cannot delete billing profile that is currently attached to a workspace. Detach it first.');
    }

    // Delete all members
    await db.collection('billingprofilemembers').deleteMany({ billingProfileId });

    // Delete the profile
    const result = await db.collection('billingprofiles').deleteOne({ _id: billingProfileId });

    return result.deletedCount > 0;
  }
};

module.exports = { typeDefs, resolvers, BillingProfile, BillingProfileMember };

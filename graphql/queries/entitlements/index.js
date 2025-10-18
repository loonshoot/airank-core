const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

// GraphQL type definitions
const typeDefs = gql`
  type ModelEntitlement {
    modelId: String!
    name: String!
    provider: String!
    isAllowed: Boolean!
    requiresUpgrade: Boolean!
    priority: Int!
  }

  type Entitlements {
    workspaceId: ID!

    # Limits
    brandsLimit: Int!
    brandsUsed: Int!
    brandsRemaining: Int!

    promptsLimit: Int!
    promptsUsed: Int!
    promptsRemaining: Int!
    promptsResetDate: DateTime!
    promptCharacterLimit: Int!

    modelsLimit: Int!
    modelsAllowed: [ModelEntitlement!]!

    jobFrequency: String!
    nextJobRunDate: DateTime

    # Payment status
    paymentStatus: String!
    paymentFailedAt: DateTime
    gracePeriodEndsAt: DateTime
    isInGracePeriod: Boolean!
    paymentExpired: Boolean!

    # Actions
    canCreateBrand: Boolean!
    canCreatePrompt: Boolean!
    canAddModel: Boolean!
    canRunJobs: Boolean!
  }

  extend type Query {
    entitlements(workspaceId: ID!): Entitlements!
  }

  extend type Mutation {
    refreshEntitlements(workspaceId: ID!): Entitlements!
  }
`;

/**
 * Get model priority list from YAML configuration
 */
function getModelPriorities() {
  try {
    const configPath = path.join(__dirname, '../../../config/model-priority.yaml');
    const fileContents = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(fileContents);
    return config.priority || [];
  } catch (error) {
    console.error('Error loading model priorities:', error);
    return [];
  }
}

/**
 * Get billing profile for a workspace
 */
async function getBillingProfileForWorkspace(workspaceId) {
  const airankUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
  const airankDb = mongoose.createConnection(airankUri);
  await airankDb.asPromise();

  try {
    // Get workspace
    const workspace = await airankDb.collection('workspaces').findOne({ _id: workspaceId });
    if (!workspace || !workspace.billingProfileId) {
      await airankDb.close();
      throw new Error('Workspace not found or has no billing profile');
    }

    // Get billing profile
    const billingProfile = await airankDb.collection('billingprofiles').findOne({
      _id: workspace.billingProfileId
    });

    await airankDb.close();
    return billingProfile;
  } catch (error) {
    await airankDb.close();
    throw error;
  }
}

/**
 * Check if billing profile is in grace period after payment failure
 */
function isInGracePeriod(billingProfile) {
  if (!billingProfile.gracePeriodEndsAt) return false;
  return new Date() < new Date(billingProfile.gracePeriodEndsAt);
}

/**
 * Check if payment has failed and grace period has expired
 */
function isPaymentExpired(billingProfile) {
  if (!billingProfile.paymentFailedAt) return false;
  if (isInGracePeriod(billingProfile)) return false;
  return true;
}

/**
 * Get workspace models
 */
async function getWorkspaceModels(workspaceId) {
  const workspaceDbUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  const workspaceDb = mongoose.createConnection(workspaceDbUri);
  await workspaceDb.asPromise();

  try {
    const models = await workspaceDb.collection('models').find({ isEnabled: true }).toArray();
    await workspaceDb.close();
    return models;
  } catch (error) {
    await workspaceDb.close();
    return [];
  }
}

/**
 * Enforce model limits and mark models as requiring upgrade
 */
function enforceModelLimits(models, modelsLimit, allowedModels = []) {
  const modelPriorities = getModelPriorities();

  // Sort models by priority
  const sortedModels = models.map(model => {
    const priorityIndex = modelPriorities.indexOf(model.modelId);
    return {
      ...model,
      priority: priorityIndex === -1 ? 9999 : priorityIndex
    };
  }).sort((a, b) => a.priority - b.priority);

  // Mark models based on limit and allowed list
  return sortedModels.map((model, index) => {
    const withinLimit = index < modelsLimit;
    const isAllowed = allowedModels.length === 0 || allowedModels.includes(model.modelId);
    const requiresUpgrade = !withinLimit || !isAllowed;

    return {
      modelId: model.modelId,
      name: model.name,
      provider: model.provider,
      isAllowed: !requiresUpgrade,
      requiresUpgrade,
      priority: model.priority,
      _id: model._id
    };
  });
}

/**
 * Get complete entitlements for a workspace
 */
async function getEntitlements(workspaceId) {
  const billingProfile = await getBillingProfileForWorkspace(workspaceId);

  // Check payment status
  const inGracePeriod = isInGracePeriod(billingProfile);
  const paymentExpired = isPaymentExpired(billingProfile);

  // If payment expired, treat as free tier
  const effectivePlan = paymentExpired ? 'free' : billingProfile.currentPlan;
  const effectiveProfile = paymentExpired ? {
    ...billingProfile,
    currentPlan: 'free',
    brandsLimit: 1,
    promptsLimit: 4,
    modelsLimit: 1,
    promptCharacterLimit: 25,
    jobFrequency: 'monthly',
  } : billingProfile;

  // Calculate remaining limits
  const brandsRemaining = Math.max(0, effectiveProfile.brandsLimit - effectiveProfile.brandsUsed);
  const promptsRemaining = Math.max(0, effectiveProfile.promptsLimit - effectiveProfile.promptsUsed);

  // Get workspace models to enforce limits
  const models = await getWorkspaceModels(workspaceId);
  const modelEntitlements = enforceModelLimits(
    models,
    effectiveProfile.modelsLimit,
    effectiveProfile.allowedModels
  );

  return {
    workspaceId,
    billingProfile: effectiveProfile,

    // Limits
    brandsLimit: effectiveProfile.brandsLimit,
    brandsUsed: effectiveProfile.brandsUsed,
    brandsRemaining,

    promptsLimit: effectiveProfile.promptsLimit,
    promptsUsed: effectiveProfile.promptsUsed,
    promptsRemaining,
    promptsResetDate: effectiveProfile.promptsResetDate,
    promptCharacterLimit: effectiveProfile.promptCharacterLimit,

    modelsLimit: effectiveProfile.modelsLimit,
    modelsAllowed: modelEntitlements,

    jobFrequency: effectiveProfile.jobFrequency,
    nextJobRunDate: effectiveProfile.nextJobRunDate,

    // Payment status
    paymentStatus: billingProfile.planStatus || 'active',
    paymentFailedAt: billingProfile.paymentFailedAt,
    gracePeriodEndsAt: billingProfile.gracePeriodEndsAt,
    isInGracePeriod: inGracePeriod,
    paymentExpired,

    // Action permissions
    canCreateBrand: brandsRemaining > 0,
    canCreatePrompt: promptsRemaining > 0,
    canAddModel: models.filter(m => !m.requiresUpgrade).length < effectiveProfile.modelsLimit,
    canRunJobs: !paymentExpired,
  };
}

// GraphQL resolvers
const resolvers = {
  entitlements: async (_, { workspaceId }, { user }) => {
    if (!user) throw new Error('Authentication required');

    try {
      console.log(`Fetching entitlements for workspace: ${workspaceId}`);
      const entitlements = await getEntitlements(workspaceId);
      return entitlements;
    } catch (error) {
      console.error('Error fetching entitlements:', error);
      throw new Error(`Failed to fetch entitlements: ${error.message}`);
    }
  },

  refreshEntitlements: async (_, { workspaceId }, { user }) => {
    if (!user) throw new Error('Authentication required');

    try {
      console.log(`Refreshing entitlements for workspace: ${workspaceId}`);
      // Always fetch fresh data
      const entitlements = await getEntitlements(workspaceId);
      return entitlements;
    } catch (error) {
      console.error('Error refreshing entitlements:', error);
      throw new Error(`Failed to refresh entitlements: ${error.message}`);
    }
  }
};

module.exports = { typeDefs, resolvers };

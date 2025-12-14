const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

// Load plans config - handle both local dev and Docker paths
let getPlanConfig;
try {
  // Try Docker path first (queries is directly under /app)
  getPlanConfig = require('../../config/plans').getPlanConfig;
} catch (e) {
  // Fall back to local dev path
  getPlanConfig = require('../../../config/plans').getPlanConfig;
}

// GraphQL type definitions
const typeDefs = gql`
  type SuggestedUpgradeModel {
    modelId: String!
    name: String!
  }

  type ModelEntitlement {
    modelId: String!
    name: String!
    provider: String!
    description: String!
    isAllowed: Boolean!
    requiresUpgrade: Boolean!
    priority: Int!
    isCurrentlyEnabled: Boolean!
    isSelectable: Boolean!
    allowedInBatchJobs: Boolean!
    suggestedUpgrade: SuggestedUpgradeModel
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
    // Try Docker path first, then local dev path
    let configPath = path.join(__dirname, '../../config/model-priority.yaml');
    if (!fs.existsSync(configPath)) {
      configPath = path.join(__dirname, '../../../config/model-priority.yaml');
    }
    const fileContents = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(fileContents);
    return config.priority || [];
  } catch (error) {
    console.error('Error loading model priorities:', error);
    return [];
  }
}

/**
 * Get all models configuration from YAML
 */
function getModelsConfig() {
  try {
    // Try Docker path first, then local dev path
    let configPath = path.join(__dirname, '../../config/models.yaml');
    if (!fs.existsSync(configPath)) {
      configPath = path.join(__dirname, '../../../config/models.yaml');
    }
    const fileContents = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(fileContents);
    return config.models || [];
  } catch (error) {
    console.error('Error loading models config:', error);
    return [];
  }
}

/**
 * Get model config by ID
 */
function getModelConfig(modelId) {
  const models = getModelsConfig();
  return models.find(m => m.modelId === modelId) || null;
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

    // Get billing profile - handle both string and ObjectId types
    const billingProfileId = typeof workspace.billingProfileId === 'string'
      ? workspace.billingProfileId
      : workspace.billingProfileId.toString();

    const billingProfile = await airankDb.collection('billingprofiles').findOne({
      _id: billingProfileId
    });

    if (!billingProfile) {
      await airankDb.close();
      throw new Error(`Billing profile not found: ${billingProfileId}`);
    }

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
 * This function evaluates ALL available models from YAML configuration
 */
function enforceModelLimits(enabledModels, modelsLimit, allowedModels = []) {
  const modelPriorities = getModelPriorities();
  const modelsConfig = getModelsConfig();

  // Filter to only models that should be shown in UI
  const uiModels = modelsConfig.filter(m => m.showInUI);

  // Count currently enabled models (only count selectable ones for limit purposes)
  const enabledSelectableCount = enabledModels.filter(em => {
    const config = modelsConfig.find(m => m.modelId === em.modelId);
    return config && config.isSelectable;
  }).length;

  // Map all UI models with entitlement info
  return uiModels.map(modelConfig => {
    const isCurrentlyEnabled = enabledModels.some(em => em.modelId === modelConfig.modelId);
    const priorityIndex = modelPriorities.indexOf(modelConfig.modelId);
    const priority = priorityIndex === -1 ? 9999 : priorityIndex;

    // Check if model is in allowed list (if allowedModels is specified)
    // '*' means all models are allowed
    const isInAllowedList = allowedModels.length === 0 ||
      allowedModels.includes('*') ||
      allowedModels.includes(modelConfig.modelId);

    // A model requires upgrade if:
    // 1. It's NOT in the allowed list, OR
    // 2. It's selectable, not enabled, AND we're at/over the limit (unless unlimited: -1)
    let requiresUpgrade = false;
    const isUnlimited = modelsLimit === -1;

    if (!isInAllowedList) {
      requiresUpgrade = true;
    } else if (!isUnlimited && modelConfig.isSelectable && !isCurrentlyEnabled && enabledSelectableCount >= modelsLimit) {
      requiresUpgrade = true;
    }

    // Get suggested upgrade model info if exists
    let suggestedUpgradeModel = null;
    if (modelConfig.suggestedUpgrade) {
      const upgradeConfig = modelsConfig.find(m => m.modelId === modelConfig.suggestedUpgrade);
      if (upgradeConfig) {
        suggestedUpgradeModel = {
          modelId: upgradeConfig.modelId,
          name: upgradeConfig.name
        };
      }
    }

    return {
      modelId: modelConfig.modelId,
      name: modelConfig.name,
      provider: modelConfig.provider,
      description: modelConfig.description,
      isAllowed: !requiresUpgrade,
      requiresUpgrade,
      priority,
      isCurrentlyEnabled,
      isSelectable: modelConfig.isSelectable,
      allowedInBatchJobs: modelConfig.allowedInBatchJobs,
      suggestedUpgrade: suggestedUpgradeModel
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
  const effectiveProfile = paymentExpired ? {
    ...billingProfile,
    currentPlan: 'free',
    brandsLimit: 1,
    promptsLimit: 4,
    modelsLimit: 1,
    promptCharacterLimit: 25,
    jobFrequency: 'monthly',
    allowedModels: ['gpt-4o-mini-2024-07-18']
  } : billingProfile;

  // Count actual brands and prompts (live count)
  // Only count competitor brands - own brand doesn't count toward limit
  let actualBrandsUsed = 0;
  let actualPromptsUsed = 0;

  try {
    const workspaceDbUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
    const workspaceDb = mongoose.createConnection(workspaceDbUri);
    await workspaceDb.asPromise();

    // Only count competitor brands - own brand doesn't count toward limit
    actualBrandsUsed = await workspaceDb.collection('brands').countDocuments({
      isOwnBrand: { $ne: true }
    });
    actualPromptsUsed = await workspaceDb.collection('prompts').countDocuments({});

    await workspaceDb.close();
  } catch (error) {
    console.error('Error counting workspace resources:', error);
    // Fall back to cached counts if live count fails
    actualBrandsUsed = effectiveProfile.brandsUsed || 0;
    actualPromptsUsed = effectiveProfile.promptsUsed || 0;
  }

  // Calculate remaining limits using live counts (-1 means unlimited)
  const brandsUnlimited = effectiveProfile.brandsLimit === -1;
  const promptsUnlimited = effectiveProfile.promptsLimit === -1;
  const modelsUnlimited = effectiveProfile.modelsLimit === -1;

  const brandsRemaining = brandsUnlimited ? -1 : Math.max(0, effectiveProfile.brandsLimit - actualBrandsUsed);
  const promptsRemaining = promptsUnlimited ? -1 : Math.max(0, effectiveProfile.promptsLimit - actualPromptsUsed);

  // Get workspace models to enforce limits
  const models = await getWorkspaceModels(workspaceId);

  // Get allowedModels from billing profile, or fallback to plan config
  const planConfig = getPlanConfig(effectiveProfile.currentPlan);
  const allowedModels = effectiveProfile.allowedModels || planConfig.allowedModels || [];

  const modelEntitlements = enforceModelLimits(
    models,
    effectiveProfile.modelsLimit,
    allowedModels
  );

  return {
    workspaceId,
    billingProfile: effectiveProfile,

    // Limits - use live counts
    brandsLimit: effectiveProfile.brandsLimit,
    brandsUsed: actualBrandsUsed,
    brandsRemaining,

    promptsLimit: effectiveProfile.promptsLimit,
    promptsUsed: actualPromptsUsed,
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

    // Action permissions (-1 means unlimited, so always allowed)
    canCreateBrand: brandsUnlimited || brandsRemaining > 0,
    canCreatePrompt: promptsUnlimited || promptsRemaining > 0,
    canAddModel: modelsUnlimited || models.filter(m => !m.requiresUpgrade).length < effectiveProfile.modelsLimit,
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

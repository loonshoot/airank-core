const mongoose = require('mongoose');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

/**
 * Entitlements Helper Functions for Mutations
 *
 * These functions check entitlements before allowing mutations to proceed.
 */

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
  } : billingProfile;

  // Count actual brands in workspace (live count)
  let actualBrandsUsed = 0;
  let actualPromptsUsed = 0;

  try {
    const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
    const datalake = mongoose.createConnection(dataLakeUri);
    await datalake.asPromise();

    actualBrandsUsed = await datalake.collection('brands').countDocuments({ workspaceId });
    actualPromptsUsed = await datalake.collection('prompts').countDocuments({ workspaceId });

    await datalake.close();
  } catch (error) {
    console.error('Error counting workspace resources:', error);
    // Fall back to cached counts if live count fails
    actualBrandsUsed = effectiveProfile.brandsUsed || 0;
    actualPromptsUsed = effectiveProfile.promptsUsed || 0;
  }

  // Calculate remaining limits using live counts
  const brandsRemaining = Math.max(0, effectiveProfile.brandsLimit - actualBrandsUsed);
  const promptsRemaining = Math.max(0, effectiveProfile.promptsLimit - actualPromptsUsed);

  return {
    brandsLimit: effectiveProfile.brandsLimit,
    brandsUsed: actualBrandsUsed,
    brandsRemaining,

    promptsLimit: effectiveProfile.promptsLimit,
    promptsUsed: actualPromptsUsed,
    promptsRemaining,
    promptCharacterLimit: effectiveProfile.promptCharacterLimit,

    modelsLimit: effectiveProfile.modelsLimit,
    allowedModels: effectiveProfile.allowedModels || [],

    paymentExpired,
  };
}

/**
 * Truncate prompt to character limit
 */
function enforceCharacterLimit(prompt, limit) {
  if (!prompt || prompt.length <= limit) {
    return {
      original: prompt,
      truncated: prompt,
      isTruncated: false,
      originalLength: prompt ? prompt.length : 0,
      limit
    };
  }

  return {
    original: prompt,
    truncated: prompt.substring(0, limit),
    isTruncated: true,
    originalLength: prompt.length,
    limit,
    message: `Original prompt exceeds ${limit} character limit. Upgrade your plan to use the full prompt.`
  };
}

/**
 * Check if a specific action is allowed
 */
async function canPerformAction(workspaceId, action) {
  const entitlements = await getEntitlements(workspaceId);

  switch (action) {
    case 'createBrand':
      return {
        allowed: entitlements.brandsRemaining > 0,
        reason: entitlements.brandsRemaining > 0 ? null : `Brand limit reached (${entitlements.brandsUsed}/${entitlements.brandsLimit}). Upgrade your plan to add more brands.`
      };

    case 'createPrompt':
      return {
        allowed: entitlements.promptsRemaining > 0,
        reason: entitlements.promptsRemaining > 0 ? null : `Prompt limit reached (${entitlements.promptsUsed}/${entitlements.promptsLimit}). Limits reset monthly.`
      };

    case 'addModel':
      return {
        allowed: entitlements.brandsRemaining > 0,
        reason: entitlements.brandsRemaining > 0 ? null : `Model limit reached (${entitlements.modelsLimit}). Upgrade your plan to add more models.`
      };

    default:
      return { allowed: false, reason: 'Unknown action' };
  }
}

module.exports = {
  getEntitlements,
  enforceCharacterLimit,
  canPerformAction
};

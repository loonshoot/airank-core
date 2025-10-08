/**
 * Entitlement checking utilities for enforcing billing limits
 *
 * This module provides functions to check and enforce subscription limits
 * across all workspaces sharing a billing profile.
 */

const mongoose = require('mongoose');
const { BillingProfile } = require('../graphql/queries/billingProfile');
const { Workspace } = require('../graphql/queries/workspace');

/**
 * Check if user can create a new brand
 * @param {string} workspaceId - The workspace ID
 * @returns {Promise<{allowed: boolean, reason?: string, limit?: number, used?: number}>}
 */
async function canCreateBrand(workspaceId) {
  const workspace = await Workspace().findById(workspaceId);
  if (!workspace || !workspace.billingProfileId) {
    return { allowed: false, reason: 'No billing profile attached to workspace' };
  }

  const billingProfile = await BillingProfile().findById(workspace.billingProfileId);
  if (!billingProfile) {
    return { allowed: false, reason: 'Billing profile not found' };
  }

  const { brandsLimit, brandsUsed } = billingProfile;

  if (brandsUsed >= brandsLimit) {
    return {
      allowed: false,
      reason: `Brand limit reached. Your plan allows ${brandsLimit} brands.`,
      limit: brandsLimit,
      used: brandsUsed
    };
  }

  return { allowed: true, limit: brandsLimit, used: brandsUsed };
}

/**
 * Check if user can create a new prompt/query
 * @param {string} workspaceId - The workspace ID
 * @returns {Promise<{allowed: boolean, reason?: string, limit?: number, used?: number, resetDate?: Date}>}
 */
async function canCreatePrompt(workspaceId) {
  const workspace = await Workspace().findById(workspaceId);
  if (!workspace || !workspace.billingProfileId) {
    return { allowed: false, reason: 'No billing profile attached to workspace' };
  }

  const billingProfile = await BillingProfile().findById(workspace.billingProfileId);
  if (!billingProfile) {
    return { allowed: false, reason: 'Billing profile not found' };
  }

  // Check if reset is needed (for free tier monthly reset)
  const now = new Date();
  if (billingProfile.currentPlan === 'free' && billingProfile.promptsResetDate) {
    if (now > billingProfile.promptsResetDate) {
      // Reset prompts usage
      billingProfile.promptsUsed = 0;
      // Set next reset date (30 days from now)
      billingProfile.promptsResetDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      await billingProfile.save();
    }
  }

  const { promptsLimit, promptsUsed, promptsResetDate } = billingProfile;

  if (promptsUsed >= promptsLimit) {
    return {
      allowed: false,
      reason: `Prompt limit reached. Your plan allows ${promptsLimit} prompts${promptsResetDate ? ` (resets ${promptsResetDate.toLocaleDateString()})` : ''}.`,
      limit: promptsLimit,
      used: promptsUsed,
      resetDate: promptsResetDate
    };
  }

  return { allowed: true, limit: promptsLimit, used: promptsUsed, resetDate: promptsResetDate };
}

/**
 * Check if user can use a specific AI model
 * @param {string} workspaceId - The workspace ID
 * @param {string} modelName - The model name (e.g., 'gpt-4o', 'claude-3-5-sonnet')
 * @returns {Promise<{allowed: boolean, reason?: string, allowedModels?: string[]}>}
 */
async function canUseModel(workspaceId, modelName) {
  const workspace = await Workspace().findById(workspaceId);
  if (!workspace || !workspace.billingProfileId) {
    return { allowed: false, reason: 'No billing profile attached to workspace' };
  }

  const billingProfile = await BillingProfile().findById(workspace.billingProfileId);
  if (!billingProfile) {
    return { allowed: false, reason: 'Billing profile not found' };
  }

  // For now, we need to query the plan from Stripe to get allowed models
  // This would be better cached, but for simplicity we'll check against common models

  // Free tier: only gpt-4o-mini
  // Small: gpt-4o-mini, gpt-4o, claude-3-5-sonnet
  // Medium: gpt-4o-mini, gpt-4o, claude-3-5-sonnet, claude-3-opus, gemini-pro, llama-3
  // Enterprise: all models

  const modelTiers = {
    free: ['gpt-4o-mini'],
    small: ['gpt-4o-mini', 'gpt-4o', 'claude-3-5-sonnet'],
    medium: ['gpt-4o-mini', 'gpt-4o', 'claude-3-5-sonnet', 'claude-3-opus', 'gemini-pro', 'llama-3'],
    enterprise: ['all']
  };

  const allowedModels = modelTiers[billingProfile.currentPlan] || modelTiers.free;

  if (allowedModels.includes('all') || allowedModels.includes(modelName)) {
    return { allowed: true, allowedModels };
  }

  return {
    allowed: false,
    reason: `Model '${modelName}' not allowed on ${billingProfile.currentPlan} plan. Allowed models: ${allowedModels.join(', ')}`,
    allowedModels
  };
}

/**
 * Increment brand usage count
 * @param {string} workspaceId - The workspace ID
 * @returns {Promise<void>}
 */
async function incrementBrandUsage(workspaceId) {
  const workspace = await Workspace().findById(workspaceId);
  if (!workspace || !workspace.billingProfileId) {
    throw new Error('No billing profile attached to workspace');
  }

  await BillingProfile().findByIdAndUpdate(
    workspace.billingProfileId,
    { $inc: { brandsUsed: 1 }, $set: { updatedAt: new Date() } }
  );
}

/**
 * Decrement brand usage count (when deleting a brand)
 * @param {string} workspaceId - The workspace ID
 * @returns {Promise<void>}
 */
async function decrementBrandUsage(workspaceId) {
  const workspace = await Workspace().findById(workspaceId);
  if (!workspace || !workspace.billingProfileId) {
    return; // Silently fail if no billing profile
  }

  await BillingProfile().findByIdAndUpdate(
    workspace.billingProfileId,
    { $inc: { brandsUsed: -1 }, $set: { updatedAt: new Date() } }
  );
}

/**
 * Increment prompt usage count
 * @param {string} workspaceId - The workspace ID
 * @returns {Promise<void>}
 */
async function incrementPromptUsage(workspaceId) {
  const workspace = await Workspace().findById(workspaceId);
  if (!workspace || !workspace.billingProfileId) {
    throw new Error('No billing profile attached to workspace');
  }

  await BillingProfile().findByIdAndUpdate(
    workspace.billingProfileId,
    { $inc: { promptsUsed: 1 }, $set: { updatedAt: new Date() } }
  );
}

/**
 * Get current usage summary for a workspace
 * @param {string} workspaceId - The workspace ID
 * @returns {Promise<{brands: {limit: number, used: number}, prompts: {limit: number, used: number, resetDate?: Date}, plan: string}>}
 */
async function getUsageSummary(workspaceId) {
  const workspace = await Workspace().findById(workspaceId);
  if (!workspace || !workspace.billingProfileId) {
    throw new Error('No billing profile attached to workspace');
  }

  const billingProfile = await BillingProfile().findById(workspace.billingProfileId);
  if (!billingProfile) {
    throw new Error('Billing profile not found');
  }

  return {
    brands: {
      limit: billingProfile.brandsLimit,
      used: billingProfile.brandsUsed
    },
    prompts: {
      limit: billingProfile.promptsLimit,
      used: billingProfile.promptsUsed,
      resetDate: billingProfile.promptsResetDate
    },
    plan: billingProfile.currentPlan
  };
}

module.exports = {
  canCreateBrand,
  canCreatePrompt,
  canUseModel,
  incrementBrandUsage,
  decrementBrandUsage,
  incrementPromptUsage,
  getUsageSummary
};

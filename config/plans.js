/**
 * Plan Configuration
 *
 * Central configuration for all billing plans and their entitlements.
 * This serves as the source of truth that can be synced to/from Stripe.
 */

const PLAN_CONFIGS = {
  free: {
    id: 'free',
    name: 'Always Free',
    price: {
      monthly: 0,
      annual: 0
    },

    // Entitlements
    brandsLimit: 1,
    promptsLimit: 4,
    modelsLimit: 1,
    modelsSelectable: 0, // No selection - fixed model
    promptCharacterLimit: 25,
    dataRetentionDays: 30,
    jobFrequency: 'monthly',
    costBudgetMonthly: 0,

    // Allowed models for this tier (Fixed: GPT-4o-mini only)
    allowedModels: [
      'gpt-4o-mini-2024-07-18'
    ],

    // Plan metadata
    description: 'Perfect for trying out AI Rank',
    features: [
      '1 brand',
      '4 prompts per month',
      '1 AI model (GPT-4o-mini - fixed)',
      'Monthly data refresh',
      '30-day data retention'
    ]
  },

  small: {
    id: 'small',
    name: 'Small',
    price: {
      monthly: 29,
      annual: 290
    },

    // Entitlements
    brandsLimit: 4,
    promptsLimit: 10,
    modelsLimit: 3,
    modelsSelectable: 3, // Must select exactly 3
    promptCharacterLimit: 25,
    dataRetentionDays: 90,
    jobFrequency: 'daily',
    costBudgetMonthly: 5.00,

    // Selection rules
    maxProfessionalModels: 1,
    selectionRule: 'Maximum 1 Professional tier model',

    // Allowed models for this tier (Basic + Professional tier models)
    allowedModels: [
      'gpt-4o-mini-2024-07-18',
      'claude-3-5-haiku-20241022',
      'gemini-2.5-flash',
      'gpt-4o-2024-08-06',
      'claude-3-5-sonnet-20241022',
      'gemini-2.5-pro'
    ],

    // Plan metadata
    description: 'For small teams getting started',
    features: [
      '4 brands',
      '10 prompts per month',
      'Select 3 AI models',
      'Max 1 Professional tier model',
      'Daily data refresh',
      '90-day data retention',
      'Priority support'
    ]
  },

  medium: {
    id: 'medium',
    name: 'Medium',
    price: {
      monthly: 149,
      annual: 1490
    },

    // Entitlements
    brandsLimit: 10,
    promptsLimit: 20,
    modelsLimit: 6,
    modelsSelectable: 6, // Must select exactly 6
    promptCharacterLimit: 25,
    dataRetentionDays: 180,
    jobFrequency: 'daily',
    costBudgetMonthly: 60.00,

    // Selection rules
    maxExpensivePremium: 1,
    maxCheapPremium: 2,
    selectionRule: 'Max 1 expensive Premium (GPT-4.1 OR Claude Opus) OR max 2 cheap Premium (Haiku 4.5 + Flash-Lite)',
    expensivePremiumModels: [
      'gpt-4.1-2025-04-14',
      'claude-3-opus-20240229'
    ],
    cheapPremiumModels: [
      'claude-haiku-4-5',
      'gemini-2.5-flash-lite'
    ],

    // Allowed models for this tier (Basic + Professional + Select Premium models)
    allowedModels: [
      'gpt-4o-mini-2024-07-18',
      'claude-3-5-haiku-20241022',
      'gemini-2.5-flash',
      'gpt-4o-2024-08-06',
      'claude-3-5-sonnet-20241022',
      'gemini-2.5-pro',
      'gpt-4.1-2025-04-14',
      'claude-haiku-4-5',
      'claude-3-opus-20240229',
      'gemini-2.5-flash-lite'
    ],

    // Plan metadata
    description: 'For growing businesses',
    features: [
      '10 brands',
      '20 prompts per month',
      'Select 6 AI models',
      'Includes Premium tier models',
      'Daily data refresh',
      '180-day data retention',
      'Priority support',
      'Advanced analytics'
    ]
  },

  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    price: {
      monthly: 'custom',
      annual: 'custom'
    },

    // Default entitlements (can be customized per customer)
    brandsLimit: 999999,  // Unlimited
    promptsLimit: 999999,  // Unlimited
    modelsLimit: 999999,   // Unlimited
    modelsSelectable: 999999, // Unlimited selection
    promptCharacterLimit: 25,  // Default, can be customized
    dataRetentionDays: 365,
    jobFrequency: 'daily',
    costBudgetMonthly: -1, // No limit

    // Selection rules
    selectionRule: 'No limits',

    // All models allowed including enterprise-only
    allowedModels: [
      'gpt-4o-mini-2024-07-18',
      'claude-3-5-haiku-20241022',
      'gemini-2.5-flash',
      'gpt-4o-2024-08-06',
      'claude-3-5-sonnet-20241022',
      'gemini-2.5-pro',
      'gpt-4.1-2025-04-14',
      'claude-haiku-4-5',
      'claude-3-opus-20240229',
      'gemini-2.5-flash-lite',
      'gpt-4-turbo-2024-04-09',
      'gpt-4.1-mini-2025-04-14',
      'gemini-2.0-flash'
    ],

    // Plan metadata
    description: 'Custom solutions for large organizations',
    features: [
      'Unlimited brands',
      'Unlimited prompts',
      'All AI models available',
      'Unlimited model selection',
      'Custom data refresh frequency',
      'Custom data retention',
      'Dedicated support',
      'Custom integrations',
      'SLA guarantees'
    ],

    // Note: Enterprise plans can have custom limits stored in Stripe metadata
    customizable: true
  }
};

/**
 * Get plan configuration by ID
 * @param {string} planId - The plan ID (free, small, medium, enterprise)
 * @returns {Object} Plan configuration
 */
function getPlanConfig(planId) {
  return PLAN_CONFIGS[planId] || PLAN_CONFIGS.free;
}

/**
 * Get all plan configurations
 * @returns {Object} All plan configurations
 */
function getAllPlanConfigs() {
  return PLAN_CONFIGS;
}

/**
 * Get plan IDs
 * @returns {Array<string>} Array of plan IDs
 */
function getPlanIds() {
  return Object.keys(PLAN_CONFIGS);
}

/**
 * Check if plan ID is valid
 * @param {string} planId - The plan ID to check
 * @returns {boolean} True if valid
 */
function isValidPlanId(planId) {
  return PLAN_CONFIGS.hasOwnProperty(planId);
}

/**
 * Get entitlements for a plan
 * @param {string} planId - The plan ID
 * @param {Object} customOverrides - Custom overrides for enterprise plans (from Stripe metadata)
 * @returns {Object} Entitlements object
 */
function getPlanEntitlements(planId, customOverrides = {}) {
  const plan = getPlanConfig(planId);

  // For enterprise plans, allow custom overrides from Stripe metadata
  if (plan.customizable && Object.keys(customOverrides).length > 0) {
    return {
      brandsLimit: customOverrides.brandsLimit || plan.brandsLimit,
      promptsLimit: customOverrides.promptsLimit || plan.promptsLimit,
      modelsLimit: customOverrides.modelsLimit || plan.modelsLimit,
      promptCharacterLimit: customOverrides.promptCharacterLimit || plan.promptCharacterLimit,
      dataRetentionDays: customOverrides.dataRetentionDays || plan.dataRetentionDays,
      jobFrequency: customOverrides.jobFrequency || plan.jobFrequency,
      allowedModels: customOverrides.allowedModels || plan.allowedModels
    };
  }

  // Return standard plan entitlements
  return {
    brandsLimit: plan.brandsLimit,
    promptsLimit: plan.promptsLimit,
    modelsLimit: plan.modelsLimit,
    promptCharacterLimit: plan.promptCharacterLimit,
    dataRetentionDays: plan.dataRetentionDays,
    jobFrequency: plan.jobFrequency,
    allowedModels: plan.allowedModels
  };
}

module.exports = {
  PLAN_CONFIGS,
  getPlanConfig,
  getAllPlanConfigs,
  getPlanIds,
  isValidPlanId,
  getPlanEntitlements
};

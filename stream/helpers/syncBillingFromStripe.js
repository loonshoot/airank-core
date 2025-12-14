/**
 * Stripe Billing Sync Helpers
 *
 * Functions to sync billing profiles from Stripe subscription data.
 * Used by the Stripe webhook handler.
 */

/**
 * Parse plan limits from Stripe product metadata
 */
function parseProductMetadata(metadata) {
  const brandsLimit = metadata.brands_limit === 'unlimited' ? 999999 : parseInt(metadata.brands_limit, 10) || 1;
  const promptsLimit = metadata.prompts_limit === 'unlimited' ? 999999 : parseInt(metadata.prompts_limit, 10) || 4;
  const modelsLimit = metadata.models_limit === 'unlimited' ? 999999 : parseInt(metadata.models_limit, 10) || 1;
  const dataRetentionDays = metadata.data_retention_days === 'unlimited' ? 999999 : parseInt(metadata.data_retention_days, 10) || 30;
  const promptCharacterLimit = parseInt(metadata.prompt_character_limit, 10) || 150;
  const jobFrequency = metadata.batch_frequency || 'monthly';

  // Parse allowed models
  const allowedModelsStr = metadata.allowed_models || 'gpt-4o-mini-2024-07-18';
  const allowedModels = allowedModelsStr === '*' || allowedModelsStr === 'all'
    ? ['*']
    : allowedModelsStr.split(',').map(m => m.trim()).filter(Boolean);

  return {
    currentPlan: metadata.plan_id || 'free',
    brandsLimit,
    promptsLimit,
    modelsLimit,
    dataRetentionDays,
    promptCharacterLimit,
    jobFrequency,
    allowedModels
  };
}

/**
 * Sync billing profile from a Stripe subscription object
 *
 * @param {object} db - MongoDB database connection (airank database)
 * @param {string} billingProfileId - The billing profile ID to update
 * @param {object} subscription - Stripe subscription object
 * @param {object} stripe - Stripe client instance
 */
async function syncBillingFromSubscription(db, billingProfileId, subscription, stripe) {
  // Get the product ID from the subscription to fetch metadata
  const productId = subscription.items?.data?.[0]?.price?.product;

  if (!productId) {
    console.error('No product found in subscription items');
    return null;
  }

  // Fetch product from Stripe to get metadata
  const product = await stripe.products.retrieve(productId);
  const metadata = product.metadata || {};
  const entitlements = parseProductMetadata(metadata);

  // Build update fields
  const updateFields = {
    stripeSubscriptionId: subscription.id,
    planStatus: subscription.status,
    currentPlan: entitlements.currentPlan,
    brandsLimit: entitlements.brandsLimit,
    promptsLimit: entitlements.promptsLimit,
    modelsLimit: entitlements.modelsLimit,
    dataRetentionDays: entitlements.dataRetentionDays,
    promptCharacterLimit: entitlements.promptCharacterLimit,
    jobFrequency: entitlements.jobFrequency,
    allowedModels: entitlements.allowedModels,
    // Payment collection method: 'charge_automatically' (card) or 'send_invoice' (invoice)
    collectionMethod: subscription.collection_method || 'charge_automatically',
    updatedAt: new Date()
  };

  // Add period dates if available
  if (subscription.current_period_start) {
    updateFields.currentPeriodStart = new Date(subscription.current_period_start * 1000);
  }
  if (subscription.current_period_end) {
    updateFields.currentPeriodEnd = new Date(subscription.current_period_end * 1000);
  }

  // Clear payment failure fields if subscription is active
  if (subscription.status === 'active') {
    updateFields.paymentFailedAt = null;
    updateFields.gracePeriodEndsAt = null;
  }

  // Update billing profile
  await db.collection('billingprofiles').updateOne(
    { _id: billingProfileId },
    { $set: updateFields }
  );

  console.log(`✓ Synced billing profile ${billingProfileId} to plan: ${entitlements.currentPlan}, status: ${subscription.status}`);

  // Return updated profile
  return await db.collection('billingprofiles').findOne({ _id: billingProfileId });
}

/**
 * Find billing profile by Stripe customer ID
 */
async function findBillingProfileByStripeCustomer(db, stripeCustomerId) {
  return await db.collection('billingprofiles').findOne({ stripeCustomerId });
}

/**
 * Handle subscription deleted/cancelled - reset to free tier
 */
async function handleSubscriptionDeleted(db, billingProfileId) {
  const updateFields = {
    stripeSubscriptionId: null,
    currentPlan: 'free',
    planStatus: 'canceled',
    brandsLimit: 1,
    promptsLimit: 4,
    modelsLimit: 1,
    dataRetentionDays: 30,
    promptCharacterLimit: 150,
    jobFrequency: 'monthly',
    allowedModels: ['gpt-4o-mini-2024-07-18'],
    currentPeriodStart: null,
    currentPeriodEnd: null,
    updatedAt: new Date()
  };

  await db.collection('billingprofiles').updateOne(
    { _id: billingProfileId },
    { $set: updateFields }
  );

  console.log(`✓ Reset billing profile ${billingProfileId} to free tier after subscription deletion`);
  return await db.collection('billingprofiles').findOne({ _id: billingProfileId });
}

/**
 * Handle payment failure - set grace period
 */
async function handlePaymentFailed(db, billingProfileId) {
  // Get current profile to check if already in grace period
  const profile = await db.collection('billingprofiles').findOne({ _id: billingProfileId });

  // Only set grace period if not already set
  if (!profile.paymentFailedAt) {
    const gracePeriodDays = 30;
    const gracePeriodEndsAt = new Date(Date.now() + gracePeriodDays * 24 * 60 * 60 * 1000);

    await db.collection('billingprofiles').updateOne(
      { _id: billingProfileId },
      {
        $set: {
          paymentFailedAt: new Date(),
          gracePeriodEndsAt,
          updatedAt: new Date()
        }
      }
    );

    console.log(`✓ Set 30-day grace period for billing profile ${billingProfileId} ending at ${gracePeriodEndsAt}`);
  }

  return await db.collection('billingprofiles').findOne({ _id: billingProfileId });
}

/**
 * Clear payment failure after successful payment
 */
async function clearPaymentFailure(db, billingProfileId) {
  await db.collection('billingprofiles').updateOne(
    { _id: billingProfileId },
    {
      $set: {
        paymentFailedAt: null,
        gracePeriodEndsAt: null,
        updatedAt: new Date()
      }
    }
  );
  console.log(`✓ Cleared payment failure for billing profile ${billingProfileId}`);
}

module.exports = {
  parseProductMetadata,
  syncBillingFromSubscription,
  findBillingProfileByStripeCustomer,
  handleSubscriptionDeleted,
  handlePaymentFailed,
  clearPaymentFailure
};

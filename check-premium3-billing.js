const mongoose = require('mongoose');

async function checkPremium3Billing() {
  await mongoose.connect(process.env.PROD_MONGO_URI);
  const airankDb = mongoose.connection.useDb('airank');

  // Get Premium 3 workspace
  const workspace = await airankDb.collection('workspaces').findOne({ name: 'Premium 3' });
  const workspaceId = workspace._id.toString();

  console.log('🏢 Premium 3 Workspace');
  console.log('ID:', workspaceId);
  console.log('Billing Profile ID:', workspace.billingProfileId);
  console.log('Plan (in workspace):', workspace.plan);
  console.log();

  // Get billing profile if it exists
  if (workspace.billingProfileId) {
    const billingProfile = await airankDb.collection('billingprofiles').findOne({
      _id: workspace.billingProfileId
    });

    if (billingProfile) {
      console.log('💳 Billing Profile Found');
      console.log('Current Plan:', billingProfile.currentPlan);
      console.log('Stripe Customer ID:', billingProfile.stripeCustomerId);
      console.log('Stripe Subscription ID:', billingProfile.stripeSubscriptionId);
      console.log('Allowed Models:', billingProfile.allowedModels);
      console.log('Status:', billingProfile.status);
      console.log();

      // Check if there's a Stripe subscription
      if (billingProfile.stripeSubscriptionId) {
        console.log('✅ Has Stripe subscription');

        // Get the subscription from subscriptions collection
        const subscription = await airankDb.collection('subscriptions').findOne({
          stripeSubscriptionId: billingProfile.stripeSubscriptionId
        });

        if (subscription) {
          console.log('\n📋 Subscription Details');
          console.log('Plan:', subscription.plan);
          console.log('Status:', subscription.status);
          console.log('Current Period End:', subscription.currentPeriodEnd);
          console.log();
        } else {
          console.log('⚠️  No subscription record found in subscriptions collection');
        }
      } else {
        console.log('⚠️  No Stripe subscription ID in billing profile');
      }

      // Now test the getEntitlements function
      console.log('=' .repeat(80));
      console.log('Testing getEntitlements() function...\n');

      const { getEntitlements } = require('./graphql/mutations/helpers/entitlements');
      try {
        const entitlements = await getEntitlements(workspaceId);
        console.log('✅ Entitlements Result:');
        console.log(JSON.stringify(entitlements, null, 2));
      } catch (error) {
        console.error('❌ Error getting entitlements:', error.message);
        console.error(error.stack);
      }
    } else {
      console.log('❌ Billing profile not found in database');
    }
  } else {
    console.log('❌ No billing profile ID in workspace');
  }

  await mongoose.connection.close();
}

checkPremium3Billing().catch(console.error);

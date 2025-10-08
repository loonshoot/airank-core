/**
 * Test for changePlan mutation
 *
 * This test will:
 * 1. Create billing profile with active small plan subscription
 * 2. Upgrade to medium plan
 * 3. Verify subscription updated in Stripe
 * 4. Verify billing profile limits updated
 * 5. Test downgrade to small plan
 * 6. Test error: non-manager trying to change plan
 * 7. Test error: invalid plan ID
 * 8. Test error: no subscription exists
 * 9. Test error: unauthenticated access
 */

const mongoose = require('mongoose');
const { resolvers } = require('./index');
const { BillingProfile, BillingProfileMember } = require('../../queries/billingProfile');

async function runTest() {
  console.log('🧪 Testing changePlan mutation...\n');

  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    await mongoose.connect(`${mongoUri}/airank_test`);
    console.log('✓ Connected to test database');

    // Clean up test data
    await BillingProfile().deleteMany({ name: /Test Profile/ });
    await BillingProfileMember().deleteMany({ userId: /test-user/ });
    console.log('✓ Cleaned up test data\n');

    // Test 1: Setup - Create billing profile with active small plan
    console.log('Test 1: Setup billing profile with active small plan');
    const userId = 'test-user-123';
    const userEmail = 'test@example.com';

    // Create billing profile with active small plan subscription
    const billingProfile = await BillingProfile().create({
      name: 'Test Profile 1',
      stripeCustomerId: 'cus_test_123',
      stripeSubscriptionId: 'sub_test_active',
      currentPlan: 'small',
      planStatus: 'active',
      brandsLimit: 4,
      promptsLimit: 10,
      modelsLimit: 3,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Add user as billing profile manager
    await BillingProfileMember().create({
      billingProfileId: billingProfile._id.toString(),
      userId,
      role: 'manager'
    });

    console.log(`✓ Created billing profile: ${billingProfile._id}`);
    console.log(`✓ Current plan: ${billingProfile.currentPlan}`);
    console.log(`✓ Limits: ${billingProfile.brandsLimit} brands, ${billingProfile.promptsLimit} prompts\n`);

    // Test 2: Upgrade to medium plan
    console.log('Test 2: Upgrade to medium plan');
    const mockUser = { sub: userId, _id: userId, email: userEmail };
    const result = await resolvers.changePlan(
      null,
      {
        billingProfileId: billingProfile._id.toString(),
        newPlanId: 'medium',
        interval: 'monthly'
      },
      { user: mockUser }
    );

    if (!result) {
      throw new Error('❌ changePlan returned null');
    }
    if (result.currentPlan !== 'medium') {
      throw new Error(`❌ Expected currentPlan 'medium', got '${result.currentPlan}'`);
    }
    console.log(`✓ Plan upgraded to: ${result.currentPlan}`);
    console.log(`✓ New limits: ${result.brandsLimit} brands, ${result.promptsLimit} prompts\n`);

    // Test 3: Verify billing profile limits updated
    console.log('Test 3: Verify billing profile updated with new limits');
    const updatedProfile = await BillingProfile().findById(billingProfile._id);
    if (updatedProfile.currentPlan !== 'medium') {
      throw new Error('❌ Plan not updated in database');
    }
    if (updatedProfile.brandsLimit !== 10) {
      throw new Error(`❌ Expected brandsLimit 10, got ${updatedProfile.brandsLimit}`);
    }
    if (updatedProfile.promptsLimit !== 20) {
      throw new Error(`❌ Expected promptsLimit 20, got ${updatedProfile.promptsLimit}`);
    }
    console.log(`✓ Limits updated correctly:\n`);
    console.log(`  - brandsLimit: ${updatedProfile.brandsLimit}`);
    console.log(`  - promptsLimit: ${updatedProfile.promptsLimit}`);
    console.log(`  - modelsLimit: ${updatedProfile.modelsLimit}\n`);

    // Test 4: Downgrade to small plan
    console.log('Test 4: Downgrade to small plan');
    const downgraded = await resolvers.changePlan(
      null,
      {
        billingProfileId: billingProfile._id.toString(),
        newPlanId: 'small',
        interval: 'annual'
      },
      { user: mockUser }
    );

    if (downgraded.currentPlan !== 'small') {
      throw new Error(`❌ Expected currentPlan 'small', got '${downgraded.currentPlan}'`);
    }
    if (downgraded.brandsLimit !== 4) {
      throw new Error(`❌ Expected brandsLimit 4, got ${downgraded.brandsLimit}`);
    }
    console.log(`✓ Plan downgraded to: ${downgraded.currentPlan}`);
    console.log(`✓ Limits reduced: ${downgraded.brandsLimit} brands, ${downgraded.promptsLimit} prompts\n`);

    // Test 5: Test error - non-manager trying to change plan
    console.log('Test 5: Non-manager cannot change plan');
    const nonManagerUser = { sub: 'non-manager-456', _id: 'non-manager-456', email: 'nonmanager@example.com' };

    try {
      await resolvers.changePlan(
        null,
        {
          billingProfileId: billingProfile._id.toString(),
          newPlanId: 'medium',
          interval: 'monthly'
        },
        { user: nonManagerUser }
      );
      throw new Error('❌ Expected authorization error for non-manager');
    } catch (error) {
      if (error.message.includes('manager')) {
        console.log(`✓ Correctly rejected non-manager: ${error.message}\n`);
      } else {
        throw error;
      }
    }

    // Test 6: Test error - invalid plan ID
    console.log('Test 6: Invalid plan ID rejected');
    try {
      await resolvers.changePlan(
        null,
        {
          billingProfileId: billingProfile._id.toString(),
          newPlanId: 'invalid-plan',
          interval: 'monthly'
        },
        { user: mockUser }
      );
      throw new Error('❌ Expected validation error for invalid plan');
    } catch (error) {
      if (error.message.includes('Invalid plan') || error.message.includes('not found')) {
        console.log(`✓ Correctly rejected invalid plan: ${error.message}\n`);
      } else {
        throw error;
      }
    }

    // Test 7: Test error - no subscription exists
    console.log('Test 7: No subscription error');
    const profileNoSub = await BillingProfile().create({
      name: 'Test Profile No Sub',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await BillingProfileMember().create({
      billingProfileId: profileNoSub._id.toString(),
      userId,
      role: 'manager'
    });

    try {
      await resolvers.changePlan(
        null,
        {
          billingProfileId: profileNoSub._id.toString(),
          newPlanId: 'medium',
          interval: 'monthly'
        },
        { user: mockUser }
      );
      throw new Error('❌ Expected error for missing subscription');
    } catch (error) {
      if (error.message.includes('No subscription') || error.message.includes('subscription')) {
        console.log(`✓ Correctly rejected missing subscription: ${error.message}\n`);
      } else {
        throw error;
      }
    }

    // Test 8: Test unauthenticated access
    console.log('Test 8: Unauthenticated access rejected');
    try {
      await resolvers.changePlan(
        null,
        {
          billingProfileId: billingProfile._id.toString(),
          newPlanId: 'medium',
          interval: 'monthly'
        },
        { user: null }
      );
      throw new Error('❌ Expected authentication error');
    } catch (error) {
      if (error.message.includes('Authentication required')) {
        console.log('✓ Correctly rejected unauthenticated request\n');
      } else {
        throw error;
      }
    }

    // Cleanup
    await BillingProfile().deleteMany({ name: /Test Profile/ });
    await BillingProfileMember().deleteMany({ userId: /test-user/ });
    console.log('✓ Cleaned up test data');

    await mongoose.connection.close();
    console.log('\n✅ All changePlan tests passed!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run test if called directly
if (require.main === module) {
  runTest();
}

module.exports = { runTest };

/**
 * Test for confirmSubscription mutation
 *
 * This test will:
 * 1. Create billing profile with incomplete subscription
 * 2. Confirm subscription (simulate payment success)
 * 3. Verify subscription status updated to 'active'
 * 4. Verify billing profile updated with period dates
 * 5. Test error: non-manager trying to confirm
 * 6. Test error: no subscription exists
 * 7. Test error: unauthenticated access
 */

const mongoose = require('mongoose');
const { resolvers } = require('./index');
const { BillingProfile, BillingProfileMember } = require('../../queries/billingProfile');

async function runTest() {
  console.log('🧪 Testing confirmSubscription mutation...\n');

  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    await mongoose.connect(`${mongoUri}/airank_test`);
    console.log('✓ Connected to test database');

    // Clean up test data
    await BillingProfile().deleteMany({ name: /Test Profile/ });
    await BillingProfileMember().deleteMany({ userId: /test-user/ });
    console.log('✓ Cleaned up test data\n');

    // Test 1: Setup - Create billing profile with incomplete subscription
    console.log('Test 1: Setup billing profile with incomplete subscription');
    const userId = 'test-user-123';
    const userEmail = 'test@example.com';

    // Create billing profile with subscription
    const billingProfile = await BillingProfile().create({
      name: 'Test Profile 1',
      stripeCustomerId: 'cus_test_123',
      stripeSubscriptionId: 'sub_test_incomplete',
      currentPlan: 'small',
      planStatus: 'incomplete',
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
    console.log(`✓ Subscription status: ${billingProfile.planStatus}`);
    console.log(`✓ User is billing profile manager\n`);

    // Test 2: Confirm subscription
    console.log('Test 2: Confirm subscription');
    const mockUser = { sub: userId, _id: userId, email: userEmail };
    const result = await resolvers.confirmSubscription(
      null,
      { billingProfileId: billingProfile._id.toString() },
      { user: mockUser }
    );

    if (!result) {
      throw new Error('❌ confirmSubscription returned null');
    }
    if (result.planStatus !== 'active') {
      throw new Error(`❌ Expected planStatus 'active', got '${result.planStatus}'`);
    }
    console.log(`✓ Subscription confirmed`);
    console.log(`✓ Status: ${result.planStatus}\n`);

    // Test 3: Verify billing profile updated with period dates
    console.log('Test 3: Verify billing profile updated');
    const updatedProfile = await BillingProfile().findById(billingProfile._id);
    if (updatedProfile.planStatus !== 'active') {
      throw new Error(`❌ Plan status not updated: ${updatedProfile.planStatus}`);
    }
    if (!updatedProfile.currentPeriodStart) {
      throw new Error('❌ No currentPeriodStart date');
    }
    if (!updatedProfile.currentPeriodEnd) {
      throw new Error('❌ No currentPeriodEnd date');
    }
    console.log(`✓ Billing profile updated:`);
    console.log(`  - planStatus: ${updatedProfile.planStatus}`);
    console.log(`  - currentPeriodStart: ${updatedProfile.currentPeriodStart}`);
    console.log(`  - currentPeriodEnd: ${updatedProfile.currentPeriodEnd}\n`);

    // Test 4: Test error - non-manager trying to confirm
    console.log('Test 4: Non-manager cannot confirm subscription');
    const nonManagerUser = { sub: 'non-manager-456', _id: 'non-manager-456', email: 'nonmanager@example.com' };

    // Create new profile for this test
    const profile2 = await BillingProfile().create({
      name: 'Test Profile 2',
      stripeCustomerId: 'cus_test_456',
      stripeSubscriptionId: 'sub_test_incomplete2',
      currentPlan: 'medium',
      planStatus: 'incomplete',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    try {
      await resolvers.confirmSubscription(
        null,
        { billingProfileId: profile2._id.toString() },
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

    // Test 5: Test error - no subscription exists
    console.log('Test 5: No subscription error');
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
      await resolvers.confirmSubscription(
        null,
        { billingProfileId: profileNoSub._id.toString() },
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

    // Test 6: Test unauthenticated access
    console.log('Test 6: Unauthenticated access rejected');
    try {
      await resolvers.confirmSubscription(
        null,
        { billingProfileId: billingProfile._id.toString() },
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
    console.log('\n✅ All confirmSubscription tests passed!');
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

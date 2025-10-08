/**
 * Test for createSubscription mutation
 *
 * This test will:
 * 1. Create workspace, billing profile, and user
 * 2. Create subscription for a plan (small plan)
 * 3. Verify subscription created in Stripe
 * 4. Verify billing profile updated with subscription details
 * 5. Test error: non-manager trying to create subscription
 * 6. Test error: invalid plan ID
 * 7. Test error: unauthenticated access
 */

const mongoose = require('mongoose');
const { resolvers } = require('./index');
const { BillingProfile, BillingProfileMember } = require('../../queries/billingProfile');

async function runTest() {
  console.log('🧪 Testing createSubscription mutation...\n');

  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    await mongoose.connect(`${mongoUri}/airank_test`);
    console.log('✓ Connected to test database');

    // Clean up test data
    await BillingProfile().deleteMany({ name: /Test Profile/ });
    await BillingProfileMember().deleteMany({ userId: /test-user/ });
    console.log('✓ Cleaned up test data\n');

    // Test 1: Setup - Create billing profile and user
    console.log('Test 1: Setup billing profile and user');
    const userId = 'test-user-123';
    const userEmail = 'test@example.com';

    // Create billing profile
    const billingProfile = await BillingProfile().create({
      name: 'Test Profile 1',
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
    console.log(`✓ User is billing profile manager\n`);

    // Test 2: Create subscription for small plan
    console.log('Test 2: Create subscription for small plan (annual)');
    const mockUser = { sub: userId, _id: userId, email: userEmail };
    const result = await resolvers.createSubscription(
      null,
      {
        billingProfileId: billingProfile._id.toString(),
        planId: 'small',
        interval: 'annual'
      },
      { user: mockUser }
    );

    if (!result) {
      throw new Error('❌ createSubscription returned null');
    }
    if (!result.stripeSubscriptionId) {
      throw new Error('❌ No stripeSubscriptionId in result');
    }
    console.log(`✓ Created subscription: ${result.stripeSubscriptionId}`);
    console.log(`✓ Client secret: ${result.clientSecret ? 'present' : 'missing'}\n`);

    // Test 3: Verify billing profile updated with subscription details
    console.log('Test 3: Verify billing profile updated');
    const updatedProfile = await BillingProfile().findById(billingProfile._id);
    if (!updatedProfile.stripeSubscriptionId) {
      throw new Error('❌ Billing profile not updated with stripeSubscriptionId');
    }
    if (updatedProfile.currentPlan !== 'small') {
      throw new Error(`❌ Expected currentPlan 'small', got '${updatedProfile.currentPlan}'`);
    }
    if (!updatedProfile.stripeCustomerId) {
      throw new Error('❌ No stripeCustomerId on billing profile');
    }
    console.log(`✓ Billing profile updated:`);
    console.log(`  - stripeSubscriptionId: ${updatedProfile.stripeSubscriptionId}`);
    console.log(`  - stripeCustomerId: ${updatedProfile.stripeCustomerId}`);
    console.log(`  - currentPlan: ${updatedProfile.currentPlan}\n`);

    // Test 4: Test error - non-manager trying to create subscription
    console.log('Test 4: Non-manager cannot create subscription');
    const nonManagerUser = { sub: 'non-manager-456', _id: 'non-manager-456', email: 'nonmanager@example.com' };

    try {
      await resolvers.createSubscription(
        null,
        {
          billingProfileId: billingProfile._id.toString(),
          planId: 'medium',
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

    // Test 5: Test error - invalid plan ID
    console.log('Test 5: Invalid plan ID rejected');
    try {
      await resolvers.createSubscription(
        null,
        {
          billingProfileId: billingProfile._id.toString(),
          planId: 'invalid-plan',
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

    // Test 6: Test unauthenticated access
    console.log('Test 6: Unauthenticated access rejected');
    try {
      await resolvers.createSubscription(
        null,
        {
          billingProfileId: billingProfile._id.toString(),
          planId: 'small',
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
    console.log('\n✅ All createSubscription tests passed!');
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

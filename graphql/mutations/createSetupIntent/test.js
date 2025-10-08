/**
 * Test for createSetupIntent mutation
 *
 * This test will:
 * 1. Create billing profile and user
 * 2. Create setup intent for adding payment method
 * 3. Verify setup intent has client secret
 * 4. Test error: non-manager trying to create setup intent
 * 5. Test error: unauthenticated access
 */

const mongoose = require('mongoose');
const { resolvers } = require('./index');
const { BillingProfile, BillingProfileMember } = require('../../queries/billingProfile');

async function runTest() {
  console.log('🧪 Testing createSetupIntent mutation...\n');

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
      stripeCustomerId: 'cus_test_123',
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

    // Test 2: Create setup intent
    console.log('Test 2: Create setup intent');
    const mockUser = { sub: userId, _id: userId, email: userEmail };
    const result = await resolvers.createSetupIntent(
      null,
      { billingProfileId: billingProfile._id.toString() },
      { user: mockUser }
    );

    if (!result) {
      throw new Error('❌ createSetupIntent returned null');
    }
    if (!result.clientSecret) {
      throw new Error('❌ No clientSecret in result');
    }
    console.log(`✓ Setup intent created`);
    console.log(`✓ Client secret: ${result.clientSecret.substring(0, 20)}...\n`);

    // Test 3: Verify Stripe customer created if didn't exist
    console.log('Test 3: Create setup intent without existing Stripe customer');
    const profile2 = await BillingProfile().create({
      name: 'Test Profile 2',
      // No stripeCustomerId
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await BillingProfileMember().create({
      billingProfileId: profile2._id.toString(),
      userId,
      role: 'manager'
    });

    const result2 = await resolvers.createSetupIntent(
      null,
      { billingProfileId: profile2._id.toString() },
      { user: mockUser }
    );

    if (!result2.clientSecret) {
      throw new Error('❌ No clientSecret when creating customer');
    }

    // Verify customer was created
    const updatedProfile2 = await BillingProfile().findById(profile2._id);
    if (!updatedProfile2.stripeCustomerId) {
      throw new Error('❌ Stripe customer not created');
    }
    console.log(`✓ Stripe customer created: ${updatedProfile2.stripeCustomerId}`);
    console.log(`✓ Setup intent created\n`);

    // Test 4: Test error - non-manager trying to create setup intent
    console.log('Test 4: Non-manager cannot create setup intent');
    const nonManagerUser = { sub: 'non-manager-456', _id: 'non-manager-456', email: 'nonmanager@example.com' };

    try {
      await resolvers.createSetupIntent(
        null,
        { billingProfileId: billingProfile._id.toString() },
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

    // Test 5: Test unauthenticated access
    console.log('Test 5: Unauthenticated access rejected');
    try {
      await resolvers.createSetupIntent(
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
    console.log('\n✅ All createSetupIntent tests passed!');
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

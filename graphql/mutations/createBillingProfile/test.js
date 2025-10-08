/**
 * Test for createBillingProfile mutation
 *
 * This test will:
 * 1. Create a billing profile via mutation
 * 2. Verify Stripe customer is created
 * 3. Verify user is added as manager
 * 4. Test error handling (unauthenticated)
 */

const mongoose = require('mongoose');
const { resolvers } = require('./index');
const { BillingProfile, BillingProfileMember } = require('../../queries/billingProfile');

// Mock Stripe for testing
const mockStripe = {
  customers: {
    create: async ({ name, metadata }) => {
      console.log(`  [Mock Stripe] Creating customer: ${name}`);
      return {
        id: `cus_test_${Date.now()}`,
        name,
        metadata
      };
    }
  }
};

async function runTest() {
  console.log('🧪 Testing createBillingProfile mutation...\n');

  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    await mongoose.connect(`${mongoUri}/airank_test`);
    console.log('✓ Connected to test database');

    // Clean up test data
    await BillingProfile().deleteMany({ name: /Test Billing Profile/ });
    await BillingProfileMember().deleteMany({ userId: /test-user/ });
    console.log('✓ Cleaned up test data\n');

    // Test 1: Create billing profile with valid user
    console.log('Test 1: Create billing profile with authenticated user');
    const mockUser = { sub: 'test-user-123', _id: 'test-user-123', email: 'test@example.com' };

    const createdProfile = await resolvers.createBillingProfile(
      null,
      {
        name: 'Test Billing Profile 1',
        workspaceId: 'workspace-123'
      },
      { user: mockUser }
    );

    if (!createdProfile) {
      throw new Error('❌ createBillingProfile returned null');
    }
    if (createdProfile.name !== 'Test Billing Profile 1') {
      throw new Error(`❌ Expected name 'Test Billing Profile 1', got '${createdProfile.name}'`);
    }
    console.log(`✓ Created billing profile: ${createdProfile._id}`);
    console.log(`  Name: ${createdProfile.name}\n`);

    // Test 2: Verify user is added as manager
    console.log('Test 2: Verify user added as manager');
    const member = await BillingProfileMember().findOne({
      billingProfileId: createdProfile._id.toString(),
      userId: mockUser.sub
    });

    if (!member) {
      throw new Error('❌ User not added as billing profile member');
    }
    if (member.role !== 'manager') {
      throw new Error(`❌ Expected role 'manager', got '${member.role}'`);
    }
    console.log(`✓ User added as manager\n`);

    // Test 3: Verify Stripe customer was created
    console.log('Test 3: Verify Stripe customer ID present');
    if (!createdProfile.stripeCustomerId) {
      throw new Error('❌ Stripe customer ID not set');
    }
    if (!createdProfile.stripeCustomerId.startsWith('cus_')) {
      throw new Error(`❌ Invalid Stripe customer ID format: ${createdProfile.stripeCustomerId}`);
    }
    console.log(`✓ Stripe customer created: ${createdProfile.stripeCustomerId}\n`);

    // Test 4: Verify default values
    console.log('Test 4: Verify default limit values');
    if (createdProfile.currentPlan !== 'free') {
      throw new Error(`❌ Expected currentPlan='free', got '${createdProfile.currentPlan}'`);
    }
    if (createdProfile.brandsLimit !== 1) {
      throw new Error(`❌ Expected brandsLimit=1, got ${createdProfile.brandsLimit}`);
    }
    if (createdProfile.promptsLimit !== 4) {
      throw new Error(`❌ Expected promptsLimit=4, got ${createdProfile.promptsLimit}`);
    }
    if (createdProfile.modelsLimit !== 1) {
      throw new Error(`❌ Expected modelsLimit=1, got ${createdProfile.modelsLimit}`);
    }
    console.log(`✓ Default limits correct: ${createdProfile.promptsLimit} prompts, ${createdProfile.brandsLimit} brand, ${createdProfile.modelsLimit} model\n`);

    // Test 5: Test unauthenticated access
    console.log('Test 5: Test unauthenticated access');
    try {
      await resolvers.createBillingProfile(
        null,
        { name: 'Test Profile 2' },
        { user: null }
      );
      throw new Error('❌ Expected authentication error, but mutation succeeded');
    } catch (error) {
      if (error.message.includes('Authentication required')) {
        console.log('✓ Correctly rejected unauthenticated request\n');
      } else {
        throw error;
      }
    }

    // Test 6: Create another profile for same user
    console.log('Test 6: User can create multiple billing profiles');
    const secondProfile = await resolvers.createBillingProfile(
      null,
      { name: 'Test Billing Profile 2' },
      { user: mockUser }
    );

    if (!secondProfile) {
      throw new Error('❌ Failed to create second billing profile');
    }
    console.log(`✓ Created second billing profile: ${secondProfile._id}\n`);

    // Verify user is manager of both profiles
    const memberCount = await BillingProfileMember().countDocuments({
      userId: mockUser.sub,
      role: 'manager'
    });
    if (memberCount !== 2) {
      throw new Error(`❌ Expected user to be manager of 2 profiles, found ${memberCount}`);
    }
    console.log(`✓ User is manager of ${memberCount} profiles\n`);

    // Cleanup
    await BillingProfile().deleteMany({ name: /Test Billing Profile/ });
    await BillingProfileMember().deleteMany({ userId: /test-user/ });
    console.log('✓ Cleaned up test data');

    await mongoose.connection.close();
    console.log('\n✅ All createBillingProfile tests passed!');
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

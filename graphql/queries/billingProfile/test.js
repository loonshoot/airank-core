/**
 * Test for BillingProfile GraphQL queries
 *
 * This test will:
 * 1. Create a test billing profile
 * 2. Create a test user and add them as a member
 * 3. Query billingProfiles - should return the profile
 * 4. Query billingProfile by ID - should return the specific profile
 * 5. Verify usage tracking fields are present and correct
 * 6. Test unauthorized access (user not a member)
 */

const mongoose = require('mongoose');
const { resolvers, BillingProfile, BillingProfileMember } = require('./index');

async function runTest() {
  console.log('🧪 Testing BillingProfile GraphQL queries...\n');

  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    await mongoose.connect(`${mongoUri}/airank_test`);
    console.log('✓ Connected to test database');

    // Clean up test data
    await BillingProfile().deleteMany({ name: /Test Profile/ });
    await BillingProfileMember().deleteMany({ userId: /test-user/ });
    console.log('✓ Cleaned up test data\n');

    // Test 1: Create a test billing profile
    console.log('Test 1: Create billing profile');
    const testProfile = await BillingProfile().create({
      name: 'Test Profile 1',
      currentPlan: 'free',
      brandsLimit: 1,
      brandsUsed: 0,
      promptsLimit: 4,
      promptsUsed: 2,
      modelsLimit: 1,
      dataRetentionDays: 30,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    console.log(`✓ Created test profile: ${testProfile._id}\n`);

    // Test 2: Add user as member
    console.log('Test 2: Add user as billing profile member');
    const testMember = await BillingProfileMember().create({
      billingProfileId: testProfile._id.toString(),
      userId: 'test-user-123',
      role: 'manager'
    });
    console.log(`✓ Added member with role: ${testMember.role}\n`);

    // Test 3: Query billingProfiles (should return the profile)
    console.log('Test 3: Query billingProfiles as authenticated user');
    const mockUser = { sub: 'test-user-123', _id: 'test-user-123' };
    const profiles = await resolvers.billingProfiles(
      null,
      {},
      { user: mockUser }
    );

    if (profiles.length === 0) {
      throw new Error('❌ Expected to find billing profiles, but got none');
    }
    console.log(`✓ Found ${profiles.length} profile(s)`);

    const foundProfile = profiles[0];
    if (foundProfile.name !== 'Test Profile 1') {
      throw new Error(`❌ Expected profile name 'Test Profile 1', got '${foundProfile.name}'`);
    }
    console.log(`✓ Profile name matches: ${foundProfile.name}`);

    // Verify usage tracking fields
    if (foundProfile.promptsUsed !== 2) {
      throw new Error(`❌ Expected promptsUsed=2, got ${foundProfile.promptsUsed}`);
    }
    if (foundProfile.promptsLimit !== 4) {
      throw new Error(`❌ Expected promptsLimit=4, got ${foundProfile.promptsLimit}`);
    }
    console.log(`✓ Usage tracking correct: ${foundProfile.promptsUsed}/${foundProfile.promptsLimit} prompts used\n`);

    // Test 4: Query specific billing profile by ID
    console.log('Test 4: Query billingProfile by ID');
    const specificProfile = await resolvers.billingProfile(
      null,
      { billingProfileId: testProfile._id.toString() },
      { user: mockUser }
    );

    if (!specificProfile) {
      throw new Error('❌ Expected to find specific profile, but got none');
    }
    if (specificProfile.name !== 'Test Profile 1') {
      throw new Error(`❌ Expected profile name 'Test Profile 1', got '${specificProfile.name}'`);
    }
    console.log(`✓ Found specific profile: ${specificProfile.name}\n`);

    // Test 5: Test unauthorized access
    console.log('Test 5: Test unauthorized access');
    const unauthorizedUser = { sub: 'different-user-456', _id: 'different-user-456' };
    try {
      await resolvers.billingProfile(
        null,
        { billingProfileId: testProfile._id.toString() },
        { user: unauthorizedUser }
      );
      throw new Error('❌ Expected authorization error, but query succeeded');
    } catch (error) {
      if (error.message.includes('Unauthorized')) {
        console.log('✓ Correctly rejected unauthorized access\n');
      } else {
        throw error;
      }
    }

    // Test 6: Test unauthenticated access
    console.log('Test 6: Test unauthenticated access');
    try {
      await resolvers.billingProfiles(null, {}, { user: null });
      throw new Error('❌ Expected authentication error, but query succeeded');
    } catch (error) {
      if (error.message.includes('not authenticated')) {
        console.log('✓ Correctly rejected unauthenticated access\n');
      } else {
        throw error;
      }
    }

    // Cleanup
    await BillingProfile().deleteMany({ name: /Test Profile/ });
    await BillingProfileMember().deleteMany({ userId: /test-user/ });
    console.log('✓ Cleaned up test data');

    await mongoose.connection.close();
    console.log('\n✅ All BillingProfile tests passed!');
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

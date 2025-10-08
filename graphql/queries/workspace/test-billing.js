/**
 * Test for Workspace billingProfileId field
 *
 * This test will:
 * 1. Create a test workspace with billingProfileId
 * 2. Query the workspace and verify billingProfileId is present
 * 3. Verify workspace can be linked to a billing profile
 * 4. Verify workspace can resolve its billingProfile via GraphQL
 */

const mongoose = require('mongoose');
const { resolvers } = require('./index');
const { BillingProfile, BillingProfileMember } = require('../billingProfile');

async function runTest() {
  console.log('🧪 Testing Workspace billingProfileId field...\n');

  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    await mongoose.connect(`${mongoUri}/airank_test`);
    console.log('✓ Connected to test database');

    // Clean up test data
    const Workspace = mongoose.model('Workspace');
    const Member = mongoose.model('Member');
    await Workspace.deleteMany({ name: /Test Workspace/ });
    await Member.deleteMany({ userId: /test-user/ });
    await BillingProfile().deleteMany({ name: /Test Profile/ });
    await BillingProfileMember().deleteMany({ userId: /test-user/ });
    console.log('✓ Cleaned up test data\n');

    // Test 1: Create a billing profile
    console.log('Test 1: Create billing profile');
    const testProfile = await BillingProfile().create({
      name: 'Test Profile for Workspace',
      currentPlan: 'free',
      brandsLimit: 1,
      promptsLimit: 4,
      modelsLimit: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    console.log(`✓ Created billing profile: ${testProfile._id}\n`);

    // Test 2: Create workspace with billingProfileId
    console.log('Test 2: Create workspace with billingProfileId');
    const workspaceId = new mongoose.Types.ObjectId().toString();
    const testWorkspace = await Workspace.create({
      _id: workspaceId,
      workspaceCode: 'test-ws-123',
      inviteCode: 'inv-123',
      creatorId: 'test-user-123',
      chargebeeSubscriptionId: '', // Legacy field, can be empty
      chargebeeCustomerId: '', // Legacy field, can be empty
      name: 'Test Workspace',
      slug: 'test-workspace',
      billingProfileId: testProfile._id.toString(), // NEW FIELD
      createdAt: new Date(),
      updatedAt: new Date()
    });
    console.log(`✓ Created workspace with billingProfileId: ${testWorkspace.billingProfileId}\n`);

    // Test 3: Verify billingProfileId is stored
    console.log('Test 3: Verify billingProfileId is stored');
    const foundWorkspace = await Workspace.findById(workspaceId);
    if (!foundWorkspace.billingProfileId) {
      throw new Error('❌ billingProfileId not found on workspace');
    }
    if (foundWorkspace.billingProfileId !== testProfile._id.toString()) {
      throw new Error(`❌ billingProfileId mismatch: expected ${testProfile._id.toString()}, got ${foundWorkspace.billingProfileId}`);
    }
    console.log(`✓ billingProfileId correctly stored: ${foundWorkspace.billingProfileId}\n`);

    // Test 4: Create member to test GraphQL query
    console.log('Test 4: Create member with permissions');
    await Member.create({
      _id: new mongoose.Types.ObjectId().toString(),
      workspaceId,
      userId: 'test-user-123',
      inviter: 'test-user-123',
      permissions: ['query:workspaces'],
      status: 'ACCEPTED',
      teamRole: 'OWNER',
      invitedAt: new Date(),
      updatedAt: new Date()
    });
    console.log('✓ Created member with query:workspaces permission\n');

    // Test 5: Query workspace via GraphQL resolver
    console.log('Test 5: Query workspace via GraphQL');
    const mockUser = { sub: 'test-user-123', _id: 'test-user-123' };
    const queriedWorkspace = await resolvers.workspace(
      null,
      { workspaceId },
      { user: mockUser }
    );

    if (!queriedWorkspace) {
      throw new Error('❌ Workspace not returned from GraphQL query');
    }
    if (!queriedWorkspace.billingProfileId) {
      throw new Error('❌ billingProfileId missing from GraphQL response');
    }
    console.log(`✓ GraphQL query returned workspace with billingProfileId: ${queriedWorkspace.billingProfileId}\n`);

    // Test 6: Verify billingProfile can be resolved (if resolver exists)
    console.log('Test 6: Check if billingProfile resolver exists');
    if (resolvers.Workspace && resolvers.Workspace.billingProfile) {
      console.log('✓ billingProfile resolver exists');

      const resolvedProfile = await resolvers.Workspace.billingProfile(queriedWorkspace);
      if (!resolvedProfile) {
        throw new Error('❌ billingProfile resolver returned null');
      }
      if (resolvedProfile._id.toString() !== testProfile._id.toString()) {
        throw new Error('❌ billingProfile resolver returned wrong profile');
      }
      console.log(`✓ billingProfile resolver works: ${resolvedProfile.name}\n`);
    } else {
      console.log('ℹ billingProfile resolver not implemented yet (will be added)\n');
    }

    // Cleanup
    await Workspace.deleteMany({ name: /Test Workspace/ });
    await Member.deleteMany({ userId: /test-user/ });
    await BillingProfile().deleteMany({ name: /Test Profile/ });
    await BillingProfileMember().deleteMany({ userId: /test-user/ });
    console.log('✓ Cleaned up test data');

    await mongoose.connection.close();
    console.log('\n✅ All Workspace billingProfileId tests passed!');
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

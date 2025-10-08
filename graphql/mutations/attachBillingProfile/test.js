/**
 * Test for attachBillingProfile mutation
 *
 * This test will:
 * 1. Create workspace and billing profile
 * 2. Attach billing profile to workspace (as workspace owner + billing manager)
 * 3. Verify attachment
 * 4. Test error: non-owner trying to attach
 * 5. Test error: non-manager trying to attach
 * 6. Test switching billing profiles
 */

const mongoose = require('mongoose');
const { resolvers } = require('./index');
const { BillingProfile, BillingProfileMember } = require('../../queries/billingProfile');
const { Workspace } = require('../../queries/workspace');
const { Member } = require('../../queries/member');

async function runTest() {
  console.log('🧪 Testing attachBillingProfile mutation...\n');

  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    await mongoose.connect(`${mongoUri}/airank_test`);
    console.log('✓ Connected to test database');

    // Clean up test data
    await Workspace().deleteMany({ name: /Test Workspace/ });
    await Member.deleteMany({ userId: /test-user/ });
    await BillingProfile().deleteMany({ name: /Test Profile/ });
    await BillingProfileMember().deleteMany({ userId: /test-user/ });
    console.log('✓ Cleaned up test data\n');

    // Test 1: Setup - Create workspace, billing profile, and user
    console.log('Test 1: Setup workspace, billing profile, and user');
    const workspaceId = new mongoose.Types.ObjectId().toString();
    const userId = 'test-user-123';

    // Create workspace
    await Workspace().create({
      _id: workspaceId,
      workspaceCode: 'test-ws-123',
      inviteCode: 'inv-123',
      creatorId: userId,
      name: 'Test Workspace 1',
      slug: 'test-workspace-1',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Create member as OWNER
    await Member.create({
      _id: new mongoose.Types.ObjectId().toString(),
      workspaceId,
      userId,
      inviter: userId,
      permissions: ['query:workspaces'],
      status: 'ACCEPTED',
      teamRole: 'OWNER',
      invitedAt: new Date(),
      updatedAt: new Date()
    });

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

    console.log(`✓ Created workspace: ${workspaceId}`);
    console.log(`✓ Created billing profile: ${billingProfile._id}`);
    console.log(`✓ User is workspace OWNER and billing profile manager\n`);

    // Test 2: Attach billing profile to workspace
    console.log('Test 2: Attach billing profile to workspace');
    const mockUser = { sub: userId, _id: userId };
    const result = await resolvers.attachBillingProfile(
      null,
      {
        workspaceId,
        billingProfileId: billingProfile._id.toString()
      },
      { user: mockUser }
    );

    if (!result) {
      throw new Error('❌ attachBillingProfile returned null');
    }
    if (result.billingProfileId !== billingProfile._id.toString()) {
      throw new Error(`❌ Expected billingProfileId ${billingProfile._id}, got ${result.billingProfileId}`);
    }
    console.log(`✓ Attached billing profile to workspace\n`);

    // Test 3: Verify attachment in database
    console.log('Test 3: Verify attachment persisted');
    const updatedWorkspace = await Workspace().findById(workspaceId);
    if (updatedWorkspace.billingProfileId !== billingProfile._id.toString()) {
      throw new Error('❌ Billing profile not attached in database');
    }
    console.log(`✓ Billing profile persisted: ${updatedWorkspace.billingProfileId}\n`);

    // Test 4: Test error - non-owner trying to attach
    console.log('Test 4: Non-owner cannot attach billing profile');
    const nonOwnerUser = { sub: 'non-owner-456', _id: 'non-owner-456' };

    // Create non-owner member
    await Member.create({
      _id: new mongoose.Types.ObjectId().toString(),
      workspaceId,
      userId: nonOwnerUser.sub,
      inviter: userId,
      permissions: ['query:workspaces'],
      status: 'ACCEPTED',
      teamRole: 'MEMBER', // Not OWNER
      invitedAt: new Date(),
      updatedAt: new Date()
    });

    try {
      await resolvers.attachBillingProfile(
        null,
        { workspaceId, billingProfileId: billingProfile._id.toString() },
        { user: nonOwnerUser }
      );
      throw new Error('❌ Expected authorization error for non-owner');
    } catch (error) {
      if (error.message.includes('owner')) {
        console.log(`✓ Correctly rejected non-owner: ${error.message}\n`);
      } else {
        throw error;
      }
    }

    // Test 5: Test error - not a billing profile manager
    console.log('Test 5: Non-manager cannot attach billing profile');
    const newBillingProfile = await BillingProfile().create({
      name: 'Test Profile 2',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // User is workspace owner but NOT manager of this billing profile
    try {
      await resolvers.attachBillingProfile(
        null,
        { workspaceId, billingProfileId: newBillingProfile._id.toString() },
        { user: mockUser }
      );
      throw new Error('❌ Expected authorization error for non-manager');
    } catch (error) {
      if (error.message.includes('manager')) {
        console.log(`✓ Correctly rejected non-manager: ${error.message}\n`);
      } else {
        throw error;
      }
    }

    // Test 6: Switch to different billing profile
    console.log('Test 6: Switch to different billing profile');

    // Add user as manager of new billing profile
    await BillingProfileMember().create({
      billingProfileId: newBillingProfile._id.toString(),
      userId,
      role: 'manager'
    });

    const switched = await resolvers.attachBillingProfile(
      null,
      { workspaceId, billingProfileId: newBillingProfile._id.toString() },
      { user: mockUser }
    );

    if (switched.billingProfileId !== newBillingProfile._id.toString()) {
      throw new Error('❌ Failed to switch billing profile');
    }
    console.log(`✓ Switched to new billing profile: ${switched.billingProfileId}\n`);

    // Test 7: Test unauthenticated access
    console.log('Test 7: Unauthenticated access rejected');
    try {
      await resolvers.attachBillingProfile(
        null,
        { workspaceId, billingProfileId: billingProfile._id.toString() },
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
    await Workspace().deleteMany({ name: /Test Workspace/ });
    await Member.deleteMany({ userId: /test-user/ });
    await BillingProfile().deleteMany({ name: /Test Profile/ });
    await BillingProfileMember().deleteMany({ userId: /test-user/ });
    console.log('✓ Cleaned up test data');

    await mongoose.connection.close();
    console.log('\n✅ All attachBillingProfile tests passed!');
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

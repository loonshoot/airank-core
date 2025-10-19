#!/usr/bin/env node

/**
 * DANGER: This script deletes ALL workspaces and associated data
 * Use only for development/testing
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function deleteAllWorkspaces() {
  console.log('⚠️  WARNING: This will delete ALL workspaces and associated data!\n');

  // Simple confirmation (remove this if running in automated script)
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const confirmed = await new Promise((resolve) => {
    readline.question('Type "DELETE ALL" to confirm: ', (answer) => {
      readline.close();
      resolve(answer === 'DELETE ALL');
    });
  });

  if (!confirmed) {
    console.log('❌ Cancelled');
    process.exit(0);
  }

  console.log('\n🔄 Starting deletion process...\n');

  try {
    // Connect to the airank database
    const airankUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
    const airankDb = mongoose.createConnection(airankUri);
    await airankDb.asPromise();

    const workspacesCollection = airankDb.collection('workspaces');
    const membersCollection = airankDb.collection('members');
    const billingProfilesCollection = airankDb.collection('billingprofiles');
    const billingProfileMembersCollection = airankDb.collection('billingprofilemembers');

    // Get all workspaces
    const workspaces = await workspacesCollection.find({}).toArray();
    console.log(`Found ${workspaces.length} workspaces to delete\n`);

    for (const workspace of workspaces) {
      console.log(`Deleting workspace: ${workspace.name} (${workspace._id})`);

      // Delete workspace database
      const workspaceDbUri = `${process.env.MONGODB_URI}/workspace_${workspace._id}?${process.env.MONGODB_PARAMS}`;
      const workspaceDb = mongoose.createConnection(workspaceDbUri);
      await workspaceDb.asPromise();

      await workspaceDb.dropDatabase();
      console.log(`  ✓ Dropped database: workspace_${workspace._id}`);
      await workspaceDb.close();

      // Delete members for this workspace
      const membersResult = await membersCollection.deleteMany({ workspaceId: workspace._id });
      console.log(`  ✓ Deleted ${membersResult.deletedCount} members`);

      // Delete billing profile if it's the default one
      if (workspace.defaultBillingProfileId) {
        const billingProfileMembersResult = await billingProfileMembersCollection.deleteMany({
          billingProfileId: workspace.defaultBillingProfileId
        });
        console.log(`  ✓ Deleted ${billingProfileMembersResult.deletedCount} billing profile members`);

        const billingProfileResult = await billingProfilesCollection.deleteOne({
          _id: workspace.defaultBillingProfileId
        });
        console.log(`  ✓ Deleted ${billingProfileResult.deletedCount} billing profile`);
      }

      // Delete workspace document
      await workspacesCollection.deleteOne({ _id: workspace._id });
      console.log(`  ✅ Workspace deleted\n`);
    }

    await airankDb.close();

    console.log('='.repeat(50));
    console.log(`✅ Deletion complete!`);
    console.log(`   Workspaces deleted: ${workspaces.length}`);
    console.log('='.repeat(50));

  } catch (error) {
    console.error('❌ Deletion failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

deleteAllWorkspaces();

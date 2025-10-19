const mongoose = require('mongoose');
require('dotenv').config();

/**
 * Cleanup script to reset billing profiles and workspaces for testing
 * This will:
 * 1. Delete all non-default billing profiles
 * 2. Reset default billing profiles to free tier
 * 3. Reset workspaces to use their default billing profiles
 * 4. Clear billing profile members except for the creators
 */
async function cleanup() {
  try {
    console.log('Starting cleanup...');

    // Connect to the airank database
    const airankUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
    const airankDb = mongoose.createConnection(airankUri);
    await airankDb.asPromise();

    const billingProfilesCollection = airankDb.collection('billingprofiles');
    const billingProfileMembersCollection = airankDb.collection('billingprofilemembers');
    const workspacesCollection = airankDb.collection('workspaces');

    // Get all workspaces
    const workspaces = await workspacesCollection.find({}).toArray();
    console.log(`\nFound ${workspaces.length} workspaces`);

    // Get all billing profiles
    const allProfiles = await billingProfilesCollection.find({}).toArray();
    console.log(`Found ${allProfiles.length} billing profiles`);

    // 1. Delete all non-default billing profiles
    const nonDefaultProfiles = allProfiles.filter(p => !p.isDefault);
    console.log(`\n1. Deleting ${nonDefaultProfiles.length} non-default billing profiles...`);

    for (const profile of nonDefaultProfiles) {
      console.log(`   - Deleting "${profile.name}" (${profile._id})`);

      // Delete profile members
      await billingProfileMembersCollection.deleteMany({ billingProfileId: profile._id });

      // Delete profile
      await billingProfilesCollection.deleteOne({ _id: profile._id });
    }

    // 2. Reset default billing profiles to free tier
    const defaultProfiles = allProfiles.filter(p => p.isDefault);
    console.log(`\n2. Resetting ${defaultProfiles.length} default billing profiles to free tier...`);

    for (const profile of defaultProfiles) {
      console.log(`   - Resetting "${profile.name}" (${profile._id})`);

      await billingProfilesCollection.updateOne(
        { _id: profile._id },
        {
          $set: {
            currentPlan: 'free',
            brandsLimit: 1,
            brandsUsed: 0,
            promptsLimit: 4,
            promptsUsed: 0,
            promptsResetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            modelsLimit: 1,
            dataRetentionDays: 30,
            hasPaymentMethod: false,
            stripeCustomerId: null,
            stripeSubscriptionId: null,
            planStatus: null,
            defaultPaymentMethodId: null,
            paymentMethodLast4: null,
            paymentMethodBrand: null,
            paymentMethodExpMonth: null,
            paymentMethodExpYear: null
          }
        }
      );
    }

    // 3. Reset workspaces to use their default billing profiles
    console.log(`\n3. Resetting ${workspaces.length} workspaces to use default billing profiles...`);

    for (const workspace of workspaces) {
      if (workspace.defaultBillingProfileId) {
        console.log(`   - Resetting workspace "${workspace.name}" to default profile`);

        await workspacesCollection.updateOne(
          { _id: workspace._id },
          {
            $set: {
              billingProfileId: workspace.defaultBillingProfileId
            }
          }
        );
      }
    }

    // 4. Clean up billing profile members - keep only creator with full permissions
    console.log(`\n4. Cleaning up billing profile members...`);

    const allMembers = await billingProfileMembersCollection.find({}).toArray();
    console.log(`   Found ${allMembers.length} billing profile members`);

    // Group members by billing profile
    const membersByProfile = {};
    allMembers.forEach(member => {
      if (!membersByProfile[member.billingProfileId]) {
        membersByProfile[member.billingProfileId] = [];
      }
      membersByProfile[member.billingProfileId].push(member);
    });

    let membersKept = 0;
    let membersRemoved = 0;

    for (const [profileId, members] of Object.entries(membersByProfile)) {
      // Sort by createdAt to find the creator (first member)
      members.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      const creator = members[0];

      // Remove all members except the creator
      for (const member of members) {
        if (member._id !== creator._id) {
          await billingProfileMembersCollection.deleteOne({ _id: member._id });
          console.log(`   - Removed member ${member.userId} from profile ${profileId}`);
          membersRemoved++;
        } else {
          // Ensure creator has full permissions
          await billingProfileMembersCollection.updateOne(
            { _id: creator._id },
            {
              $set: {
                permissions: {
                  attach: true,
                  modify: true,
                  delete: true
                }
              }
            }
          );
          membersKept++;
        }
      }
    }

    console.log(`   Kept ${membersKept} creator members with full permissions`);
    console.log(`   Removed ${membersRemoved} additional members`);

    // 5. Reset workspace configs to simple billing
    console.log(`\n5. Resetting workspace configs to simple billing...`);

    for (const workspace of workspaces) {
      const workspaceDbUri = `${process.env.MONGODB_URI}/workspace_${workspace._id}?${process.env.MONGODB_PARAMS}`;
      const workspaceDb = mongoose.createConnection(workspaceDbUri);
      await workspaceDb.asPromise();

      await workspaceDb.collection('configs').updateOne(
        { configType: 'billing' },
        {
          $set: {
            data: { advancedBilling: false },
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );

      console.log(`   - Reset "${workspace.name}" to simple billing`);
      await workspaceDb.close();
    }

    console.log('\n✅ Cleanup complete!');
    console.log('\nSummary:');
    console.log(`- Deleted ${nonDefaultProfiles.length} non-default billing profiles`);
    console.log(`- Reset ${defaultProfiles.length} default billing profiles to free tier`);
    console.log(`- Reset ${workspaces.length} workspaces to use default profiles`);
    console.log(`- Kept ${membersKept} creator members`);
    console.log(`- Removed ${membersRemoved} additional members`);
    console.log(`- Reset ${workspaces.length} workspaces to simple billing mode`);

    await airankDb.close();
    process.exit(0);
  } catch (error) {
    console.error('Cleanup failed:', error);
    process.exit(1);
  }
}

// Run the cleanup
cleanup();

const mongoose = require('mongoose');
require('dotenv').config();

/**
 * Migration script to add isDefault and defaultForWorkspaceId fields to existing billing profiles
 * Run this once to update all existing profiles
 */
async function migrateBillingProfiles() {
  try {
    console.log('Starting billing profile migration...');

    // Connect to the airank database
    const airankUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
    const airankDb = mongoose.createConnection(airankUri);
    await airankDb.asPromise();

    const billingProfilesCollection = airankDb.collection('billingprofiles');
    const workspacesCollection = airankDb.collection('workspaces');

    // Get all workspaces
    const workspaces = await workspacesCollection.find({}).toArray();
    console.log(`Found ${workspaces.length} workspaces`);

    // Create a map of billingProfileId -> workspaceId for default profiles
    const defaultProfileMap = {};
    workspaces.forEach(ws => {
      if (ws.defaultBillingProfileId) {
        defaultProfileMap[ws.defaultBillingProfileId] = ws._id;
      }
    });

    console.log(`Found ${Object.keys(defaultProfileMap).length} default billing profiles`);

    // Get all billing profiles
    const allProfiles = await billingProfilesCollection.find({}).toArray();
    console.log(`Found ${allProfiles.length} billing profiles`);

    let updatedCount = 0;
    let alreadyMigratedCount = 0;

    // Update each billing profile
    for (const profile of allProfiles) {
      // Check if already migrated
      if (profile.hasOwnProperty('isDefault')) {
        alreadyMigratedCount++;
        continue;
      }

      const isDefault = defaultProfileMap.hasOwnProperty(profile._id);
      const defaultForWorkspaceId = isDefault ? defaultProfileMap[profile._id] : null;

      await billingProfilesCollection.updateOne(
        { _id: profile._id },
        {
          $set: {
            isDefault,
            defaultForWorkspaceId
          }
        }
      );

      console.log(`Updated profile ${profile._id} (${profile.name}): isDefault=${isDefault}, defaultForWorkspaceId=${defaultForWorkspaceId}`);
      updatedCount++;
    }

    console.log('\nMigration complete!');
    console.log(`- Total profiles: ${allProfiles.length}`);
    console.log(`- Already migrated: ${alreadyMigratedCount}`);
    console.log(`- Updated: ${updatedCount}`);

    await airankDb.close();
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration
migrateBillingProfiles();

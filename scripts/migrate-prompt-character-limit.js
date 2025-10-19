/**
 * Migration Script: Add promptCharacterLimit to Billing Profiles
 *
 * This script updates all existing billing profiles to include the
 * promptCharacterLimit field with a default value of 150 characters.
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function migrate() {
  try {
    console.log('Starting migration: Add promptCharacterLimit to billing profiles');
    console.log('=================================================================\n');

    // Connect to airank database
    const airankUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
    const airankDb = mongoose.createConnection(airankUri);
    await airankDb.asPromise();
    console.log('✓ Connected to airank database\n');

    const billingProfilesCollection = airankDb.collection('billingprofiles');

    // Find all billing profiles without promptCharacterLimit or with the old value of 25
    const profilesToUpdate = await billingProfilesCollection.find({
      $or: [
        { promptCharacterLimit: { $exists: false } },
        { promptCharacterLimit: 25 }
      ]
    }).toArray();

    console.log(`Found ${profilesToUpdate.length} billing profiles to update\n`);

    if (profilesToUpdate.length === 0) {
      console.log('✓ No migration needed - all profiles already have promptCharacterLimit set to 150');
      await airankDb.close();
      return;
    }

    // Update each profile
    let updatedCount = 0;
    for (const profile of profilesToUpdate) {
      console.log(`Updating billing profile: ${profile.name} (${profile._id})`);
      console.log(`  Current plan: ${profile.currentPlan || 'unknown'}`);

      // Set default to 150 for all plans
      const promptCharacterLimit = 150;

      await billingProfilesCollection.updateOne(
        { _id: profile._id },
        {
          $set: {
            promptCharacterLimit,
            updatedAt: new Date()
          }
        }
      );

      console.log(`  ✓ Set promptCharacterLimit to ${promptCharacterLimit}\n`);
      updatedCount++;
    }

    console.log('=================================================================');
    console.log(`Migration complete! Updated ${updatedCount} billing profiles`);

    await airankDb.close();
    console.log('✓ Database connection closed');

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrate().then(() => {
  console.log('\n✓ Migration script finished successfully');
  process.exit(0);
}).catch(error => {
  console.error('\n✗ Migration script failed:', error);
  process.exit(1);
});

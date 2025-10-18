const mongoose = require('mongoose');
const { getPlanEntitlements } = require('../config/plans');
require('dotenv').config();

/**
 * Migration script to add entitlement fields to existing billing profiles
 * Run this once after deploying the entitlements system
 */
async function migrateEntitlements() {
  try {
    console.log('Starting entitlements migration...');

    // Connect to the airank database
    const airankUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
    const airankDb = mongoose.createConnection(airankUri);
    await airankDb.asPromise();

    const billingProfilesCollection = airankDb.collection('billingprofiles');

    // Get all billing profiles
    const allProfiles = await billingProfilesCollection.find({}).toArray();
    console.log(`Found ${allProfiles.length} billing profiles`);

    let updatedCount = 0;
    let skippedCount = 0;

    // Update each billing profile
    for (const profile of allProfiles) {
      // Check if already migrated
      if (profile.hasOwnProperty('promptCharacterLimit')) {
        console.log(`Profile ${profile._id} (${profile.name}) already migrated, skipping`);
        skippedCount++;
        continue;
      }

      // Get entitlements for the profile's current plan
      const planId = profile.currentPlan || 'free';
      const entitlements = getPlanEntitlements(planId);

      // Calculate next job run date based on frequency
      let nextJobRunDate = null;
      if (entitlements.jobFrequency === 'monthly') {
        // Set to first of next month
        const now = new Date();
        nextJobRunDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      } else if (entitlements.jobFrequency === 'daily') {
        // Set to tomorrow
        nextJobRunDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
      }

      // Update billing profile with new entitlement fields
      await billingProfilesCollection.updateOne(
        { _id: profile._id },
        {
          $set: {
            promptCharacterLimit: entitlements.promptCharacterLimit,
            allowedModels: entitlements.allowedModels,
            jobFrequency: entitlements.jobFrequency,
            nextJobRunDate,
            planExpiry: profile.currentPeriodEnd || null,
            paymentFailedAt: null,
            gracePeriodEndsAt: null,
            updatedAt: new Date()
          }
        }
      );

      console.log(`✓ Updated profile ${profile._id} (${profile.name}):`);
      console.log(`  - Plan: ${planId}`);
      console.log(`  - Job frequency: ${entitlements.jobFrequency}`);
      console.log(`  - Next job run: ${nextJobRunDate}`);
      console.log(`  - Character limit: ${entitlements.promptCharacterLimit}`);
      console.log(`  - Models limit: ${entitlements.modelsLimit}`);
      console.log(`  - Allowed models: ${entitlements.allowedModels.length > 0 ? entitlements.allowedModels.join(', ') : 'all'}`);

      updatedCount++;
    }

    console.log('\n=== Migration Summary ===');
    console.log(`Total profiles: ${allProfiles.length}`);
    console.log(`Updated: ${updatedCount}`);
    console.log(`Already migrated: ${skippedCount}`);
    console.log('✓ Migration complete!');

    await airankDb.close();
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration
migrateEntitlements();

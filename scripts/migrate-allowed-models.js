/**
 * Migration script to add allowedModels to existing billing profiles
 *
 * This fixes billing profiles that were created before the allowedModels
 * field was added to the schema.
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: './graphql/.env' });

const PLAN_ALLOWED_MODELS = {
  free: ['gpt-4o-mini-2024-07-18'],
  small: [
    'gpt-4o-mini-2024-07-18',
    'claude-3-5-haiku-20241022',
    'gemini-2.5-flash',
    'gpt-4o-2024-08-06',
    'claude-3-5-sonnet-20241022',
    'gemini-2.5-pro'
  ],
  medium: [
    'gpt-4o-mini-2024-07-18',
    'claude-3-5-haiku-20241022',
    'gemini-2.5-flash',
    'gpt-4o-2024-08-06',
    'claude-3-5-sonnet-20241022',
    'gemini-2.5-pro',
    'gpt-4.1-2025-04-14',
    'claude-haiku-4-5',
    'claude-3-opus-20240229',
    'gemini-2.5-flash-lite'
  ],
  enterprise: [
    'gpt-4o-mini-2024-07-18',
    'claude-3-5-haiku-20241022',
    'gemini-2.5-flash',
    'gpt-4o-2024-08-06',
    'claude-3-5-sonnet-20241022',
    'gemini-2.5-pro',
    'gpt-4.1-2025-04-14',
    'claude-haiku-4-5',
    'claude-3-opus-20240229',
    'gemini-2.5-flash-lite',
    'gpt-4-turbo-2024-04-09',
    'gpt-4.1-mini-2025-04-14',
    'gemini-2.0-flash'
  ]
};

async function migrateAllowedModels() {
  try {
    console.log('Connecting to MongoDB...');
    const uri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
    await mongoose.connect(uri);
    console.log('✓ Connected to MongoDB\n');

    const billingProfilesCollection = mongoose.connection.db.collection('billingprofiles');

    // Find all billing profiles without allowedModels
    const profilesNeedingUpdate = await billingProfilesCollection.find({
      $or: [
        { allowedModels: { $exists: false } },
        { allowedModels: null },
        { allowedModels: { $size: 0 } }
      ]
    }).toArray();

    console.log(`Found ${profilesNeedingUpdate.length} billing profiles needing update\n`);

    if (profilesNeedingUpdate.length === 0) {
      console.log('✓ All billing profiles already have allowedModels set');
      await mongoose.connection.close();
      return;
    }

    let updated = 0;
    let failed = 0;

    for (const profile of profilesNeedingUpdate) {
      const plan = profile.currentPlan || 'free';
      const allowedModels = PLAN_ALLOWED_MODELS[plan] || PLAN_ALLOWED_MODELS.free;

      console.log(`Updating profile: ${profile.name || profile._id}`);
      console.log(`  Plan: ${plan}`);
      console.log(`  Setting allowedModels: ${allowedModels.join(', ')}`);

      try {
        await billingProfilesCollection.updateOne(
          { _id: profile._id },
          {
            $set: {
              allowedModels,
              updatedAt: new Date()
            }
          }
        );
        console.log('  ✓ Updated\n');
        updated++;
      } catch (err) {
        console.error(`  ✗ Failed: ${err.message}\n`);
        failed++;
      }
    }

    console.log('\n===========================================');
    console.log('Migration Summary:');
    console.log(`  Total profiles: ${profilesNeedingUpdate.length}`);
    console.log(`  Successfully updated: ${updated}`);
    console.log(`  Failed: ${failed}`);
    console.log('===========================================\n');

    await mongoose.connection.close();
    console.log('✓ Migration complete');
  } catch (err) {
    console.error('Migration failed:', err);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run migration
migrateAllowedModels();

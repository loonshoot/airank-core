#!/usr/bin/env node

/**
 * Migration script to add billing profiles and configs to existing workspaces
 * Run this once to fix workspaces created before the advanced billing feature
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function migrateWorkspaces() {
  console.log('🔄 Starting workspace billing migration...\n');

  try {
    // Connect to the airank database
    const airankUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
    const airankDb = mongoose.createConnection(airankUri);
    await airankDb.asPromise();

    const workspacesCollection = airankDb.collection('workspaces');
    const billingProfilesCollection = airankDb.collection('billingprofiles');
    const billingProfileMembersCollection = airankDb.collection('billingprofilemembers');

    // Find all workspaces
    const workspaces = await workspacesCollection.find({}).toArray();
    console.log(`Found ${workspaces.length} workspaces\n`);

    let migrated = 0;
    let skipped = 0;

    for (const workspace of workspaces) {
      console.log(`Checking workspace: ${workspace.name} (${workspace._id})`);

      // Check if workspace already has billing profile
      if (workspace.billingProfileId && workspace.defaultBillingProfileId) {
        console.log(`  ✓ Already has billing profile, skipping\n`);
        skipped++;
        continue;
      }

      // Create billing profile
      const billingProfileId = new mongoose.Types.ObjectId().toString();
      const billingProfile = {
        _id: billingProfileId,
        name: `${workspace.name} Billing`,
        currentPlan: 'free',
        brandsLimit: 1,
        brandsUsed: 0,
        promptsLimit: 4,
        promptsUsed: 0,
        promptsResetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        modelsLimit: 1,
        dataRetentionDays: 30,
        hasPaymentMethod: false,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await billingProfilesCollection.insertOne(billingProfile);
      console.log(`  ✓ Created billing profile: ${billingProfileId}`);

      // Add creator as billing profile manager
      const billingProfileMember = {
        _id: new mongoose.Types.ObjectId().toString(),
        billingProfileId,
        userId: workspace.creatorId,
        role: 'manager',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await billingProfileMembersCollection.insertOne(billingProfileMember);
      console.log(`  ✓ Added creator as billing profile manager`);

      // Update workspace
      await workspacesCollection.updateOne(
        { _id: workspace._id },
        {
          $set: {
            billingProfileId,
            defaultBillingProfileId: billingProfileId,
            config: { advancedBilling: false }
          }
        }
      );
      console.log(`  ✓ Updated workspace with billing profile`);

      // Create billing config in workspace database
      const workspaceDbUri = `${process.env.MONGODB_URI}/workspace_${workspace._id}?${process.env.MONGODB_PARAMS}`;
      const workspaceDb = mongoose.createConnection(workspaceDbUri);
      await workspaceDb.asPromise();

      const configsCollection = workspaceDb.collection('configs');

      // Check if billing config already exists
      const existingConfig = await configsCollection.findOne({ configType: 'billing' });

      if (!existingConfig) {
        await configsCollection.insertOne({
          _id: new mongoose.Types.ObjectId(),
          configType: 'billing',
          data: { advancedBilling: false },
          method: 'automatic',
          updatedAt: new Date()
        });
        console.log(`  ✓ Created billing config in workspace database`);
      } else {
        console.log(`  ✓ Billing config already exists`);
      }

      await workspaceDb.close();

      migrated++;
      console.log(`  ✅ Migration complete for workspace\n`);
    }

    await airankDb.close();

    console.log('='.repeat(50));
    console.log(`✅ Migration complete!`);
    console.log(`   Migrated: ${migrated}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Total: ${workspaces.length}`);
    console.log('='.repeat(50));

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

migrateWorkspaces();

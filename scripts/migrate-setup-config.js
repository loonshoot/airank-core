/**
 * Migration Script: Add setup config to existing workspaces
 *
 * This script adds the initial setup config (inSetupMode: false) to existing
 * workspaces that don't have it yet. New workspaces are created with this by default.
 * Existing workspaces should not show the setup banner since they're already configured.
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function migrate() {
  try {
    console.log('Starting migration: Add setup config to existing workspaces');
    console.log('================================================================\n');

    // Connect to airank database to get list of workspaces
    const airankUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
    const airankDb = mongoose.createConnection(airankUri);
    await airankDb.asPromise();
    console.log('✓ Connected to airank database\n');

    // Get all workspaces
    const workspacesCollection = airankDb.collection('workspaces');
    const workspaces = await workspacesCollection.find({}).toArray();
    console.log(`Found ${workspaces.length} workspaces\n`);

    let updatedCount = 0;

    for (const workspace of workspaces) {
      console.log(`Checking workspace: ${workspace.name} (${workspace._id})`);

      try {
        // Connect to workspace database
        const workspaceDbUri = `${process.env.MONGODB_URI}/workspace_${workspace._id}?${process.env.MONGODB_PARAMS}`;
        const workspaceDb = mongoose.createConnection(workspaceDbUri);
        await workspaceDb.asPromise();

        const configsCollection = workspaceDb.collection('configs');

        // Check if setup config exists
        const setupConfig = await configsCollection.findOne({ configType: 'setup' });

        if (!setupConfig) {
          // Add setup config with inSetupMode: false (existing workspaces shouldn't show banner)
          await configsCollection.insertOne({
            _id: new mongoose.Types.ObjectId(),
            configType: 'setup',
            data: { inSetupMode: false },
            method: 'automatic',
            updatedAt: new Date()
          });

          console.log(`  ✓ Added setup config (inSetupMode: false)\n`);
          updatedCount++;
        } else {
          console.log(`  - Already has setup config (inSetupMode: ${setupConfig.data.inSetupMode})\n`);
        }

        await workspaceDb.close();
      } catch (err) {
        console.error(`  ✗ Error processing workspace ${workspace._id}:`, err.message);
        console.log('');
      }
    }

    await airankDb.close();

    console.log('================================================================');
    console.log(`Migration complete! Updated ${updatedCount} out of ${workspaces.length} workspaces`);
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

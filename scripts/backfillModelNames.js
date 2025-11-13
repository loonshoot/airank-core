const mongoose = require('mongoose');
require('dotenv').config();

const { PreviousModelResultSchema } = require('../config/data/models');

// Model name mapping from friendly names to platform IDs
const MODEL_NAME_MAPPING = {
  // OpenAI models
  'GPT-4o': 'gpt-4o-2024-08-06',
  'GPT-4o Mini': 'gpt-4o-mini-2024-07-18',
  'GPT-4o mini': 'gpt-4o-mini-2024-07-18',
  'GPT-4 Turbo': 'gpt-4-turbo-2024-04-09',
  'GPT-4': 'gpt-4-0613',
  'GPT-3.5 Turbo': 'gpt-3.5-turbo-0125',

  // Anthropic models
  'Claude 3.5 Sonnet': 'claude-3-5-sonnet-20241022',
  'Claude 3.5 Haiku': 'claude-3-5-haiku-20241022',
  'Claude 3 Opus': 'claude-3-opus-20240229',
  'Claude 3 Sonnet': 'claude-3-sonnet-20240229',
  'Claude 3 Haiku': 'claude-3-haiku-20240307',

  // Google models
  'Gemini 1.5 Pro': 'gemini-1.5-pro-002',
  'Gemini 1.5 Flash': 'gemini-1.5-flash-002',
  'Gemini 2.0 Flash': 'gemini-2.0-flash-exp',
  'Gemini 2.5 Flash': 'gemini-2.5-flash',
};

async function backfillModelNames(workspaceId, mongoUri) {
  console.log('🚀 Starting model name backfill script...');
  console.log(`📋 Workspace ID: ${workspaceId}`);

  try {
    // Use provided MongoDB URI or fall back to environment variable
    const baseMongoUri = mongoUri || process.env.MONGODB_URI;

    // Connect to workspace database directly
    const workspaceDbName = `workspace_${workspaceId}`;
    const workspaceDbUri = `${baseMongoUri}/${workspaceDbName}?authSource=admin&directConnection=true`;

    console.log('Connecting to:', workspaceDbUri.replace(/:[^:@]+@/, ':****@'));

    const workspaceConnection = await mongoose.createConnection(workspaceDbUri);

    await new Promise((resolve, reject) => {
      workspaceConnection.once('open', resolve);
      workspaceConnection.once('error', reject);
    });

    console.log('✓ Connected to workspace database:', workspaceDbName);

    const WorkspacePreviousModelResult = workspaceConnection.model(
      'PreviousModelResult',
      PreviousModelResultSchema
    );

    console.log('Collection name:', WorkspacePreviousModelResult.collection.name);

    // Count documents first
    const count = await WorkspacePreviousModelResult.countDocuments({});
    console.log(`📊 Total documents in collection: ${count}`);

    // Find all results that might need updating
    const results = await WorkspacePreviousModelResult.find({}).lean();

    console.log(`📊 Found ${results.length} results to check`);

    // Log first few model names for debugging
    if (results.length > 0) {
      console.log('Sample model names:', results.slice(0, 5).map(r => r.modelName));
    }

    let updatedCount = 0;
    const updates = [];

    for (const result of results) {
      const currentModelName = result.modelName;

      // Check if this model name needs to be updated
      if (MODEL_NAME_MAPPING[currentModelName]) {
        const newModelName = MODEL_NAME_MAPPING[currentModelName];
        updates.push({
          _id: result._id,
          oldName: currentModelName,
          newName: newModelName
        });
      }
    }

    console.log(`\n📝 Found ${updates.length} results that need updating:`);

    // Group by old name for summary
    const summary = updates.reduce((acc, update) => {
      if (!acc[update.oldName]) {
        acc[update.oldName] = {
          count: 0,
          newName: update.newName
        };
      }
      acc[update.oldName].count++;
      return acc;
    }, {});

    console.log('\nSummary of changes:');
    Object.entries(summary).forEach(([oldName, info]) => {
      console.log(`  "${oldName}" → "${info.newName}" (${info.count} records)`);
    });

    if (updates.length === 0) {
      console.log('\n✅ No updates needed - all model names are already using platform IDs');
      await workspaceConnection.close();
      await mainConnection.disconnect();
      return;
    }

    // Ask for confirmation
    console.log(`\n⚠️  About to update ${updates.length} records`);
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...');

    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('\n🔄 Starting updates...');

    // Update in batches
    const batchSize = 100;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);

      await Promise.all(
        batch.map(update =>
          WorkspacePreviousModelResult.updateOne(
            { _id: update._id },
            { $set: { modelName: update.newName } }
          )
        )
      );

      updatedCount += batch.length;
      console.log(`  ⏳ Updated ${updatedCount}/${updates.length} records...`);
    }

    console.log(`\n✅ Successfully updated ${updatedCount} records`);

    // Verify the updates
    console.log('\n🔍 Verifying updates...');
    const verifyResults = await WorkspacePreviousModelResult.find({
      _id: { $in: updates.map(u => u._id) }
    });

    const stillWrong = verifyResults.filter(r =>
      Object.keys(MODEL_NAME_MAPPING).includes(r.modelName)
    );

    if (stillWrong.length > 0) {
      console.log(`⚠️  Warning: ${stillWrong.length} records still have friendly names`);
    } else {
      console.log('✅ All records verified successfully');
    }

    await workspaceConnection.close();

    console.log('\n✨ Backfill complete!');

  } catch (error) {
    console.error('❌ Error during backfill:', error);
    throw error;
  }
}

// Get workspace ID and optional MongoDB URI from command line args
const workspaceId = process.argv[2];
const mongoUri = process.argv[3];

if (!workspaceId) {
  console.error('❌ Error: Workspace ID required');
  console.log('Usage: node scripts/backfillModelNames.js <workspaceId> [mongoUri]');
  console.log('Example: node scripts/backfillModelNames.js 690f7b6056f9ee90ea8cdbe2 mongodb://admin:pass@host:27017');
  process.exit(1);
}

backfillModelNames(workspaceId, mongoUri)
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });

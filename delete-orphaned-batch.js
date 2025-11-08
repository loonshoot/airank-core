const mongoose = require('mongoose');

async function deleteOrphanedBatch() {
  const workspaceId = '690e14f33818ef2190cbb3a6';
  const batchId = 'batch_690e156b23248190b7b8d11cd5f2a5ad';

  await mongoose.connect(process.env.PROD_MONGO_URI);
  const workspaceDb = mongoose.connection.useDb(`workspace_${workspaceId}`);

  console.log('🗑️  Deleting Orphaned Batch');
  console.log('Workspace ID:', workspaceId);
  console.log('Batch ID:', batchId);
  console.log('=' .repeat(80));

  // Delete the orphaned batch document
  const result = await workspaceDb.collection('batches').deleteOne({ batchId });

  if (result.deletedCount === 1) {
    console.log('✅ Successfully deleted orphaned batch document');
  } else {
    console.log('⚠️  No batch document found to delete');
  }

  await mongoose.connection.close();
}

deleteOrphanedBatch().catch(console.error);

const mongoose = require('mongoose');
const OpenAI = require('openai');

async function checkOpenAIBatchStatus() {
  // Initialize OpenAI client
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  await mongoose.connect(process.env.PROD_MONGO_URI);
  const airankDb = mongoose.connection.useDb('airank');

  // Get all workspaces
  const workspaces = await airankDb.collection('workspaces').find({}).toArray();

  console.log('🔍 Checking OpenAI Batch Status via API');
  console.log('Time:', new Date().toISOString());
  console.log('=' .repeat(80));

  for (const workspace of workspaces) {
    const workspaceId = workspace._id.toString();
    const workspaceDb = mongoose.connection.useDb(`workspace_${workspaceId}`);

    // Find all OpenAI batches
    const batches = await workspaceDb.collection('batches').find({
      provider: 'openai'
    }).sort({ submittedAt: -1 }).toArray();

    if (batches.length === 0) continue;

    console.log('\n📦 Workspace:', workspace.name);
    console.log('   ID:', workspaceId);
    console.log('   OpenAI Batches:', batches.length);

    for (const batch of batches) {
      console.log('\n   Batch ID:', batch.batchId);
      console.log('   Submitted:', batch.submittedAt);
      console.log('   DB Status:', batch.status);
      console.log('   Processed:', batch.isProcessed);

      try {
        // Query OpenAI API for actual status
        const apiBatch = await openai.batches.retrieve(batch.batchId);

        console.log('   ✅ OpenAI API Status:');
        console.log('      Status:', apiBatch.status);
        console.log('      Request Counts:');
        console.log('        Total:', apiBatch.request_counts?.total || 0);
        console.log('        Completed:', apiBatch.request_counts?.completed || 0);
        console.log('        Failed:', apiBatch.request_counts?.failed || 0);
        console.log('      Created:', new Date(apiBatch.created_at * 1000).toISOString());

        if (apiBatch.completed_at) {
          console.log('      Completed:', new Date(apiBatch.completed_at * 1000).toISOString());
          console.log('      Output File:', apiBatch.output_file_id);
        }

        if (apiBatch.failed_at) {
          console.log('      Failed:', new Date(apiBatch.failed_at * 1000).toISOString());
          console.log('      Error File:', apiBatch.error_file_id);
        }

        if (apiBatch.in_progress_at) {
          console.log('      In Progress Since:', new Date(apiBatch.in_progress_at * 1000).toISOString());
        }

        // Check if notification exists
        const notification = await workspaceDb.collection('batchnotifications').findOne({
          batchId: batch.batchId,
          provider: 'openai'
        });

        console.log('      Notification Exists:', !!notification);
        if (notification) {
          console.log('      Notification Status:', notification.status);
          console.log('      Notification Processed:', notification.processed);
        }

      } catch (error) {
        console.log('   ❌ OpenAI API Error:', error.message);
        if (error.status === 404) {
          console.log('      This batch does not exist in OpenAI (orphaned)');
        }
      }
    }
  }

  await mongoose.connection.close();
  console.log('\n' + '=' .repeat(80));
  console.log('✅ Check complete');
}

checkOpenAIBatchStatus().catch(console.error);

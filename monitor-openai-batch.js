const mongoose = require('mongoose');
const OpenAI = require('openai');

async function monitorOpenAIBatch() {
  try {
    const mongoUri = process.env.PROD_MONGO_URI;

    await mongoose.connect(mongoUri);
    console.log('✓ Connected to production database\n');

    const airankDb = mongoose.connection.client.db('airank');

    // Find the most recent OpenAI batch
    const workspaces = await airankDb.collection('workspaces').find({}).toArray();

    console.log(`Checking ${workspaces.length} workspaces for OpenAI batches...\n`);

    let allBatches = [];

    for (const workspace of workspaces) {
      const workspaceDb = mongoose.connection.client.db(`workspace_${workspace._id}`);

      try {
        const batches = await workspaceDb.collection('batches').find({
          provider: 'openai',
          status: { $in: ['submitted', 'processing'] }
        }).sort({ submittedAt: -1 }).limit(5).toArray();

        if (batches.length > 0) {
          batches.forEach(b => {
            allBatches.push({
              ...b,
              workspaceName: workspace.name,
              workspaceId: workspace._id.toString()
            });
          });
        }
      } catch (err) {
        // Workspace database might not exist
      }
    }

    if (allBatches.length === 0) {
      console.log('No pending OpenAI batches found');
      await mongoose.connection.close();
      process.exit(0);
    }

    console.log(`Found ${allBatches.length} pending OpenAI batch(es):\n`);

    allBatches.forEach((b, i) => {
      console.log(`${i + 1}. Workspace: ${b.workspaceName}`);
      console.log(`   Batch ID: ${b.batchId}`);
      console.log(`   Status: ${b.status}`);
      console.log(`   Submitted: ${b.submittedAt}`);
      console.log(`   Requests: ${b.requestCount}\n`);
    });

    // Monitor the most recent batch
    const batch = allBatches[0];
    console.log(`\nMonitoring batch: ${batch.batchId}`);
    console.log(`Workspace: ${batch.workspaceName}\n`);

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    console.log('Checking OpenAI API status every 10 seconds...\n');

    // Poll for completion
    for (let i = 0; i < 36; i++) { // Check for up to 6 minutes
      await new Promise(resolve => setTimeout(resolve, 10000));

      const timeElapsed = (i + 1) * 10;

      try {
        const apiBatch = await openai.batches.retrieve(batch.batchId);

        console.log(`[${timeElapsed}s] Status: ${apiBatch.status}`);
        console.log(`   Request counts: ${JSON.stringify(apiBatch.request_counts)}`);

        if (apiBatch.status === 'completed') {
          console.log('\n✅ Batch completed!');
          console.log('Output file ID:', apiBatch.output_file_id);

          // Check if batch document was updated
          const workspaceDb = mongoose.connection.client.db(`workspace_${batch.workspaceId}`);
          const updatedBatch = await workspaceDb.collection('batches').findOne({
            batchId: batch.batchId
          });

          console.log('\nDatabase status:', updatedBatch.status);
          console.log('Is processed:', updatedBatch.isProcessed);

          if (updatedBatch.status === 'received') {
            console.log('\n✅ Results have been downloaded and processed!');
            console.log('Results count:', updatedBatch.results?.length || 0);
          } else {
            console.log('\n⏳ Waiting for webhook to trigger result processing...');
          }

          break;
        } else if (apiBatch.status === 'failed' || apiBatch.status === 'expired' || apiBatch.status === 'cancelled') {
          console.log('\n❌ Batch ended with status:', apiBatch.status);
          if (apiBatch.errors) {
            console.log('Errors:', JSON.stringify(apiBatch.errors, null, 2));
          }
          break;
        }
      } catch (error) {
        console.log(`[${timeElapsed}s] Error checking batch:`, error.message);
      }
    }

    await mongoose.connection.close();
    console.log('\n✓ Monitoring complete');

  } catch (error) {
    console.error('💥 Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

monitorOpenAIBatch();

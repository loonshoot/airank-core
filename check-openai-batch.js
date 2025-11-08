const mongoose = require('mongoose');
const OpenAI = require('openai');

async function checkOpenAIBatch() {
  const batchId = 'batch_690e156b23248190b7b8d11cd5f2a5ad';
  const workspaceId = '690e14f33818ef2190cbb3a6';

  // Initialize OpenAI client
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  console.log('🔍 Checking OpenAI Batch Status');
  console.log('Batch ID:', batchId);
  console.log('Workspace ID:', workspaceId);
  console.log('Time:', new Date().toISOString());
  console.log('=' .repeat(80));

  try {
    // Check batch status with OpenAI
    const batch = await openai.batches.retrieve(batchId);

    console.log('\n📦 OpenAI API Status:');
    console.log('Status:', batch.status);
    console.log('Request Counts:');
    console.log('  Total:', batch.request_counts?.total || 0);
    console.log('  Completed:', batch.request_counts?.completed || 0);
    console.log('  Failed:', batch.request_counts?.failed || 0);

    console.log('\nTiming:');
    console.log('  Created:', batch.created_at ? new Date(batch.created_at * 1000).toISOString() : 'N/A');
    console.log('  In Progress:', batch.in_progress_at ? new Date(batch.in_progress_at * 1000).toISOString() : 'N/A');
    console.log('  Completed:', batch.completed_at ? new Date(batch.completed_at * 1000).toISOString() : 'N/A');
    console.log('  Failed:', batch.failed_at ? new Date(batch.failed_at * 1000).toISOString() : 'N/A');
    console.log('  Expires:', batch.expires_at ? new Date(batch.expires_at * 1000).toISOString() : 'N/A');

    console.log('\nFiles:');
    console.log('  Input:', batch.input_file_id);
    console.log('  Output:', batch.output_file_id || 'N/A');
    console.log('  Error:', batch.error_file_id || 'N/A');

    if (batch.errors && batch.errors.data && batch.errors.data.length > 0) {
      console.log('\n❌ Errors:');
      batch.errors.data.forEach((error, i) => {
        console.log(`  ${i + 1}. ${error.message}`);
      });
    }

    // Check database status
    await mongoose.connect(process.env.PROD_MONGO_URI);
    const workspaceDb = mongoose.connection.useDb(`workspace_${workspaceId}`);

    const dbBatch = await workspaceDb.collection('batches').findOne({ batchId });

    console.log('\n\n💾 Database Status:');
    console.log('Status:', dbBatch?.status);
    console.log('Is Processed:', dbBatch?.isProcessed);
    console.log('Results Count:', dbBatch?.results?.length || 0);
    console.log('Submitted At:', dbBatch?.submittedAt);
    console.log('Completed At:', dbBatch?.completedAt || 'N/A');

    // Check for batch notification
    const notification = await workspaceDb.collection('batchnotifications').findOne({
      batchId,
      provider: 'openai'
    });

    console.log('\n\n📬 Batch Notification:');
    if (notification) {
      console.log('Exists:', true);
      console.log('Status:', notification.status);
      console.log('Processed:', notification.processed);
      console.log('Received At:', notification.receivedAt);
      console.log('Processed At:', notification.processedAt || 'N/A');
    } else {
      console.log('Exists:', false);
      console.log('⚠️  No notification created yet - pollOpenAIBatches job may not have run');
    }

    // Check for previous model results
    const resultsCount = await workspaceDb.collection('previousmodelresults').countDocuments({
      batchId
    });

    console.log('\n\n📊 Model Results:');
    console.log('Count:', resultsCount);

    if (resultsCount > 0) {
      const latestResult = await workspaceDb.collection('previousmodelresults').findOne(
        { batchId },
        { sort: { _id: -1 } }
      );

      console.log('\nLatest Result:');
      console.log('  Model:', latestResult.modelName);
      console.log('  Prompt:', latestResult.prompt?.substring(0, 60) + '...');
      console.log('  Has Sentiment:', !!latestResult.sentimentAnalysis);

      if (latestResult.sentimentAnalysis) {
        const brands = latestResult.sentimentAnalysis.brands || [];
        console.log('  Brands Found:', brands.length);
        brands.forEach(b => {
          if (b.mentioned) {
            console.log(`    - ${b.brandKeywords} (${b.sentiment})`);
          }
        });
      }
    }

    // Check pollOpenAIBatches job status
    const airankDb = mongoose.connection.useDb('airank');
    const pollJob = await airankDb.collection('agendaJobs').findOne({
      name: 'pollOpenAIBatches'
    });

    console.log('\n\n⏰ pollOpenAIBatches Job:');
    console.log('Next Run:', pollJob?.nextRunAt);
    console.log('Last Run:', pollJob?.lastRunAt || 'Never');
    console.log('Last Finished:', pollJob?.lastFinishedAt || 'Never');
    console.log('Repeat Interval:', pollJob?.repeatInterval);
    console.log('Disabled:', pollJob?.disabled || false);

    await mongoose.connection.close();

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
    await mongoose.connection.close();
  }
}

checkOpenAIBatch().catch(console.error);

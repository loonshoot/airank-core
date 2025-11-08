const mongoose = require('mongoose');

async function checkBatchSubmission() {
  const workspaceId = '690e14f33818ef2190cbb3a6';
  const batchId = 'batch_690e156b23248190b7b8d11cd5f2a5ad';

  await mongoose.connect(process.env.PROD_MONGO_URI);
  const workspaceDb = mongoose.connection.useDb(`workspace_${workspaceId}`);

  console.log('🔍 Checking Batch Submission Details');
  console.log('Workspace ID:', workspaceId);
  console.log('Batch ID:', batchId);
  console.log('=' .repeat(80));

  // Get the batch document
  const batch = await workspaceDb.collection('batches').findOne({ batchId });

  console.log('\n📦 Batch Document:');
  console.log('Status:', batch?.status);
  console.log('Provider:', batch?.provider);
  console.log('Model ID:', batch?.modelId);
  console.log('Request Count:', batch?.requestCount);
  console.log('Submitted At:', batch?.submittedAt);
  console.log('Completed At:', batch?.completedAt);
  console.log('Is Processed:', batch?.isProcessed);
  console.log('Input File ID:', batch?.inputFileId);
  console.log('Output File ID:', batch?.outputFileId);
  console.log('Results:', batch?.results?.length || 0);

  console.log('\n📝 Metadata:');
  console.log('Requests:', batch?.metadata?.requests?.length || 0);
  if (batch?.metadata?.requests?.length > 0) {
    console.log('\nFirst Request:');
    console.log('  Custom ID:', batch.metadata.requests[0].custom_id);
    console.log('  Model:', batch.metadata.requests[0].model);
  }

  // Parse the custom ID to get prompt info
  if (batch?.metadata?.requests?.length > 0) {
    const customId = batch.metadata.requests[0].custom_id;
    const parts = customId.split('-');
    console.log('\nParsed Custom ID:');
    console.log('  Workspace ID:', parts[0]);
    console.log('  Prompt ID:', parts[1]);
    console.log('  Model ID:', parts[2]);
    console.log('  Timestamp:', parts[3]);

    // Get the prompt
    const prompt = await workspaceDb.collection('prompts').findOne({
      _id: new mongoose.Types.ObjectId(parts[1])
    });

    if (prompt) {
      console.log('\n💬 Prompt:');
      console.log('  Text:', prompt.phrase);
    }
  }

  // Check if there's a notification
  const notification = await workspaceDb.collection('batchnotifications').findOne({
    batchId,
    provider: 'openai'
  });

  console.log('\n\n📬 Batch Notification:');
  if (notification) {
    console.log('Exists: Yes');
    console.log('Status:', notification.status);
    console.log('Processed:', notification.processed);
    console.log('Received At:', notification.receivedAt);
  } else {
    console.log('Exists: No');
  }

  // Check recent job runs
  const airankDb = mongoose.connection.useDb('airank');
  const recentJobs = await airankDb.collection('agendaJobs').find({
    name: { $in: ['promptModelTester', 'scheduleBatchJob'] },
    'data.workspaceId': workspaceId
  }).toArray();

  console.log('\n\n⏰ Recent Jobs:');
  recentJobs.forEach(job => {
    console.log(`\n${job.name}:`);
    console.log('  Next Run:', job.nextRunAt);
    console.log('  Last Run:', job.lastRunAt || 'Never');
    console.log('  Last Finished:', job.lastFinishedAt || 'Never');
    console.log('  Repeat:', job.repeatInterval || 'one-time');
    console.log('  Disabled:', job.disabled || false);
  });

  // Check batcher logs (if any error was logged)
  console.log('\n\n🔍 Analysis:');
  console.log('The batch ID format looks suspicious:');
  console.log('  Real OpenAI format: batch_<random_string>');
  console.log('  This batch ID:', batchId);
  console.log('  Pattern:', batchId.split('_')[1]);

  if (batchId.split('_')[1].length !== 26) {
    console.log('\n⚠️  WARNING: OpenAI batch IDs are typically 26 characters after "batch_"');
    console.log('  This one is:', batchId.split('_')[1].length, 'characters');
    console.log('  This suggests the batch was never actually submitted to OpenAI');
    console.log('  The batch document was created but the API call failed');
  }

  await mongoose.connection.close();
}

checkBatchSubmission().catch(console.error);

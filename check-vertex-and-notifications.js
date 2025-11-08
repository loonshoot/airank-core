const mongoose = require('mongoose');

async function checkVertexAndNotifications() {
  await mongoose.connect(process.env.PROD_MONGO_URI);
  const airankDb = mongoose.connection.useDb('airank');

  console.log('🔍 Checking Vertex AI Batches and Notifications');
  console.log('Time:', new Date().toISOString());
  console.log('=' .repeat(80));

  // Get the test workspace
  const workspace = await airankDb.collection('workspaces').findOne({ name: /Medium/i });

  if (!workspace) {
    console.log('❌ Workspace not found');
    await mongoose.connection.close();
    return;
  }

  const workspaceId = workspace._id.toString();
  const workspaceDb = mongoose.connection.useDb(`workspace_${workspaceId}`);

  console.log('\n🏢 Workspace:', workspace.name);
  console.log('ID:', workspaceId);

  // Check Vertex AI batches
  console.log('\n📦 Vertex AI Batches:');
  const vertexBatches = await workspaceDb.collection('batches').find({
    provider: 'vertex'
  }).sort({ submittedAt: -1 }).limit(5).toArray();

  console.log('Total Vertex batches found:', vertexBatches.length);

  for (const batch of vertexBatches) {
    console.log('\n  Batch ID:', batch.batchId);
    console.log('  MongoDB _id:', batch._id);
    console.log('  Status:', batch.status);
    console.log('  Submitted:', batch.submittedAt);
    console.log('  Completed:', batch.completedAt || 'N/A');
    console.log('  Processed:', batch.isProcessed);
    console.log('  Request Count:', batch.requestCount);
    console.log('  Results Count:', batch.results?.length || 0);
    console.log('  Model:', batch.modelId);
  }

  // Check batch notifications (both OpenAI and Vertex)
  console.log('\n\n📨 Batch Notifications:');
  const notifications = await workspaceDb.collection('batchnotifications').find({})
    .sort({ receivedAt: -1 }).limit(10).toArray();

  console.log('Total notifications found:', notifications.length);

  for (const notif of notifications) {
    console.log('\n  Provider:', notif.provider);
    console.log('  Batch ID:', notif.batchId);
    console.log('  Status:', notif.status);
    console.log('  Processed:', notif.processed);
    console.log('  Received:', notif.receivedAt);
    console.log('  Processed At:', notif.processedAt || 'N/A');
    console.log('  Created By:', notif.createdBy || 'N/A');

    if (notif.provider === 'vertex') {
      console.log('  GCS Path:', notif.gcsOutputPath || 'N/A');
    } else if (notif.provider === 'openai') {
      console.log('  Output File ID:', notif.outputFileId || 'N/A');
    }
  }

  // Check previousmodelresults
  console.log('\n\n📊 Previous Model Results:');
  const results = await workspaceDb.collection('previousmodelresults').find({})
    .sort({ processedAt: -1 }).limit(10).toArray();

  console.log('Total results found:', results.length);

  if (results.length > 0) {
    for (const result of results) {
      console.log('\n  Model:', result.modelName || result.modelId);
      console.log('  Batch ID:', result.batchId || 'N/A');
      console.log('  Provider:', result.provider);
      console.log('  Processed:', result.processedAt);
      console.log('  Has Sentiment:', !!result.sentimentAnalysis);
      if (result.sentimentAnalysis?.brands) {
        console.log('  Brands Found:', result.sentimentAnalysis.brands.filter(b => b.mentioned).length);
      }
    }
  } else {
    console.log('  ⚠️  No previous model results found');
  }

  // Check if there are unprocessed notifications
  const unprocessedNotifs = await workspaceDb.collection('batchnotifications').find({
    processed: false
  }).toArray();

  console.log('\n\n⚠️  Unprocessed Notifications:', unprocessedNotifs.length);

  if (unprocessedNotifs.length > 0) {
    console.log('\nUnprocessed notifications:');
    for (const notif of unprocessedNotifs) {
      console.log(`  - ${notif.provider}: ${notif.batchId} (status: ${notif.status}, received: ${notif.receivedAt})`);
    }
    console.log('\n💡 These notifications need to be processed by the batch processor jobs');
  }

  // Check agenda jobs for batch processing
  console.log('\n\n📅 Batch Processing Jobs:');
  const jobs = await airankDb.collection('agendaJobs').find({
    name: { $in: ['processOpenAIBatchNotification', 'processVertexBatchNotification'] }
  }).toArray();

  for (const job of jobs) {
    console.log('\n  Job:', job.name);
    console.log('  Next Run:', job.nextRunAt);
    console.log('  Last Run:', job.lastRunAt || 'Never');
    console.log('  Disabled:', job.disabled || false);
  }

  await mongoose.connection.close();
}

checkVertexAndNotifications().catch(console.error);

const mongoose = require('mongoose');

async function checkVertexStatus() {
  await mongoose.connect(process.env.PROD_MONGO_URI);
  const airankDb = mongoose.connection.useDb('airank');

  console.log('🔍 Checking Vertex AI Status - Detailed Analysis');
  console.log('Time:', new Date().toISOString());
  console.log('=' .repeat(80));

  const workspaceId = '690f7b6056f9ee90ea8cdbe2';
  const workspaceDb = mongoose.connection.useDb(`workspace_${workspaceId}`);

  console.log('\n🏢 Workspace ID:', workspaceId);

  // Check Vertex AI batches
  console.log('\n📦 Vertex AI Batches:');
  const vertexBatches = await workspaceDb.collection('batches').find({
    provider: 'vertex'
  }).sort({ submittedAt: -1 }).toArray();

  console.log('Total Vertex batches found:', vertexBatches.length);

  for (const batch of vertexBatches) {
    console.log('\n  Batch:', batch.batchId);
    console.log('  MongoDB _id:', batch._id);
    console.log('  Status:', batch.status);
    console.log('  Submitted:', batch.submittedAt);
    console.log('  Completed:', batch.completedAt || 'N/A');
    console.log('  Processed:', batch.isProcessed);
    console.log('  Request Count:', batch.requestCount);
    console.log('  Results Count:', batch.results?.length || 0);
    console.log('  Model:', batch.modelId);
    console.log('  Model Type:', batch.modelType);

    if (batch.results && batch.results.length > 0) {
      console.log('  First Result Sample:', JSON.stringify(batch.results[0], null, 2).substring(0, 200));
    }
  }

  // Check ALL batch notifications
  console.log('\n\n📨 All Batch Notifications:');
  const allNotifications = await workspaceDb.collection('batchnotifications').find({})
    .sort({ receivedAt: -1 }).toArray();

  console.log('Total notifications found:', allNotifications.length);

  for (const notif of allNotifications) {
    console.log('\n  Provider:', notif.provider);
    console.log('  Batch ID:', notif.batchId || 'N/A');
    console.log('  Status:', notif.status);
    console.log('  Processed:', notif.processed);
    console.log('  Received:', notif.receivedAt);
    console.log('  Processed At:', notif.processedAt || 'N/A');
    console.log('  Created By:', notif.createdBy || 'N/A');

    if (notif.provider === 'vertex') {
      console.log('  GCS URI:', notif.gcsUri || 'N/A');
      console.log('  Bucket:', notif.bucket || 'N/A');
      console.log('  File Name:', notif.fileName || 'N/A');
    }
  }

  // Check previousmodelresults
  console.log('\n\n📊 Previous Model Results:');
  const results = await workspaceDb.collection('previousmodelresults').find({})
    .sort({ processedAt: -1 }).toArray();

  console.log('Total results found:', results.length);

  if (results.length > 0) {
    for (const result of results) {
      console.log('\n  Model:', result.modelName || result.modelId);
      console.log('  Batch ID:', result.batchId || 'N/A');
      console.log('  Provider:', result.provider);
      console.log('  Processed:', result.processedAt);
      console.log('  Response Length:', result.response?.length || 0);
      console.log('  Has Sentiment:', !!result.sentimentAnalysis);
    }
  }

  // Check listener jobs
  console.log('\n\n📅 Batch Processing Jobs:');
  const jobs = await airankDb.collection('agendaJobs').find({
    name: { $regex: /batch/i }
  }).sort({ lastFinishedAt: -1 }).limit(10).toArray();

  for (const job of jobs) {
    console.log('\n  Job:', job.name);
    console.log('  Last Run:', job.lastRunAt || 'Never');
    console.log('  Last Finished:', job.lastFinishedAt || 'Never');
    console.log('  Next Run:', job.nextRunAt || 'N/A');
    console.log('  Disabled:', job.disabled || false);

    if (job.failedAt) {
      console.log('  Failed At:', job.failedAt);
      console.log('  Failed Reason:', job.failedReason);
    }
  }

  await mongoose.connection.close();
}

checkVertexStatus().catch(console.error);

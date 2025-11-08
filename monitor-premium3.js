const mongoose = require('mongoose');

async function monitorPremium3() {
  await mongoose.connect(process.env.PROD_MONGO_URI);
  const airankDb = mongoose.connection.useDb('airank');

  const workspace = await airankDb.collection('workspaces').findOne({ name: 'Premium 3' });
  const workspaceId = workspace._id.toString();

  console.log('🔍 Monitoring Premium 3 Workspace:', workspaceId);
  console.log('Time:', new Date().toISOString());
  console.log('=' .repeat(80));

  // Check recurring job
  const recurringJob = await airankDb.collection('agendaJobs').findOne({
    name: 'promptModelTester',
    'data.workspaceId': workspaceId,
    repeatInterval: { $ne: null }
  });

  console.log('\n📅 Recurring Job Status:');
  console.log('Next Run:', recurringJob?.nextRunAt);
  console.log('Last Run:', recurringJob?.lastRunAt);
  console.log('Last Finished:', recurringJob?.lastFinishedAt);
  console.log('Locked At:', recurringJob?.lockedAt);

  const now = new Date();
  if (recurringJob?.nextRunAt && recurringJob.nextRunAt < now) {
    console.log('⏰ Job is PAST DUE - should run soon!');
  }

  if (recurringJob?.lastRunAt) {
    console.log('✅ Job has run! Last execution:', recurringJob.lastRunAt);
  } else {
    console.log('⏳ Job has NOT run yet');
  }

  // Check for any one-time jobs
  const oneTimeJobs = await airankDb.collection('agendaJobs').find({
    name: 'promptModelTester',
    'data.workspaceId': workspaceId,
    repeatInterval: null
  }).toArray();

  if (oneTimeJobs.length > 0) {
    console.log('\n📋 One-time Jobs:', oneTimeJobs.length);
    oneTimeJobs.forEach(job => {
      console.log('  - Next Run:', job.nextRunAt);
      console.log('    Last Run:', job.lastRunAt);
      console.log('    Locked:', job.lockedAt);
    });
  }

  // Check workspace database
  const workspaceDb = mongoose.connection.useDb(`workspace_${workspaceId}`);

  const batchCount = await workspaceDb.collection('batches').countDocuments({});
  const resultCount = await workspaceDb.collection('previousmodelresults').countDocuments({});

  console.log('\n📊 Workspace Data:');
  console.log('Batches:', batchCount);
  console.log('Results:', resultCount);

  // Get latest batch if exists
  const latestBatch = await workspaceDb.collection('batches').findOne({}, { sort: { submittedAt: -1 } });
  if (latestBatch) {
    console.log('\nLatest Batch:');
    console.log('  ID:', latestBatch.batchId);
    console.log('  Provider:', latestBatch.provider);
    console.log('  Status:', latestBatch.status);
    console.log('  Submitted:', latestBatch.submittedAt);
  }

  // Get latest result
  const latestResult = await workspaceDb.collection('previousmodelresults').findOne({}, { sort: { _id: -1 } });
  if (latestResult) {
    console.log('\nLatest Result:');
    console.log('  Model:', latestResult.modelName);
    console.log('  Batch ID:', latestResult.batchId || 'N/A');
    console.log('  Created:', latestResult._id.getTimestamp());
  }

  await mongoose.connection.close();
}

monitorPremium3().catch(console.error);

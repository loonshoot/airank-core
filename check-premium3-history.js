const mongoose = require('mongoose');

async function checkPremium3History() {
  await mongoose.connect(process.env.PROD_MONGO_URI);
  const airankDb = mongoose.connection.useDb('airank');

  // Get Premium 3 workspace
  const workspace = await airankDb.collection('workspaces').findOne({ name: 'Premium 3' });
  const workspaceId = workspace._id.toString();

  console.log('🏢 Premium 3 Workspace');
  console.log('ID:', workspaceId);
  console.log('Models:', workspace.models);
  console.log('Plan:', workspace.plan);
  console.log();

  // Check workspace database for all data
  const workspaceDb = mongoose.connection.useDb(`workspace_${workspaceId}`);

  // Check previous model results with timestamps
  const results = await workspaceDb.collection('previousmodelresults').find({})
    .sort({ processedAt: -1 })
    .toArray();

  console.log('📊 Previous Model Results:', results.length);
  results.forEach((r, i) => {
    console.log(`\n  ${i + 1}. Model: ${r.modelName || r.modelId}`);
    console.log('     Processed:', r.processedAt);
    console.log('     Prompt:', r.prompt?.substring(0, 60) + '...');
    console.log('     Provider:', r.provider);
    console.log('     Has Sentiment:', !!r.sentimentAnalysis);
    if (r.sentimentAnalysis) {
      console.log('     Sentiment Brands:', r.sentimentAnalysis.brands?.length || 0);
    }
  });

  // Check batches
  const batches = await workspaceDb.collection('batches').find({})
    .sort({ submittedAt: -1 })
    .toArray();

  console.log('\n\n📦 Batches:', batches.length);
  batches.forEach((b, i) => {
    console.log(`\n  ${i + 1}. ${b.batchId}`);
    console.log('     Provider:', b.provider);
    console.log('     Status:', b.status);
    console.log('     Submitted:', b.submittedAt);
    console.log('     Processed:', b.isProcessed);
  });

  // Check for any deleted jobs in the system
  console.log('\n\n🔍 Searching for deleted/cancelled jobs across entire system...');
  const deletedJobs = await airankDb.collection('agendaJobs').find({
    'data.workspaceId': workspaceId,
    $or: [
      { disabled: true },
      { failedAt: { $exists: true } }
    ]
  }).toArray();

  console.log('Found', deletedJobs.length, 'disabled/failed jobs');
  deletedJobs.forEach(job => {
    console.log('\n  Job:', job.name);
    console.log('  Disabled:', job.disabled);
    console.log('  Failed:', job.failedAt);
    console.log('  Failed Reason:', job.failedReason);
  });

  await mongoose.connection.close();
}

checkPremium3History().catch(console.error);

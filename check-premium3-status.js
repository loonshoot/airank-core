const mongoose = require('mongoose');

async function checkPremium3Status() {
  await mongoose.connect(process.env.PROD_MONGO_URI);
  const airankDb = mongoose.connection.useDb('airank');

  // Get Premium 3 workspace
  const workspace = await airankDb.collection('workspaces').findOne({ name: 'Premium 3' });

  if (!workspace) {
    console.log('❌ Premium 3 workspace not found');
    await mongoose.connection.close();
    return;
  }

  const workspaceId = workspace._id.toString();
  console.log('🏢 Premium 3 Workspace');
  console.log('ID:', workspaceId);
  console.log('Plan:', workspace.plan);
  console.log();

  // Connect to workspace database
  const workspaceDb = mongoose.connection.useDb(`workspace_${workspaceId}`);

  // Check brands
  const brands = await workspaceDb.collection('brands').find({}).toArray();
  console.log('🏷️  Brands:', brands.length);
  brands.forEach(b => {
    console.log('  -', b.name, `(${b.isOwnBrand ? 'own' : 'competitor'})`);
  });
  console.log();

  // Check prompts
  const prompts = await workspaceDb.collection('prompts').find({}).toArray();
  console.log('💬 Prompts:', prompts.length);
  console.log();

  // Check models configured
  const workspaceModels = workspace.models || [];
  console.log('🤖 Models configured:', workspaceModels.length);
  workspaceModels.forEach(m => console.log('  -', m));
  console.log();

  // Check batches
  const batches = await workspaceDb.collection('batches').find({}).toArray();
  console.log('📦 Batches:', batches.length);
  if (batches.length > 0) {
    batches.forEach(b => {
      console.log('  -', b.batchId || b._id);
      console.log('    Provider:', b.provider);
      console.log('    Status:', b.status);
      console.log('    Processed:', b.isProcessed);
      console.log('    Results:', b.results?.length || 0);
      console.log();
    });
  }
  console.log();

  // Check previous model results
  const results = await workspaceDb.collection('previousmodelresults').find({}).toArray();
  console.log('📊 Previous Model Results:', results.length);
  console.log();

  // Check all jobs in agenda (not just workspace-specific)
  const allJobs = await airankDb.collection('agendaJobs').find({
    disabled: { $ne: true }
  }).toArray();

  console.log('📅 All Active Jobs in System:', allJobs.length);
  allJobs.forEach(job => {
    console.log('  -', job.name);
    console.log('    Workspace:', job.data?.workspaceId || 'N/A');
    console.log('    Next Run:', job.nextRunAt);
    console.log('    Repeat:', job.repeatInterval || 'one-time');
    console.log();
  });

  await mongoose.connection.close();
}

checkPremium3Status().catch(console.error);

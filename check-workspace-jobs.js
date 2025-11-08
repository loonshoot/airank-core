const mongoose = require('mongoose');

async function checkAllWorkspaceJobs() {
  await mongoose.connect(process.env.PROD_MONGO_URI);
  const airankDb = mongoose.connection.useDb('airank');

  // Get all workspaces
  const workspaces = await airankDb.collection('workspaces').find({}).toArray();

  console.log('🏢 Found', workspaces.length, 'workspaces\n');

  // Check jobs for each workspace
  for (const workspace of workspaces) {
    const workspaceId = workspace._id.toString();
    console.log('=' .repeat(80));
    console.log('Workspace:', workspace.name);
    console.log('ID:', workspaceId);
    console.log('Plan:', workspace.plan);

    // Find all jobs for this workspace
    const jobs = await airankDb.collection('agendaJobs').find({
      'data.workspaceId': workspaceId,
      disabled: { $ne: true }
    }).toArray();

    if (jobs.length === 0) {
      console.log('❌ No active jobs found');
    } else {
      console.log('📅 Found', jobs.length, 'active jobs:\n');

      for (const job of jobs) {
        console.log('  Job:', job.name);
        console.log('  Next Run:', job.nextRunAt);
        console.log('  Last Run:', job.lastRunAt);
        console.log('  Repeat:', job.repeatInterval);
        console.log('  Type:', job.type);
        console.log();
      }
    }
    console.log();
  }

  await mongoose.connection.close();
}

checkAllWorkspaceJobs().catch(console.error);

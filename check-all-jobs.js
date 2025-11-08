const mongoose = require('mongoose');

async function checkAllJobs() {
  await mongoose.connect(process.env.PROD_MONGO_URI);
  const airankDb = mongoose.connection.useDb('airank');

  // Get Premium 3 workspace
  const workspace = await airankDb.collection('workspaces').findOne({ name: 'Premium 3' });
  const workspaceId = workspace._id.toString();

  console.log('🔍 Searching for ALL jobs for Premium 3 (including disabled/completed)');
  console.log('Workspace ID:', workspaceId);
  console.log();

  // Check ALL jobs for this workspace (including disabled and completed)
  const allJobs = await airankDb.collection('agendaJobs').find({
    'data.workspaceId': workspaceId
  }).sort({ lastModifiedDate: -1 }).toArray();

  console.log('📅 Found', allJobs.length, 'total jobs (including disabled/completed):\n');

  for (const job of allJobs) {
    console.log('Job Name:', job.name);
    console.log('  Type:', job.type);
    console.log('  Disabled:', job.disabled || false);
    console.log('  Next Run:', job.nextRunAt);
    console.log('  Last Run:', job.lastRunAt);
    console.log('  Last Finished:', job.lastFinishedAt);
    console.log('  Failed At:', job.failedAt);
    console.log('  Repeat:', job.repeatInterval || 'one-time');
    console.log('  Last Modified:', job.lastModifiedDate);

    if (job.failedReason) {
      console.log('  ❌ Failed Reason:', job.failedReason);
    }

    if (job.lastRunAt && job.lastFinishedAt) {
      const duration = new Date(job.lastFinishedAt) - new Date(job.lastRunAt);
      console.log('  Duration:', duration + 'ms');
    }

    console.log();
  }

  // Also check the workspace models to confirm they exist
  console.log('=' .repeat(80));
  console.log('Workspace Configuration:');
  console.log('Models:', workspace.models);
  console.log('Plan:', workspace.plan);
  console.log();

  await mongoose.connection.close();
}

checkAllJobs().catch(console.error);

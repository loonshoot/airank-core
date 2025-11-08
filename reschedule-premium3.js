const mongoose = require('mongoose');

async function reschedulePremium3Jobs() {
  await mongoose.connect(process.env.PROD_MONGO_URI);
  const airankDb = mongoose.connection.useDb('airank');

  // Find Premium 3 workspace
  const workspace = await airankDb.collection('workspaces').findOne({ name: 'Premium 3' });

  if (!workspace) {
    console.log('❌ Premium 3 workspace not found');
    await mongoose.connection.close();
    return;
  }

  const workspaceId = workspace._id.toString();
  console.log('📋 Premium 3 Workspace ID:', workspaceId);

  // Check for scheduled jobs in agenda
  const jobs = await airankDb.collection('agendaJobs').find({
    'data.workspaceId': workspaceId,
    disabled: { $ne: true }
  }).toArray();

  console.log('\n📅 Found', jobs.length, 'jobs for Premium 3:\n');

  for (const job of jobs) {
    console.log(`${job.name}`);
    console.log('   Current Next Run:', job.nextRunAt);
    console.log('   Last Run:', job.lastRunAt);
    console.log('   Repeat:', job.repeatInterval);

    // Update nextRunAt to now
    const now = new Date();
    await airankDb.collection('agendaJobs').updateOne(
      { _id: job._id },
      { $set: { nextRunAt: now } }
    );

    console.log('   ✅ Updated Next Run to:', now);
    console.log();
  }

  console.log('✅ All Premium 3 jobs rescheduled to run immediately');

  await mongoose.connection.close();
}

reschedulePremium3Jobs().catch(console.error);

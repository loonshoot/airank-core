const mongoose = require('mongoose');

async function createPremium3BatchJob() {
  await mongoose.connect(process.env.PROD_MONGO_URI);
  const airankDb = mongoose.connection.useDb('airank');

  // Get Premium 3 workspace
  const workspace = await airankDb.collection('workspaces').findOne({ name: 'Premium 3' });
  const workspaceId = workspace._id.toString();

  console.log('🏢 Premium 3 Workspace');
  console.log('ID:', workspaceId);
  console.log();

  // Check if a promptModelTester recurring job already exists
  const existingJob = await airankDb.collection('agendaJobs').findOne({
    name: 'promptModelTester',
    'data.workspaceId': workspaceId,
    repeatInterval: { $ne: null }
  });

  if (existingJob) {
    console.log('⚠️  Recurring promptModelTester already exists!');
    console.log('Job ID:', existingJob._id);
    console.log('Next Run:', existingJob.nextRunAt);
    console.log('Disabled:', existingJob.disabled);
    console.log();

    // If it exists but is disabled, enable it
    if (existingJob.disabled) {
      await airankDb.collection('agendaJobs').updateOne(
        { _id: existingJob._id },
        { $set: { disabled: false, nextRunAt: new Date() } }
      );
      console.log('✅ Enabled the job and set it to run now');
    } else {
      // Just reschedule it to run now
      await airankDb.collection('agendaJobs').updateOne(
        { _id: existingJob._id },
        { $set: { nextRunAt: new Date() } }
      );
      console.log('✅ Rescheduled the job to run now');
    }
  } else {
    console.log('📅 Creating new recurring promptModelTester for Premium 3...');

    // Create the recurring batch job
    const now = new Date();
    const job = {
      name: 'promptModelTester',
      data: {
        workspaceId: workspaceId
      },
      type: 'normal',
      priority: 0,
      nextRunAt: now, // Run immediately
      repeatInterval: '1 day', // Run daily
      repeatTimezone: null,
      lastModifiedDate: now,
      lockedAt: null,
      lastRunAt: null,
      lastFinishedAt: null,
      disabled: false
    };

    const result = await airankDb.collection('agendaJobs').insertOne(job);
    console.log('✅ Created recurring promptModelTester job');
    console.log('Job ID:', result.insertedId);
    console.log('Next Run:', now);
    console.log('Repeat Interval: 1 day');
  }

  await mongoose.connection.close();
}

createPremium3BatchJob().catch(console.error);

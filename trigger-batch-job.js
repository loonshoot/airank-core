const mongoose = require('mongoose');

async function triggerBatchJob() {
  try {
    const mongoUri = process.env.PROD_MONGO_URI;

    await mongoose.connect(mongoUri);
    console.log('✓ Connected to production database\n');

    const airankDb = mongoose.connection.client.db('airank');

    // Find the papercut workspace (case-insensitive)
    const workspace = await airankDb.collection('workspaces').findOne({
      $or: [
        { name: 'PaperCut' },
        { slug: 'papercut' },
        { _id: new mongoose.Types.ObjectId('6902c11e7a5fc7c6a60bbe9b') }
      ]
    });

    if (!workspace) {
      console.log('⚠️  Workspace "papercut" not found');
      process.exit(1);
    }

    console.log('Found workspace:', workspace.name);
    console.log('Workspace ID:', workspace._id.toString());

    // Find pending batch jobs for this workspace
    const jobs = await airankDb.collection('agendaJobs').find({
      name: 'processBatchResults',
      'data.workspaceId': workspace._id.toString()
    }).toArray();

    console.log('\nFound', jobs.length, 'processBatchResults jobs for papercut\n');

    if (jobs.length === 0) {
      console.log('No jobs found to trigger');
      await mongoose.connection.close();
      process.exit(0);
    }

    // Update the first job to run immediately
    const job = jobs[0];
    console.log('Triggering job:', job._id);
    console.log('Current nextRunAt:', job.nextRunAt);

    const result = await airankDb.collection('agendaJobs').updateOne(
      { _id: job._id },
      {
        $set: {
          nextRunAt: new Date(),
          lockedAt: null
        }
      }
    );

    console.log('\n✅ Job updated to run immediately');
    console.log('Modified count:', result.modifiedCount);
    console.log('\nWaiting for job to execute (checking every 5 seconds)...\n');

    // Poll for job completion
    for (let i = 0; i < 12; i++) { // Wait up to 60 seconds
      await new Promise(resolve => setTimeout(resolve, 5000));

      const updatedJob = await airankDb.collection('agendaJobs').findOne({ _id: job._id });

      if (updatedJob.lastFinishedAt && updatedJob.lastFinishedAt > job.lastFinishedAt) {
        console.log('✅ Job completed!');
        console.log('Last run:', updatedJob.lastRunAt);
        console.log('Last finished:', updatedJob.lastFinishedAt);

        if (updatedJob.failedAt && updatedJob.failedAt > job.failedAt) {
          console.log('\n❌ Job failed!');
          console.log('Fail reason:', updatedJob.failReason);
        } else {
          console.log('\n✅ Job succeeded!');
        }
        break;
      } else if (updatedJob.lockedAt) {
        console.log(`⏳ Job is running... (${(i + 1) * 5}s elapsed)`);
      } else {
        console.log(`⏸️  Job not started yet... (${(i + 1) * 5}s elapsed)`);
      }
    }

    await mongoose.connection.close();
    console.log('\n✓ Disconnected');

  } catch (error) {
    console.error('💥 Error:', error.message);
    process.exit(1);
  }
}

triggerBatchJob();

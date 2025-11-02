const mongoose = require('mongoose');

async function monitorBatchJob() {
  try {
    const mongoUri = process.env.PROD_MONGO_URI;
    
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to production database\n');

    const airankDb = mongoose.connection.client.db('airank');

    // Find the papercut workspace
    const workspace = await airankDb.collection('workspaces').findOne({
      _id: new mongoose.Types.ObjectId('6902c11e7a5fc7c6a60bbe9b')
    });

    console.log('Monitoring batch job for workspace:', workspace.name);
    console.log('Workspace ID:', workspace._id.toString());
    
    // Find the job
    const jobs = await airankDb.collection('agendaJobs').find({
      name: 'processBatchResults',
      'data.workspaceId': workspace._id.toString()
    }).toArray();
    
    if (jobs.length === 0) {
      console.log('\n⚠️  No processBatchResults jobs found');
      await mongoose.connection.close();
      process.exit(0);
    }
    
    const job = jobs[0];
    console.log('\nFound job:', job._id);
    console.log('Next run at:', job.nextRunAt);
    console.log('Last finished at:', job.lastFinishedAt || 'Never');
    console.log('\nMonitoring job execution (checking every 5 seconds)...\n');
    
    let previousState = {
      lockedAt: job.lockedAt,
      lastRunAt: job.lastRunAt,
      lastFinishedAt: job.lastFinishedAt,
      failedAt: job.failedAt
    };
    
    // Poll for changes
    for (let i = 0; i < 30; i++) { // Monitor for up to 2.5 minutes
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const updatedJob = await airankDb.collection('agendaJobs').findOne({ _id: job._id });
      const timeElapsed = (i + 1) * 5;
      
      // Check for state changes
      if (updatedJob.lockedAt && updatedJob.lockedAt !== previousState.lockedAt) {
        console.log(`⏳ [${timeElapsed}s] Job started running...`);
        console.log(`   Locked at: ${updatedJob.lockedAt}`);
        previousState.lockedAt = updatedJob.lockedAt;
      }
      
      if (updatedJob.lastRunAt && updatedJob.lastRunAt !== previousState.lastRunAt) {
        console.log(`▶️  [${timeElapsed}s] Job execution began`);
        console.log(`   Run started: ${updatedJob.lastRunAt}`);
        previousState.lastRunAt = updatedJob.lastRunAt;
      }
      
      if (updatedJob.lastFinishedAt && updatedJob.lastFinishedAt !== previousState.lastFinishedAt) {
        console.log(`\n✅ [${timeElapsed}s] Job completed!`);
        console.log(`   Finished at: ${updatedJob.lastFinishedAt}`);
        
        if (updatedJob.failedAt && updatedJob.failedAt !== previousState.failedAt) {
          console.log('\n❌ Job failed!');
          console.log('Fail reason:', updatedJob.failReason);
        } else {
          console.log('\n✅ Job succeeded!');
        }
        
        // Show job details
        if (updatedJob.data) {
          console.log('\nJob data:');
          console.log('  Document ID:', updatedJob.data.documentId);
          console.log('  Workspace ID:', updatedJob.data.workspaceId);
        }
        
        break;
      }
      
      // Show waiting message every 15 seconds
      if (timeElapsed % 15 === 0) {
        console.log(`⏸️  [${timeElapsed}s] Waiting for job to execute...`);
      }
    }

    await mongoose.connection.close();
    console.log('\n✓ Monitoring complete');

  } catch (error) {
    console.error('💥 Error:', error.message);
    process.exit(1);
  }
}

monitorBatchJob();

const mongoose = require('mongoose');

/**
 * Schedule the pollOpenAIBatches job to run every 5 minutes
 */
async function scheduleOpenAIPoll() {
  try {
    const mongoUri = process.env.PROD_MONGO_URI;

    if (!mongoUri) {
      throw new Error('PROD_MONGO_URI environment variable not set');
    }

    console.log('Connecting to production database...');
    await mongoose.connect(mongoUri);
    const db = mongoose.connection.db;

    // Define the job
    const jobName = 'pollOpenAIBatches';
    const repeatInterval = '5 minutes'; // For testing, will change to 1 hour later

    // Check if job already exists
    const existingJob = await db.collection('agendaJobs').findOne({
      name: jobName
    });

    if (existingJob) {
      console.log(`\n⚠️  Job "${jobName}" already exists`);
      console.log('Current schedule:', existingJob.repeatInterval);
      console.log('Next run:', existingJob.nextRunAt);

      // Update the interval
      await db.collection('agendaJobs').updateOne(
        { name: jobName },
        {
          $set: {
            repeatInterval: repeatInterval,
            nextRunAt: new Date(), // Run immediately
            lastModifiedBy: new Date()
          }
        }
      );
      console.log(`\n✅ Updated job to run every ${repeatInterval}`);
      console.log('Next run: immediately');
    } else {
      // Create new job
      const job = {
        name: jobName,
        type: 'normal',
        priority: 0,
        repeatInterval: repeatInterval,
        repeatTimezone: null,
        nextRunAt: new Date(), // Run immediately
        lastModifiedBy: new Date(),
        lockedAt: null,
        lastRunAt: null,
        lastFinishedAt: null,
        disabled: false,
        data: {}
      };

      await db.collection('agendaJobs').insertOne(job);
      console.log(`\n✅ Created job "${jobName}" to run every ${repeatInterval}`);
      console.log('Next run: immediately');
    }

    await mongoose.connection.close();
    console.log('\n✅ Done!');

  } catch (error) {
    console.error('❌ Error scheduling job:', error);
    process.exit(1);
  }
}

scheduleOpenAIPoll();

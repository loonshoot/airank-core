const Agenda = require('agenda');
require('dotenv').config();

const mongoUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;

async function triggerJob() {
  const agenda = new Agenda({ db: { address: mongoUri, collection: 'jobs' } });
  
  try {
    console.log('Connecting to Agenda...');
    await agenda.start();
    console.log('Connected to Agenda');
    
    const workspaceId = process.argv[2] || '690089a0df6b55271c136dee';
    
    console.log(`Triggering promptModelTester job for workspace: ${workspaceId}`);
    
    // Schedule the job to run now
    const job = await agenda.now('promptModelTester', {
      workspaceId: workspaceId
    });
    
    console.log(`✅ Successfully triggered promptModelTester job for workspace: ${workspaceId}`);
    console.log(`Job ID: ${job.attrs._id}`);
    console.log(`Job scheduled for: ${job.attrs.nextRunAt}`);
    
    // Wait a moment to ensure the job is saved
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await agenda.stop();
    console.log('Agenda stopped');
    process.exit(0);
    
  } catch (error) {
    console.error('Error triggering job:', error);
    process.exit(1);
  }
}

console.log('Starting job trigger script...');
triggerJob(); 
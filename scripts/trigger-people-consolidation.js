const mongoose = require('mongoose');
require('dotenv').config();

// Get MongoDB client
const MongoClient = require('mongodb').MongoClient;

async function triggerConsolidation() {
  try {
    console.log('Starting people consolidation trigger script');
    
    // These values should match your Contact record
    const sourceId = '682b91c643ea2443084ed655';
    const objectId = '682b91cddb409a019f9ded57'; // ID of the record in _consolidated collection
    const sourceType = 'salesforce';
    const workspaceId = '6824f4a47c8028d89b6ff8d6'; // From cleanup.js
    
    // Connect to MongoDB directly to see what's happening
    const client = await MongoClient.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017');
    const db = client.db(`workspace_${workspaceId}`);
    
    // Get the consolidated record
    const consolidatedRecord = await db.collection(`source_${sourceId}_consolidated`).findOne({
      _id: new mongoose.Types.ObjectId(objectId)
    });
    
    console.log('Found consolidated record:', !!consolidatedRecord);
    if (consolidatedRecord) {
      console.log('Record metadata:', JSON.stringify(consolidatedRecord.metadata));
      console.log('Record has these fields:', Object.keys(consolidatedRecord.record).join(', '));
    }
    
    // Create the agenda definition
    const Agenda = require('agenda');
    const agenda = new Agenda({
      db: { address: process.env.MONGODB_URI || 'mongodb://localhost:27017/outrun', collection: 'jobs' }
    });
    
    // Define the job
    agenda.define('consolidatePeople', async (job, done) => {
      try {
        console.log('Running consolidatePeople job with data:', job.attrs.data);
        
        // Import the actual job implementation to run it directly
        const consolidatePeopleJob = require('../config/common/consolidatePeople/batchJob');
        await consolidatePeopleJob.job(job, done);
      } catch (error) {
        console.error('Error in job:', error);
        done(error);
      }
    });
    
    // Start agenda and queue job
    await agenda.start();
    console.log('Agenda started');
    
    // Queue the job
    await agenda.now('consolidatePeople', {
      sourceId,
      sourceType,
      workspaceId,
      objectId
    });
    
    console.log('Job queued successfully');
    
    // Wait a bit to allow job to process
    console.log('Waiting for job to process...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Check if the people record was created
    const peopleRecord = await db.collection('people').findOne({
      'externalIds.salesforce.id': consolidatedRecord.record.Id
    });
    
    console.log('People record created:', !!peopleRecord);
    if (peopleRecord) {
      console.log('People record fields:', Object.keys(peopleRecord).join(', '));
    } else {
      console.log('No people record found');
    }
    
    // Clean up
    await agenda.stop();
    await client.close();
    console.log('Script completed');
    process.exit(0);
  } catch (error) {
    console.error('Error in consolidation trigger script:', error);
    process.exit(1);
  }
}

// Run the function
triggerConsolidation(); 
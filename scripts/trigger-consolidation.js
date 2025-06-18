const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

// Import your agenda setup
const agenda = require('../lib/agenda');

async function triggerConsolidation() {
  try {
    console.log('Starting consolidation trigger script');
    
    // These values should match your Contact record
    const sourceId = '682b8de087ec70294b799acf';
    const objectId = '682b8de58bb84f62dd6c955c';
    const sourceType = 'salesforce';
    const workspaceId = process.env.WORKSPACE_ID || 'your-workspace-id';
    const objectType = 'Contact';
    
    console.log('Triggering consolidation with params:', {
      sourceId,
      sourceType,
      workspaceId,
      objectId,
      objectType
    });
    
    // Directly queue the job
    await agenda.now('consolidateRecord', {
      sourceId,
      sourceType,
      workspaceId,
      objectId,
      objectType
    });
    
    console.log('Job queued successfully');
    
    // Wait a bit to allow job to process
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Clean up
    await agenda.stop();
    console.log('Script completed');
    process.exit(0);
  } catch (error) {
    console.error('Error in consolidation trigger script:', error);
    process.exit(1);
  }
}

// Run the function
triggerConsolidation(); 
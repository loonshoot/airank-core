#!/usr/bin/env node

const Agenda = require('agenda');
require('dotenv').config();

const mongoUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;

async function triggerSentimentReanalysis() {
    const agenda = new Agenda({ db: { address: mongoUri, collection: 'jobs' } });
    
    try {
        console.log('🔄 Connecting to Agenda...');
        await agenda.start();
        console.log('✅ Connected to Agenda');
        
        const workspaceId = '68568b24760cfe6918a6fba9';
        
        console.log('🔄 Triggering sentiment re-analysis job...');
        console.log(`📊 Workspace ID: ${workspaceId}`);
        
        // Schedule the job to run now
        const job = await agenda.now('sentimentReanalysis', {
            workspaceId: workspaceId
        });
        
        console.log('✅ Sentiment re-analysis job scheduled successfully!');
        console.log(`🆔 Job ID: ${job.attrs._id}`);
        console.log(`⏰ Job scheduled for: ${job.attrs.nextRunAt}`);
        console.log('');
        console.log('📋 This job will:');
        console.log('   • Find all existing model results');
        console.log('   • Re-run sentiment analysis with new structure');
        console.log('   • Override old sentiment data');
        console.log('   • Use only Gemini API calls (no expensive model generation)');
        console.log('');
        console.log('💰 Cost: Only sentiment analysis calls (~15 results × $0.001 = ~$0.015)');
        
        // Wait a moment to ensure the job is saved
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        await agenda.stop();
        console.log('🔌 Agenda stopped');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Error triggering sentiment re-analysis:', error);
        process.exit(1);
    }
}

console.log('🚀 Starting sentiment re-analysis trigger script...');
triggerSentimentReanalysis(); 
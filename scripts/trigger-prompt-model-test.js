#!/usr/bin/env node

const mongoose = require('mongoose');
const Agenda = require('agenda');
require('dotenv').config();

// Validate required environment variables
const requiredVars = ['MONGODB_URI', 'MONGODB_PARAMS', 'REDIS_URL'];
const missingVars = requiredVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingVars.join(', '));
    process.exit(1);
}

// Check for at least one AI provider
const hasOpenAI = !!process.env.OPENAI_API_KEY;
const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
const hasGoogle = !!process.env.GOOGLE_CLOUD_PROJECT;

if (!hasOpenAI && !hasAnthropic && !hasGoogle) {
    console.error('❌ No AI provider credentials found. Set at least one of:');
    console.error('   - OPENAI_API_KEY');
    console.error('   - ANTHROPIC_API_KEY');
    console.error('   - GOOGLE_CLOUD_PROJECT (with GOOGLE_APPLICATION_CREDENTIALS)');
    process.exit(1);
}

console.log('🔑 Available AI providers:');
if (hasOpenAI) console.log('   ✓ OpenAI');
if (hasAnthropic) console.log('   ✓ Anthropic');
if (hasGoogle) console.log('   ✓ Google Vertex AI');

async function triggerPromptModelTest(workspaceId) {
    if (!workspaceId) {
        console.error('❌ Workspace ID is required');
        console.log('Usage: node trigger-prompt-model-test.js <workspaceId>');
        process.exit(1);
    }

    const mongoUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
    const agenda = new Agenda({ db: { address: mongoUri, collection: 'jobs' } });

    try {
        console.log(`🚀 Triggering prompt-model test for workspace: ${workspaceId}`);
        
        // Start agenda
        await agenda.start();
        
        // Schedule the job to run immediately
        const job = await agenda.schedule('now', 'promptModelTester', {
            workspaceId: workspaceId
        });

        console.log(`✅ Job scheduled successfully with ID: ${job.attrs._id}`);
        console.log(`📊 Job will test all prompts against all enabled models in workspace ${workspaceId}`);
        console.log('💡 You can monitor job progress in the batcher logs');
        
        // Give a moment for the job to be queued
        setTimeout(async () => {
            await agenda.stop();
            process.exit(0);
        }, 2000);

    } catch (error) {
        console.error('❌ Failed to trigger job:', error.message);
        await agenda.stop();
        process.exit(1);
    }
}

// Get workspace ID from command line arguments
const workspaceId = process.argv[2];

if (!workspaceId) {
    console.error('❌ Workspace ID is required');
    console.log('Usage: node trigger-prompt-model-test.js <workspaceId>');
    process.exit(1);
}

// Validate workspace ID format (assuming it's a MongoDB ObjectId)
if (!/^[0-9a-fA-F]{24}$/.test(workspaceId)) {
    console.error('❌ Invalid workspace ID format. Expected a 24-character hex string (MongoDB ObjectId)');
    process.exit(1);
}

triggerPromptModelTest(workspaceId); 
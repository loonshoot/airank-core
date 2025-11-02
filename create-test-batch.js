#!/usr/bin/env node

/**
 * Directly create a test batch by running the job logic
 * This simulates what the batcher service does
 */

require('dotenv').config();
const redis = require('redis');

// Import the job function
const promptModelTesterJob = require('./config/jobs/promptModelTester');

async function main() {
  const workspaceId = process.argv[2] || '690089a0df6b55271c136dee';

  console.log('🧪 Creating test batch by running promptModelTester job');
  console.log('Workspace ID:', workspaceId);
  console.log();

  // Create Redis client
  const redisClient = redis.createClient({
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379'
  });

  try {
    // Connect to Redis
    await redisClient.connect();
    console.log('✅ Connected to Redis\n');

    // Create a mock job object that the job function expects
    const mockJob = {
      attrs: {
        data: {
          workspaceId: workspaceId,
          jobType: 'recurring'
        },
        repeatInterval: '24h' // Mark as recurring job to use batch processing
      },
      redisClient: redisClient
    };

    console.log('🚀 Running promptModelTester job...\n');

    // Run the job with a callback (Agenda style)
    await new Promise((resolve, reject) => {
      promptModelTesterJob(mockJob, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

    console.log('\n✅ Job completed!');
    console.log('\nNow check if a batch was created:');
    console.log(`   node test-batch-flow.js ${workspaceId} check`);

  } catch (error) {
    console.error('\n❌ Error running job:', error.message);
    console.error(error.stack);
    await redisClient.quit();
    process.exit(1);
  }

  await redisClient.quit();
  process.exit(0);
}

main();

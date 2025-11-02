#!/usr/bin/env node

/**
 * Manually run the processBatchResults job
 * This simulates what the batcher service does when it picks up the Agenda job
 */

require('dotenv').config();
const redis = require('redis');

// Import the job function
const processBatchResultsJob = require('./config/jobs/processBatchResults');

async function main() {
  const workspaceId = process.argv[2] || '69006a2aced7e5f70bbaaac5';
  const batchId = process.argv[3];

  console.log('🧪 Running processBatchResults job');
  console.log('Workspace ID:', workspaceId);
  if (batchId) {
    console.log('Batch ID:', batchId);
  }
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
          documentId: batchId,
          collection: 'batches',
          operationType: 'update'
        }
      },
      redisClient: redisClient
    };

    console.log('🚀 Running processBatchResults job...\n');

    // Run the job with a callback (Agenda style)
    await new Promise((resolve, reject) => {
      processBatchResultsJob(mockJob, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

    console.log('\n✅ Job completed!');
    console.log('\nNow check if results were saved:');
    console.log(`   node check-batch-processing.js ${workspaceId}`);

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

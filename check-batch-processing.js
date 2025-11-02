#!/usr/bin/env node

/**
 * Check if a batch was processed by the listener/batcher
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  const workspaceId = process.argv[2] || '69006a2aced7e5f70bbaaac5';

  console.log('🔍 Checking batch processing status');
  console.log('Workspace ID:', workspaceId);
  console.log();

  const workspaceDbUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  const workspaceDb = mongoose.createConnection(workspaceDbUri);
  await workspaceDb.asPromise();

  // Check most recent batch
  const batch = await workspaceDb.collection('batches')
    .find({})
    .sort({ submittedAt: -1 })
    .limit(1)
    .toArray();

  if (batch.length === 0) {
    console.log('❌ No batches found');
    await workspaceDb.close();
    return;
  }

  const b = batch[0];
  console.log('📦 Most Recent Batch:');
  console.log(`   Batch ID: ${b.batchId}`);
  console.log(`   Status: ${b.status}`);
  console.log(`   Is Processed: ${b.isProcessed}`);
  console.log(`   Submitted: ${b.submittedAt}`);
  if (b.completedAt) {
    console.log(`   Completed: ${b.completedAt}`);
  }
  console.log(`   Request Count: ${b.requestCount}`);
  console.log(`   Results Count: ${b.results?.length || 0}`);
  console.log();

  if (b.isProcessed) {
    console.log('✅ Batch has been processed!');
    console.log();

    // Check for responses in previousmodelresults collection
    const responses = await workspaceDb.collection('previousmodelresults').countDocuments({});
    console.log(`📊 Total previousmodelresults in database: ${responses}`);

    if (responses > 0) {
      const recentResponse = await workspaceDb.collection('previousmodelresults')
        .find({})
        .sort({ generatedAt: -1 })
        .limit(1)
        .toArray();

      if (recentResponse.length > 0) {
        const r = recentResponse[0];
        console.log();
        console.log('📝 Most Recent Result:');
        console.log(`   Model: ${r.modelId}`);
        console.log(`   Generated: ${r.generatedAt}`);
        console.log(`   Response length: ${r.response?.length || 0} chars`);
        console.log(`   Response preview: ${r.response?.substring(0, 100)}...`);
        if (r.sentiment) {
          console.log(`   Sentiment Score: ${r.sentiment.score}`);
          console.log(`   Sentiment Magnitude: ${r.sentiment.magnitude}`);
        }
      }
    }
  } else {
    console.log('⚠️  Batch has NOT been processed yet');
    console.log();
    console.log('Possible reasons:');
    console.log('1. Listener service is not running');
    console.log('2. Listener hasn\'t detected the change yet (check listener logs)');
    console.log('3. Batcher service is not running (check batcher logs)');
    console.log('4. Processing job failed (check Agenda jobs collection)');
  }

  console.log();

  // Check Agenda jobs
  const airankDb = mongoose.createConnection(`${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`);
  await airankDb.asPromise();

  const recentJobs = await airankDb.collection('jobs')
    .find({ name: 'processBatchResults' })
    .sort({ lastRunAt: -1 })
    .limit(5)
    .toArray();

  if (recentJobs.length > 0) {
    console.log('📋 Recent processBatchResults jobs:');
    recentJobs.forEach((job, i) => {
      console.log(`   ${i + 1}. Last Run: ${job.lastRunAt || 'never'}`);
      console.log(`      Status: ${job.lastFinishedAt ? 'completed' : 'pending/running'}`);
      if (job.failReason) {
        console.log(`      Failed: ${job.failReason}`);
      }
    });
  } else {
    console.log('⚠️  No processBatchResults jobs found in Agenda');
    console.log('   This means the listener did not create a job when the batch was updated');
  }

  await workspaceDb.close();
  await airankDb.close();
}

main().catch(console.error);

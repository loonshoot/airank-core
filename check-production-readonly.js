const mongoose = require('mongoose');

/**
 * Read-only production status check
 * Run this locally against production MongoDB
 *
 * Usage:
 *   PROD_MONGO_URI="mongodb://..." node check-production-readonly.js
 */

const PROD_MONGO_URI = process.env.PROD_MONGO_URI || 'REPLACE_WITH_PRODUCTION_MONGO_URI';
const WORKSPACE_ID = '69006a2aced7e5f70bbaaac5';

async function checkProduction() {
  console.log('🔍 Checking Production Vertex AI Batch Processing Status');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Workspace: ${WORKSPACE_ID}`);
  console.log('');

  try {
    // Connect to workspace database
    // Remove any database name from the URI and add workspace database
    const baseUri = PROD_MONGO_URI.split('?')[0].replace(/\/[^\/]*$/, '');
    const params = PROD_MONGO_URI.split('?')[1] || '';
    const workspaceUri = `${baseUri}/workspace_${WORKSPACE_ID}?${params}`;

    await mongoose.connect(workspaceUri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 10000
    });
    const db = mongoose.connection.db;

    console.log('✓ Connected to production database');
    console.log('');

    // Check batch notifications
    console.log('📨 Batch Notifications:');
    console.log('-'.repeat(60));
    const notifications = await db.collection('batchnotifications')
      .find({})
      .sort({ receivedAt: -1 })
      .limit(10)
      .toArray();

    console.log(`Total notifications: ${notifications.length}`);
    console.log(`Processed: ${notifications.filter(n => n.processed).length}`);
    console.log(`Unprocessed: ${notifications.filter(n => !n.processed).length}`);
    console.log('');

    if (notifications.length > 0) {
      console.log('Recent notifications:');
      notifications.slice(0, 5).forEach((n, i) => {
        console.log(`  ${i + 1}. ${n.processed ? '✅ Processed' : '⏳ Pending'}`);
        console.log(`     File: ${n.fileName?.split('/').pop() || 'unknown'}`);
        console.log(`     Received: ${n.receivedAt}`);
        if (n.processedAt) console.log(`     Processed: ${n.processedAt}`);
        if (n.batchId) console.log(`     Batch: ${n.batchId.split('/').pop()}`);
        console.log('');
      });
    } else {
      console.log('  No notifications found');
      console.log('');
    }

    // Check batches
    console.log('📦 Vertex AI Batches:');
    console.log('-'.repeat(60));
    const batches = await db.collection('batches')
      .find({ provider: 'vertex' })
      .sort({ submittedAt: -1 })
      .limit(10)
      .toArray();

    console.log(`Total Vertex batches: ${batches.length}`);
    console.log('');

    if (batches.length > 0) {
      console.log('Recent batches:');
      batches.slice(0, 5).forEach((b, i) => {
        console.log(`  ${i + 1}. Status: ${b.status} | Processed: ${b.isProcessed ? 'Yes' : 'No'}`);
        console.log(`     Batch ID: ${b.batchId?.split('/').pop() || 'unknown'}`);
        console.log(`     Model: ${b.modelId}`);
        console.log(`     Submitted: ${b.submittedAt}`);
        if (b.completedAt) console.log(`     Completed: ${b.completedAt}`);
        console.log(`     Results: ${b.results?.length || 0}`);
        console.log('');
      });
    } else {
      console.log('  No Vertex batches found');
      console.log('');
    }

    // Check results
    console.log('📊 Processed Results:');
    console.log('-'.repeat(60));
    const results = await db.collection('previousmodelresults')
      .find({ provider: 'vertex' })
      .sort({ processedAt: -1 })
      .limit(10)
      .toArray();

    console.log(`Total Vertex results: ${results.length}`);
    console.log('');

    if (results.length > 0) {
      console.log('Recent results:');
      results.slice(0, 5).forEach((r, i) => {
        console.log(`  ${i + 1}. Model: ${r.modelName}`);
        console.log(`     Processed: ${r.processedAt}`);
        console.log(`     Batch ID: ${r.batchId?.split('/').pop() || 'unknown'}`);
        console.log(`     Response: ${r.response?.substring(0, 100)}...`);
        if (r.sentimentAnalysis) {
          console.log(`     Sentiment: ${r.sentimentAnalysis.overallSentiment}`);
        }
        console.log('');
      });
    } else {
      console.log('  No Vertex results found');
      console.log('');
    }

    await mongoose.disconnect();

    // Check airank database for jobs
    console.log('📋 Batcher Jobs:');
    console.log('-'.repeat(60));

    const airankBaseUri = PROD_MONGO_URI.split('?')[0].replace(/\/[^\/]*$/, '');
    const airankParams = PROD_MONGO_URI.split('?')[1] || '';
    const airankUri = `${airankBaseUri}/airank?${airankParams}`;
    await mongoose.connect(airankUri);
    const airankDb = mongoose.connection.db;

    const jobs = await airankDb.collection('jobs')
      .find({ name: 'processVertexBatchNotification' })
      .sort({ lastRunAt: -1 })
      .limit(10)
      .toArray();

    console.log(`Total processVertexBatchNotification jobs: ${jobs.length}`);
    console.log('');

    if (jobs.length > 0) {
      console.log('Recent jobs:');
      jobs.slice(0, 5).forEach((j, i) => {
        let status = '⏳ Pending';
        if (j.lastFinishedAt) status = '✅ Completed';
        else if (j.lockedAt) status = '🔄 Running';
        else if (j.failedAt) status = '❌ Failed';

        console.log(`  ${i + 1}. ${status}`);
        if (j.lastRunAt) console.log(`     Last run: ${j.lastRunAt}`);
        if (j.lastFinishedAt) console.log(`     Finished: ${j.lastFinishedAt}`);
        if (j.failedAt) console.log(`     Failed: ${j.failedAt}`);
        if (j.failReason) console.log(`     Reason: ${j.failReason}`);
        console.log('');
      });
    } else {
      console.log('  No jobs found');
      console.log('');
    }

    // Check listeners
    console.log('🎧 Dynamic Listeners:');
    console.log('-'.repeat(60));

    const listeners = await airankDb.collection('listeners')
      .find({ isActive: true })
      .toArray();

    console.log(`Active listeners: ${listeners.length}`);
    console.log('');

    if (listeners.length > 0) {
      listeners.forEach((l, i) => {
        console.log(`  ${i + 1}. ${l.collection} → ${l.jobName}`);
        console.log(`     Active: ${l.isActive}`);
        console.log(`     Operations: ${l.operationType?.join(', ')}`);
        if (l.lockInfo?.instanceId) {
          console.log(`     Locked by: ${l.lockInfo.instanceId}`);
          console.log(`     Last heartbeat: ${l.lockInfo.lastHeartbeat}`);
        }
        console.log('');
      });
    }

    await mongoose.disconnect();

    console.log('='.repeat(60));
    console.log('✅ Status check complete');
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkProduction();

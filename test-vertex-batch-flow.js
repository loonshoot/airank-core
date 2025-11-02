#!/usr/bin/env node

/**
 * Test Vertex AI batch flow - checking if polling exists
 * Vertex batches need to be polled for completion, then results downloaded from GCS
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { checkVertexBatchStatus } = require('./graphql/mutations/helpers/batch/vertex');

async function main() {
  const workspaceId = process.argv[2] || '69006a2aced7e5f70bbaaac5';

  console.log('🔍 Checking Vertex AI Batch Flow');
  console.log('Workspace ID:', workspaceId);
  console.log();

  const workspaceDbUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  const workspaceDb = mongoose.createConnection(workspaceDbUri);
  await workspaceDb.asPromise();

  // Find Vertex batches
  const vertexBatches = await workspaceDb.collection('batches')
    .find({ provider: 'vertex' })
    .sort({ submittedAt: -1 })
    .limit(5)
    .toArray();

  if (vertexBatches.length === 0) {
    console.log('❌ No Vertex AI batches found');
    console.log('\n💡 Vertex batches are created for:');
    console.log('   - Gemini models (gemini-2.5-flash, gemini-2.5-pro, etc.)');
    console.log('   - Claude models via Vertex AI');
    console.log('\nTo test, enable a Gemini or Claude model in your workspace');
    await workspaceDb.close();
    return;
  }

  console.log(`📦 Found ${vertexBatches.length} Vertex AI batch(es):\n`);

  for (const batch of vertexBatches) {
    console.log(`Batch: ${batch.batchId}`);
    console.log(`  Local Status: ${batch.status}`);
    console.log(`  Model: ${batch.modelId} (${batch.modelType || 'unknown'})`);
    console.log(`  Processed: ${batch.isProcessed}`);
    console.log(`  Submitted: ${batch.submittedAt}`);
    if (batch.completedAt) {
      console.log(`  Completed: ${batch.completedAt}`);
    }

    // Try to check real status from Vertex AI
    if (batch.status !== 'received' && batch.status !== 'processed') {
      try {
        console.log(`  📡 Checking Vertex AI status...`);
        const status = await checkVertexBatchStatus(batch.batchId);
        console.log(`  Vertex AI State: ${status.state}`);
        if (status.error) {
          console.log(`  Error: ${JSON.stringify(status.error)}`);
        }

        // Check if it's completed but not downloaded
        if (status.state === 'JOB_STATE_SUCCEEDED' && batch.status === 'submitted') {
          console.log(`  ⚠️  ISSUE FOUND: Batch is completed in Vertex AI but not downloaded!`);
          console.log(`     Status in Vertex: SUCCEEDED`);
          console.log(`     Status locally: ${batch.status}`);
          console.log(`     → Missing: Batch completion polling and result download`);
        }
      } catch (error) {
        console.log(`  ❌ Failed to check Vertex status: ${error.message}`);
      }
    }
    console.log();
  }

  console.log('\n📋 Analysis:');
  console.log('============\n');

  const submittedBatches = vertexBatches.filter(b => b.status === 'submitted');
  const receivedBatches = vertexBatches.filter(b => b.status === 'received');

  console.log(`Submitted (waiting): ${submittedBatches.length}`);
  console.log(`Received (ready to process): ${receivedBatches.length}`);
  console.log(`Processed: ${vertexBatches.filter(b => b.isProcessed).length}`);

  console.log('\n💡 Expected Flow for Vertex AI:');
  console.log('1. Submit batch → Upload to GCS → Create Vertex AI job');
  console.log('2. ⚠️  POLL Vertex AI job status (MISSING?)');
  console.log('3. ⚠️  Download results from GCS when complete (MISSING?)');
  console.log('4. Update batch status to "received"');
  console.log('5. Listener detects change → triggers processBatchResults');

  console.log('\n🔍 Next Steps:');
  if (submittedBatches.length > 0) {
    console.log('- Create a batch polling job that runs periodically');
    console.log('- Poll all "submitted" Vertex batches');
    console.log('- Download results when JOB_STATE_SUCCEEDED');
    console.log('- Update batch to "received" to trigger listener');
  } else {
    console.log('- No submitted Vertex batches to test with');
    console.log('- Enable a Gemini model and run promptModelTester to create one');
  }

  await workspaceDb.close();
}

main().catch(console.error);

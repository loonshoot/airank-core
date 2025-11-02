const mongoose = require('mongoose');
const { submitVertexBatch } = require('./graphql/mutations/helpers/batch/vertex');
require('dotenv').config();

async function testVertexBatchFlow() {
  const workspaceId = '69006a2aced7e5f70bbaaac5';

  console.log('🧪 Testing Complete Vertex AI Batch Flow');
  console.log('==========================================');
  console.log(`Workspace: ${workspaceId}`);
  console.log('');

  try {
    // Connect to workspace database
    const mongoUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
    const workspaceConn = mongoose.createConnection(mongoUri);
    await workspaceConn.asPromise();
    const workspaceDb = workspaceConn.db;

    console.log('✓ Connected to workspace database');

    // Create a test request for Gemini
    const testRequests = [
      {
        custom_id: `${workspaceId}-test-gemini-${Date.now()}`,
        model: 'gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant.'
          },
          {
            role: 'user',
            content: 'Write a short haiku about testing batch processing.'
          }
        ]
      }
    ];

    console.log(`📦 Submitting Vertex AI batch with ${testRequests.length} request(s)`);
    console.log(`   Model: gemini-2.5-flash`);
    console.log('');

    // Submit batch
    const batchResult = await submitVertexBatch(testRequests, workspaceDb, workspaceId);

    console.log('✅ Batch submitted successfully!');
    console.log('');
    console.log('Batch Details:');
    console.log(`   Batch ID: ${batchResult.batchId}`);
    console.log(`   Document ID: ${batchResult.documentId}`);
    console.log(`   Request Count: ${batchResult.requestCount}`);
    console.log('');

    // Get the batch document to show GCS paths
    const batch = await workspaceDb.collection('batches').findOne({
      _id: batchResult.documentId
    });

    console.log('GCS Paths:');
    console.log(`   Input:  ${batch.inputGcsPath}`);
    console.log(`   Output: ${batch.outputGcsPrefix}`);
    console.log('');

    console.log('📊 What Happens Next:');
    console.log('   1. Vertex AI processes the batch (this may take several minutes)');
    console.log('   2. Results written to GCS output path');
    console.log('   3. GCS triggers Pub/Sub notification');
    console.log('   4. Pub/Sub pushes to https://stream.getairank.com/webhooks/batch');
    console.log('   5. Stream service creates batchnotifications document');
    console.log('   6. Listener detects notification and triggers batcher job');
    console.log('   7. Batcher downloads results from GCS');
    console.log('   8. Batch status updated to "received"');
    console.log('   9. Listener triggers processBatchResults job');
    console.log('  10. Results saved with sentiment analysis');
    console.log('');

    console.log('🔍 Monitor Progress:');
    console.log('');
    console.log('Check batch status:');
    console.log(`   node get-batch-id.js ${workspaceId}`);
    console.log('');
    console.log('Check Vertex AI job status:');
    console.log(`   gcloud ai batch-prediction-jobs describe ${batchResult.batchId.split('/').pop()} --region=us-east5`);
    console.log('');
    console.log('Check for notifications:');
    console.log(`   mongo "${mongoUri}" --eval 'db.batchnotifications.find().pretty()'`);
    console.log('');
    console.log('Watch logs:');
    console.log('   Stream:   docker logs -f airank-core-stream');
    console.log('   Listener: docker logs -f airank-core-listener');
    console.log('   Batcher:  docker logs -f airank-core-batcher');
    console.log('');

    await workspaceConn.close();
    console.log('✅ Test batch submitted! Monitor the logs to see the complete flow.');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testVertexBatchFlow();

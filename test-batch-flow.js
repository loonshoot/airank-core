#!/usr/bin/env node

/**
 * Test script to force an OpenAI batch to "completed" status
 * This simulates what happens when OpenAI completes a batch, triggering the full processing flow
 */

require('dotenv').config();
const mongoose = require('mongoose');
const OpenAI = require('openai');

async function main() {
  console.log('🧪 Force Batch Completion Test\n');

  const workspaceId = process.argv[2];
  const mode = process.argv[3] || 'check'; // 'check' or 'force'

  if (!workspaceId) {
    console.error('Usage: node test-batch-flow.js <workspaceId> [check|force]');
    console.error('');
    console.error('Modes:');
    console.error('  check - Check batch status without modifying (default)');
    console.error('  force - Force batch to completed status with mock data');
    console.error('');
    console.error('Example:');
    console.error('  node test-batch-flow.js 690089a0df6b55271c136dee check');
    console.error('  node test-batch-flow.js 690089a0df6b55271c136dee force');
    process.exit(1);
  }

  try {
    // Connect to workspace database
    const workspaceDbUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
    const workspaceDb = mongoose.createConnection(workspaceDbUri);
    await workspaceDb.asPromise();
    console.log('✅ Connected to workspace database\n');

    // Find submitted batches
    const batches = await workspaceDb.collection('batches')
      .find({ provider: 'openai', status: { $in: ['submitted', 'validating', 'in_progress'] } })
      .sort({ submittedAt: -1 })
      .toArray();

    if (batches.length === 0) {
      console.log('❌ No active OpenAI batches found');
      console.log('   Status searched: submitted, validating, in_progress');
      console.log('\n💡 To create a batch, run the prompt-model-tester job');
      await workspaceDb.close();
      process.exit(0);
    }

    console.log(`📦 Found ${batches.length} active batch(es):\n`);

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`${i + 1}. Batch: ${batch.batchId}`);
      console.log(`   Local Status: ${batch.status}`);
      console.log(`   Model: ${batch.modelId}`);
      console.log(`   Requests: ${batch.requestCount}`);
      console.log(`   Submitted: ${batch.submittedAt}`);

      // Check real status from OpenAI
      try {
        const openAIBatch = await openai.batches.retrieve(batch.batchId);
        console.log(`   OpenAI Status: ${openAIBatch.status}`);
        console.log(`   Completed: ${openAIBatch.request_counts?.completed || 0}/${openAIBatch.request_counts?.total || 0}`);

        if (openAIBatch.output_file_id) {
          console.log(`   ✅ Output file ready: ${openAIBatch.output_file_id}`);
        }
        if (openAIBatch.error_file_id) {
          console.log(`   ⚠️  Error file: ${openAIBatch.error_file_id}`);
        }
      } catch (error) {
        console.log(`   ❌ Failed to retrieve from OpenAI: ${error.message}`);
      }
      console.log();
    }

    if (mode === 'check') {
      console.log('✅ Check complete (no changes made)');
      console.log('\n💡 To force completion with mock data, run:');
      console.log(`   node test-batch-flow.js ${workspaceId} force`);
      await workspaceDb.close();
      process.exit(0);
    }

    // FORCE MODE - Simulate completion
    console.log('⚠️  FORCE MODE - Will update batch to completed status\n');

    const batchToComplete = batches[0];
    console.log(`🎯 Forcing completion for: ${batchToComplete.batchId}\n`);

    // Generate mock results based on request metadata
    const requestMetadata = batchToComplete.metadata?.requests || [];

    if (requestMetadata.length === 0) {
      console.error('❌ No request metadata found - cannot generate mock results');
      await workspaceDb.close();
      process.exit(1);
    }

    console.log(`📝 Generating ${requestMetadata.length} mock responses...\n`);

    const mockResults = requestMetadata.map(req => {
      const timestamp = Math.floor(Date.now() / 1000);
      const randomId = () => Math.random().toString(36).substring(2, 15);

      return {
        id: `batch_req_${randomId()}`,
        custom_id: req.custom_id,
        response: {
          status_code: 200,
          request_id: `req_${randomId()}`,
          body: {
            id: `chatcmpl-${randomId()}`,
            object: 'chat.completion',
            created: timestamp,
            model: req.model,
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: `[MOCK RESPONSE for ${req.model}] This is a test response to validate the batch processing flow. Custom ID: ${req.custom_id}. In production, this would be a real AI-generated response about brand mentions.`
              },
              logprobs: null,
              finish_reason: 'stop'
            }],
            usage: {
              prompt_tokens: 25,
              completion_tokens: 45,
              total_tokens: 70
            },
            system_fingerprint: `fp_mock_${randomId()}`
          }
        },
        error: null
      };
    });

    // Update batch document to trigger listener
    const result = await workspaceDb.collection('batches').updateOne(
      { _id: batchToComplete._id },
      {
        $set: {
          status: 'received',
          outputFileId: `mock_output_${Date.now()}`,
          results: mockResults,
          completedAt: new Date(),
          isProcessed: false
        }
      }
    );

    if (result.modifiedCount === 1) {
      console.log('✅ Batch updated to "received" status with mock results');
      console.log('📡 Listener should detect this change and trigger processBatchResults job\n');
      console.log('🔍 Monitor these logs:');
      console.log('   - Listener: Should show "Change detected: batches (update)"');
      console.log('   - Batcher: Should show "Processing batch results"');
      console.log('   - Check batch.isProcessed should become true');
      console.log('   - Check responses collection for new entries\n');
    } else {
      console.log('❌ Failed to update batch');
    }

    await workspaceDb.close();
    console.log('✅ Complete!');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

main();

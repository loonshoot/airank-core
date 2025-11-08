const OpenAI = require('openai');
const mongoose = require('mongoose');

/**
 * Submit a batch job to OpenAI
 * @param {Array} requests - Array of {custom_id, model, messages}
 * @param {Object} workspaceDb - MongoDB workspace database connection
 * @param {String} workspaceId - Workspace ID
 * @returns {Object} - Batch metadata
 */
async function submitOpenAIBatch(requests, workspaceDb, workspaceId) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  console.log(`🚀 [OpenAI Batch] Starting submission for workspace ${workspaceId}`);
  console.log(`📊 [OpenAI Batch] Request count: ${requests.length}`);

  // Create JSONL content
  const jsonlContent = requests.map(req => JSON.stringify({
    custom_id: req.custom_id,
    method: "POST",
    url: "/v1/chat/completions",
    body: {
      model: req.model,
      messages: req.messages,
      max_tokens: 1000
    }
  })).join('\n');

  let file;
  try {
    // Upload file to OpenAI
    // Convert Buffer to File object for OpenAI SDK v4
    console.log(`📤 [OpenAI Batch] Uploading batch file (${jsonlContent.length} bytes)...`);
    const buffer = Buffer.from(jsonlContent, 'utf-8');
    file = await openai.files.create({
      file: new File([buffer], 'batch.jsonl', { type: 'application/jsonl' }),
      purpose: 'batch'
    });
    console.log(`✅ [OpenAI Batch] File uploaded successfully: ${file.id}`);
  } catch (error) {
    console.error(`❌ [OpenAI Batch] File upload failed for workspace ${workspaceId}`);
    console.error(`❌ [OpenAI Batch] Error:`, error.message);
    if (error.response) {
      console.error(`❌ [OpenAI Batch] Response:`, JSON.stringify(error.response.data, null, 2));
    }
    throw new Error(`OpenAI file upload failed: ${error.message}`);
  }

  let batch;
  try {
    // Create batch job
    console.log(`🔨 [OpenAI Batch] Creating batch job with file ${file.id}...`);
    batch = await openai.batches.create({
      input_file_id: file.id,
      endpoint: '/v1/chat/completions',
      completion_window: '24h',
      metadata: {
        workspace_id: workspaceId
      }
    });
    console.log(`✅ [OpenAI Batch] Batch created successfully: ${batch.id}`);
    console.log(`📋 [OpenAI Batch] Status: ${batch.status}`);
  } catch (error) {
    console.error(`❌ [OpenAI Batch] Batch creation failed for workspace ${workspaceId}`);
    console.error(`❌ [OpenAI Batch] File ID was: ${file.id}`);
    console.error(`❌ [OpenAI Batch] Error:`, error.message);
    if (error.response) {
      console.error(`❌ [OpenAI Batch] Response:`, JSON.stringify(error.response.data, null, 2));
    }
    throw new Error(`OpenAI batch creation failed: ${error.message}`);
  }

  // Validate batch ID format
  if (!batch.id || !batch.id.startsWith('batch_')) {
    console.error(`❌ [OpenAI Batch] Invalid batch ID format received: ${batch.id}`);
    throw new Error(`Invalid OpenAI batch ID format: ${batch.id}`);
  }

  // Store batch metadata in MongoDB
  const batchDoc = {
    _id: new mongoose.Types.ObjectId(),
    workspaceId: workspaceId,
    batchId: batch.id,
    provider: 'openai',
    modelId: requests[0]?.model, // Store first model as reference
    status: 'submitted',
    requestCount: requests.length,
    inputFileId: file.id,
    outputFileId: null,
    errorFileId: null,
    submittedAt: new Date(),
    completedAt: null,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    results: [],
    isProcessed: false,
    metadata: {
      requests: requests.map(r => ({
        custom_id: r.custom_id,
        model: r.model
      }))
    }
  };

  try {
    console.log(`💾 [OpenAI Batch] Storing batch document in MongoDB...`);
    await workspaceDb.collection('batches').insertOne(batchDoc);
    console.log(`✅ [OpenAI Batch] Batch document stored with _id: ${batchDoc._id}`);
  } catch (error) {
    console.error(`❌ [OpenAI Batch] Failed to store batch document in MongoDB`);
    console.error(`❌ [OpenAI Batch] Batch ID from OpenAI: ${batch.id}`);
    console.error(`❌ [OpenAI Batch] Error:`, error.message);
    throw new Error(`Failed to store batch in MongoDB: ${error.message}`);
  }

  console.log(`✅ [OpenAI Batch] Batch submission complete`);
  console.log(`📋 [OpenAI Batch] Batch ID: ${batch.id}`);
  console.log(`📋 [OpenAI Batch] Document ID: ${batchDoc._id}`);
  console.log(`📋 [OpenAI Batch] Request count: ${requests.length}`);

  return {
    batchId: batch.id,
    documentId: batchDoc._id,
    requestCount: requests.length
  };
}

/**
 * Check status of OpenAI batch job
 * @param {String} batchId - OpenAI batch ID
 * @returns {Object} - Batch status
 */
async function checkOpenAIBatchStatus(batchId) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  const batch = await openai.batches.retrieve(batchId);

  return {
    id: batch.id,
    status: batch.status,
    output_file_id: batch.output_file_id,
    error_file_id: batch.error_file_id,
    request_counts: batch.request_counts
  };
}

/**
 * Download and process OpenAI batch results
 * @param {String} outputFileId - OpenAI output file ID
 * @param {Object} workspaceDb - MongoDB workspace database connection
 * @param {String} batchId - Batch ID
 * @returns {Array} - Processed results
 */
async function downloadOpenAIBatchResults(outputFileId, workspaceDb, batchId) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  // Download the file content
  const fileResponse = await openai.files.content(outputFileId);
  const fileContent = await fileResponse.text();

  // Parse JSONL results
  const results = fileContent
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));

  // Update batch document with results
  await workspaceDb.collection('batches').updateOne(
    { batchId: batchId },
    {
      $set: {
        status: 'received',
        outputFileId: outputFileId,
        results: results,
        completedAt: new Date()
      }
    }
  );

  console.log(`✓ Downloaded ${results.length} results for batch ${batchId}`);

  return results;
}

module.exports = {
  submitOpenAIBatch,
  checkOpenAIBatchStatus,
  downloadOpenAIBatchResults
};

const OpenAI = require('openai');
const { ObjectId } = require('mongodb');

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

  // Upload file to OpenAI
  const file = await openai.files.create({
    file: Buffer.from(jsonlContent),
    purpose: 'batch'
  });

  // Create batch job
  const batch = await openai.batches.create({
    input_file_id: file.id,
    endpoint: '/v1/chat/completions',
    completion_window: '24h',
    metadata: {
      workspace_id: workspaceId
    }
  });

  // Store batch metadata in MongoDB
  const batchDoc = {
    _id: new ObjectId(),
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

  await workspaceDb.collection('batches').insertOne(batchDoc);

  console.log(`✓ OpenAI batch ${batch.id} submitted with ${requests.length} requests`);

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

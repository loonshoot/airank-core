const { Storage } = require('@google-cloud/storage');
const { JobServiceClient } = require('@google-cloud/aiplatform').v1;
const { ObjectId } = require('mongodb');

/**
 * Submit a batch job for Claude or Gemini via Vertex AI
 * @param {Array} requests - Array of {custom_id, model, messages}
 * @param {Object} workspaceDb - MongoDB workspace database connection
 * @param {String} workspaceId - Workspace ID
 * @returns {Object} - Batch metadata
 */
async function submitVertexBatch(requests, workspaceDb, workspaceId) {
  const projectId = process.env.GCP_PROJECT_ID;
  const location = process.env.GCP_REGION || 'us-central1';
  const bucketName = process.env.GCS_BATCH_BUCKET;

  console.log(`🚀 [Vertex AI Batch] Starting submission for workspace ${workspaceId}`);
  console.log(`📊 [Vertex AI Batch] Request count: ${requests.length}`);
  console.log(`🌍 [Vertex AI Batch] Project: ${projectId}, Region: ${location}`);

  const storage = new Storage({
    projectId: projectId
  });

  const client = new JobServiceClient({
    apiEndpoint: `${location}-aiplatform.googleapis.com`
  });

  // Detect model type (Claude vs Gemini)
  const firstModel = requests[0]?.model || '';
  const isClaudeModel = firstModel.includes('claude');
  const isGeminiModel = firstModel.includes('gemini');

  console.log(`🤖 [Vertex AI Batch] Model type: ${isClaudeModel ? 'Claude' : isGeminiModel ? 'Gemini' : 'Unknown'}`);
  console.log(`🤖 [Vertex AI Batch] First model: ${firstModel}`);

  // Create JSONL content for Vertex AI batch format
  const jsonlContent = requests.map(req => {
    // Convert OpenAI format messages to Vertex AI format
    const systemMessage = req.messages.find(m => m.role === 'system');
    const userMessages = req.messages.filter(m => m.role === 'user' || m.role === 'assistant');

    return JSON.stringify({
      request: {
        contents: userMessages.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        })),
        systemInstruction: systemMessage ? {
          parts: [{ text: systemMessage.content }]
        } : undefined,
        generationConfig: {
          maxOutputTokens: 1000,
          temperature: 0.7
        }
      },
      // Store custom_id as a simple string field for tracking
      custom_id: req.custom_id
    });
  }).join('\n');

  // Upload to GCS
  const timestamp = Date.now();
  const inputFileName = `batches/input/${workspaceId}/${timestamp}-input.jsonl`;
  const outputPrefix = `batches/output/${workspaceId}/${timestamp}/`;

  console.log(`📤 [Vertex AI Batch] Uploading to GCS: gs://${bucketName}/${inputFileName}`);

  const bucket = storage.bucket(bucketName);
  const file = bucket.file(inputFileName);

  try {
    await file.save(jsonlContent, {
      contentType: 'application/jsonl',
      metadata: {
        workspaceId: workspaceId
      }
    });
    console.log(`✅ [Vertex AI Batch] File uploaded successfully (${jsonlContent.length} bytes)`);
  } catch (error) {
    console.error(`❌ [Vertex AI Batch] GCS upload failed for workspace ${workspaceId}`);
    console.error(`❌ [Vertex AI Batch] Bucket: ${bucketName}, File: ${inputFileName}`);
    console.error(`❌ [Vertex AI Batch] Error:`, error.message);
    throw new Error(`GCS upload failed: ${error.message}`);
  }

  // Map model ID to Vertex AI model name
  const modelMap = {
    // Claude models
    'claude-3-5-haiku-20241022': 'claude-3-5-haiku@20241022',
    'claude-3-5-sonnet-20241022': 'claude-3-5-sonnet@20241022',
    'claude-haiku-4-5': 'claude-haiku-4-5@20250514',
    'claude-3-opus-20240229': 'claude-3-opus@20240229',
    // Gemini models
    'gemini-2.5-flash': 'gemini-2.5-flash',
    'gemini-2.5-pro': 'gemini-2.5-pro',
    'gemini-2.5-flash-lite': 'gemini-2.5-flash-lite',
    'gemini-2.0-flash': 'gemini-2.0-flash',
    'gemini-2.0-flash-exp': 'gemini-2.0-flash-exp',
    'gemini-1.5-pro': 'gemini-1.5-pro',
    'gemini-1.5-flash': 'gemini-1.5-flash'
  };

  const vertexModelId = modelMap[requests[0]?.model] || requests[0]?.model;

  // Determine the publisher based on model type
  const publisher = isClaudeModel ? 'anthropic' : 'google';

  // Create batch prediction job
  const batchPredictionJob = {
    displayName: `airank-batch-${workspaceId}-${timestamp}`,
    model: `projects/${projectId}/locations/${location}/publishers/${publisher}/models/${vertexModelId}`,
    inputConfig: {
      instancesFormat: 'jsonl',
      gcsSource: {
        uris: [`gs://${bucketName}/${inputFileName}`]
      }
    },
    outputConfig: {
      predictionsFormat: 'jsonl',
      gcsDestination: {
        outputUriPrefix: `gs://${bucketName}/${outputPrefix}`
      }
    }
  };

  console.log(`🔨 [Vertex AI Batch] Creating batch prediction job...`);
  console.log(`🤖 [Vertex AI Batch] Model: ${publisher}/${vertexModelId}`);

  let operation, batchJobName;
  try {
    [operation] = await client.createBatchPredictionJob({
      parent: `projects/${projectId}/locations/${location}`,
      batchPredictionJob
    });

    batchJobName = operation.name;
    console.log(`✅ [Vertex AI Batch] Batch job created successfully`);
    console.log(`📋 [Vertex AI Batch] Job name: ${batchJobName}`);
  } catch (error) {
    console.error(`❌ [Vertex AI Batch] Batch creation failed for workspace ${workspaceId}`);
    console.error(`❌ [Vertex AI Batch] Model: ${publisher}/${vertexModelId}`);
    console.error(`❌ [Vertex AI Batch] Input: gs://${bucketName}/${inputFileName}`);
    console.error(`❌ [Vertex AI Batch] Error:`, error.message);
    if (error.details) {
      console.error(`❌ [Vertex AI Batch] Details:`, error.details);
    }
    throw new Error(`Vertex AI batch creation failed: ${error.message}`);
  }

  // Validate batch job name format
  if (!batchJobName || !batchJobName.includes('/batchPredictionJobs/')) {
    console.error(`❌ [Vertex AI Batch] Invalid batch job name format: ${batchJobName}`);
    throw new Error(`Invalid Vertex AI batch job name format: ${batchJobName}`);
  }

  // Store batch metadata in MongoDB
  const batchDoc = {
    _id: new ObjectId(),
    workspaceId: workspaceId,
    batchId: batchJobName,
    provider: 'vertex', // Using Vertex AI for both Claude and Gemini
    modelId: requests[0]?.model,
    modelType: isClaudeModel ? 'claude' : 'gemini',
    status: 'submitted',
    requestCount: requests.length,
    inputGcsPath: `gs://${bucketName}/${inputFileName}`,
    outputGcsPrefix: `gs://${bucketName}/${outputPrefix}`,
    submittedAt: new Date(),
    completedAt: null,
    results: [],
    isProcessed: false,
    metadata: {
      requests: requests.map(r => ({
        custom_id: r.custom_id,
        model: r.model
      })),
      vertexModelId: vertexModelId,
      publisher: publisher
    }
  };

  try {
    console.log(`💾 [Vertex AI Batch] Storing batch document in MongoDB...`);
    await workspaceDb.collection('batches').insertOne(batchDoc);
    console.log(`✅ [Vertex AI Batch] Batch document stored with _id: ${batchDoc._id}`);
  } catch (error) {
    console.error(`❌ [Vertex AI Batch] Failed to store batch document in MongoDB`);
    console.error(`❌ [Vertex AI Batch] Batch job name from Vertex: ${batchJobName}`);
    console.error(`❌ [Vertex AI Batch] Error:`, error.message);
    throw new Error(`Failed to store batch in MongoDB: ${error.message}`);
  }

  console.log(`✅ [Vertex AI Batch] Batch submission complete`);
  console.log(`📋 [Vertex AI Batch] Batch job name: ${batchJobName}`);
  console.log(`📋 [Vertex AI Batch] Document ID: ${batchDoc._id}`);
  console.log(`📋 [Vertex AI Batch] Request count: ${requests.length}`);

  return {
    batchId: batchJobName,
    documentId: batchDoc._id,
    requestCount: requests.length
  };
}

/**
 * Check status of Vertex AI batch job
 * @param {String} batchJobName - Vertex AI batch job name
 * @returns {Object} - Batch status
 */
async function checkVertexBatchStatus(batchJobName) {
  const location = process.env.GCP_REGION || 'us-central1';

  const client = new JobServiceClient({
    apiEndpoint: `${location}-aiplatform.googleapis.com`
  });

  const [job] = await client.getBatchPredictionJob({
    name: batchJobName
  });

  return {
    name: job.name,
    state: job.state,
    error: job.error
  };
}

/**
 * Download and process Vertex AI batch results from GCS (Claude or Gemini)
 * @param {String} outputGcsPrefix - GCS output prefix
 * @param {Object} workspaceDb - MongoDB workspace database connection
 * @param {String} batchId - Batch ID
 * @returns {Array} - Processed results
 */
async function downloadVertexBatchResults(outputGcsPrefix, workspaceDb, batchId) {
  const bucketName = process.env.GCS_BATCH_BUCKET;
  const storage = new Storage({
    projectId: process.env.GCP_PROJECT_ID
  });

  // Remove gs:// prefix and bucket name
  const prefix = outputGcsPrefix.replace(`gs://${bucketName}/`, '');

  const [files] = await storage.bucket(bucketName).getFiles({
    prefix: prefix
  });

  let allResults = [];

  // Download and parse all result files
  for (const file of files) {
    if (file.name.endsWith('.jsonl')) {
      const [content] = await file.download();
      const results = content
        .toString()
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));

      allResults = allResults.concat(results);
    }
  }

  // Update batch document with results
  await workspaceDb.collection('batches').updateOne(
    { batchId: batchId },
    {
      $set: {
        status: 'received',
        results: allResults,
        completedAt: new Date()
      }
    }
  );

  // Delete input and output files from GCS to save costs
  const batchDoc = await workspaceDb.collection('batches').findOne({ batchId });
  if (batchDoc?.inputGcsPath) {
    const inputFile = batchDoc.inputGcsPath.replace(`gs://${bucketName}/`, '');
    try {
      await storage.bucket(bucketName).file(inputFile).delete();
      console.log(`✓ Deleted input file: ${inputFile}`);
    } catch (err) {
      console.error(`Failed to delete input file: ${err.message}`);
    }
  }

  for (const file of files) {
    try {
      await file.delete();
      console.log(`✓ Deleted output file: ${file.name}`);
    } catch (err) {
      console.error(`Failed to delete output file: ${err.message}`);
    }
  }

  console.log(`✓ Downloaded ${allResults.length} results for batch ${batchId}`);

  return allResults;
}

module.exports = {
  submitVertexBatch,
  checkVertexBatchStatus,
  downloadVertexBatchResults
};

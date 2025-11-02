#!/usr/bin/env node

/**
 * Direct test of Vertex AI batch submission
 */

require('dotenv').config();
const { Storage } = require('@google-cloud/storage');
const { PredictionServiceClient } = require('@google-cloud/aiplatform');

async function main() {
  console.log('🧪 Testing Vertex AI Batch Submission\n');

  console.log('Configuration:');
  console.log('- Project ID:', process.env.GCP_PROJECT_ID);
  console.log('- Region:', process.env.GCP_REGION);
  console.log('- Bucket:', process.env.GCS_BATCH_BUCKET);
  console.log('- Credentials:', process.env.GOOGLE_APPLICATION_CREDENTIALS || './gcp-batch-processor-key.json');
  console.log();

  const projectId = process.env.GCP_PROJECT_ID;
  const location = process.env.GCP_REGION;
  const bucketName = process.env.GCS_BATCH_BUCKET;

  try {
    // 1. Test Storage access
    console.log('1️⃣ Testing GCS access...');
    const storage = new Storage({ projectId });
    const bucket = storage.bucket(bucketName);
    const [exists] = await bucket.exists();

    if (!exists) {
      console.error(`❌ Bucket ${bucketName} does not exist`);
      return;
    }
    console.log(`✅ Bucket ${bucketName} exists\n`);

    // 2. Upload test input file
    console.log('2️⃣ Uploading test JSONL file...');
    const timestamp = Date.now();
    const inputFileName = `batches/input/test/${timestamp}-input.jsonl`;
    const outputPrefix = `batches/output/test/${timestamp}/`;

    const testData = JSON.stringify({
      request: {
        contents: [{
          role: 'user',
          parts: [{ text: 'Say "Hello from Vertex AI batch test!" in one sentence.' }]
        }],
        generationConfig: {
          maxOutputTokens: 100,
          temperature: 0.7
        }
      },
      metadata: {
        custom_id: 'test-request-1'
      }
    });

    const file = bucket.file(inputFileName);
    await file.save(testData, {
      contentType: 'application/jsonl',
      metadata: { test: 'true' }
    });
    console.log(`✅ Uploaded to gs://${bucketName}/${inputFileName}\n`);

    // 3. Create batch prediction job
    console.log('3️⃣ Creating Vertex AI Batch Prediction Job...');
    console.log(`   Endpoint: ${location}-aiplatform.googleapis.com`);

    const client = new PredictionServiceClient({
      apiEndpoint: `${location}-aiplatform.googleapis.com`
    });

    const modelName = 'gemini-2.5-flash';
    const parent = `projects/${projectId}/locations/${location}`;
    const modelPath = `${parent}/publishers/google/models/${modelName}`;

    console.log(`   Parent: ${parent}`);
    console.log(`   Model: ${modelPath}`);
    console.log();

    const batchPredictionJob = {
      displayName: `test-batch-${timestamp}`,
      model: modelPath,
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

    console.log('   Submitting job...');
    const [operation] = await client.createBatchPredictionJob({
      parent: parent,
      batchPredictionJob
    });

    console.log(`\n✅ Batch job created: ${operation.name}`);
    console.log(`📊 Job will write results to: gs://${bucketName}/${outputPrefix}`);
    console.log();
    console.log('🔍 To check status:');
    console.log(`   gcloud ai batch-prediction-jobs describe ${operation.name.split('/').pop()} --region=${location}`);
    console.log();
    console.log('⏳ This job will take some time to complete (could be minutes to hours)');
    console.log('   Once complete, results will appear in GCS and trigger the webhook');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.code) {
      console.error('Error code:', error.code);
    }
    if (error.details) {
      console.error('Details:', error.details);
    }
    console.error('\nFull error:', error);
    process.exit(1);
  }
}

main();

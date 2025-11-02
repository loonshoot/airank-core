const { JobServiceClient } = require('@google-cloud/aiplatform').v1;
require('dotenv').config();

async function checkBatchStatus() {
  const batchJobName = process.argv[2];

  if (!batchJobName) {
    console.error('Usage: node check-vertex-batch-status.js <batch-job-name>');
    console.error('Example: node check-vertex-batch-status.js projects/791169578153/locations/us-east5/batchPredictionJobs/3559508366227144704');
    process.exit(1);
  }

  const location = process.env.GCP_REGION || 'us-central1';
  const client = new JobServiceClient({
    apiEndpoint: `${location}-aiplatform.googleapis.com`
  });

  try {
    console.log(`📊 Checking Vertex AI batch status...`);
    console.log(`Job: ${batchJobName}`);
    console.log('');

    const [job] = await client.getBatchPredictionJob({
      name: batchJobName
    });

    const stateMap = {
      0: '⏸️  UNSPECIFIED',
      1: '⏳ QUEUED',
      2: '⏳ PENDING',
      3: '🔄 RUNNING',
      4: '✅ SUCCEEDED',
      5: '❌ FAILED',
      6: '🛑 CANCELLING',
      7: '🛑 CANCELLED',
      8: '⏸️  PAUSED',
      9: '⚠️  EXPIRED',
      10: '🔄 UPDATING',
      11: '⏳ PARTIALLY_SUCCEEDED'
    };

    const state = stateMap[job.state] || `UNKNOWN (${job.state})`;

    console.log(`Status: ${state}`);
    console.log(`Display Name: ${job.displayName}`);
    console.log(`Model: ${job.model}`);
    console.log('');

    console.log('Timestamps:');
    if (job.createTime) {
      console.log(`  Created: ${new Date(job.createTime.seconds * 1000).toLocaleString()}`);
    }
    if (job.startTime) {
      console.log(`  Started: ${new Date(job.startTime.seconds * 1000).toLocaleString()}`);
    }
    if (job.endTime) {
      console.log(`  Ended: ${new Date(job.endTime.seconds * 1000).toLocaleString()}`);
    }
    if (job.updateTime) {
      console.log(`  Updated: ${new Date(job.updateTime.seconds * 1000).toLocaleString()}`);
    }
    console.log('');

    if (job.inputConfig) {
      console.log('Input:');
      console.log(`  ${job.inputConfig.gcsSource.uris[0]}`);
      console.log('');
    }

    if (job.outputConfig) {
      console.log('Output:');
      console.log(`  ${job.outputConfig.gcsDestination.outputUriPrefix}`);
      console.log('');
    }

    if (job.outputInfo) {
      console.log('Output Info:');
      console.log(`  GCS Output Directory: ${job.outputInfo.gcsOutputDirectory}`);
      console.log('');
    }

    if (job.error) {
      console.log('❌ Error:');
      console.log(`  Code: ${job.error.code}`);
      console.log(`  Message: ${job.error.message}`);
      console.log('');
    }

    // Check if completed
    if (job.state === 4) { // SUCCEEDED
      console.log('✅ Batch completed successfully!');
      console.log('');
      console.log('Next steps:');
      console.log('1. GCS will trigger Pub/Sub notification');
      console.log('2. Webhook will be called at https://stream.getairank.com/webhooks/batch');
      console.log('3. Check stream logs: docker logs -f airank-core-stream');
    } else if (job.state === 5) { // FAILED
      console.log('❌ Batch failed!');
    } else {
      console.log('⏳ Batch is still processing...');
      console.log('Run this command again to check status.');
    }

  } catch (error) {
    console.error('❌ Error checking batch status:', error.message);
    process.exit(1);
  }
}

checkBatchStatus();

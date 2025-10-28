const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const port = process.env.STREAM_PORT || 4003;

// Connect to MongoDB
const mongoUri = `${process.env.MONGODB_URI}`;

// Middleware to parse JSON (for most endpoints)
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'airank-stream' });
});

// Batch processing webhook - handles GCS Pub/Sub notifications
app.post('/webhooks/batch', async (req, res) => {
  try {
    const pubsubMessage = req.body;

    console.log(`📨 Batch webhook received`);

    // Verify Pub/Sub message format
    if (!pubsubMessage || !pubsubMessage.message) {
      console.error('Invalid Pub/Sub message format');
      return res.status(400).send('Invalid message format');
    }

    // Decode the Pub/Sub message data
    const messageData = JSON.parse(Buffer.from(pubsubMessage.message.data, 'base64').toString());

    console.log('📦 GCS notification:', messageData);

    // Extract file information from GCS notification
    const { name: fileName, bucket } = messageData;

    if (!fileName || !bucket) {
      console.error('Missing file name or bucket in notification');
      return res.status(400).send('Invalid notification data');
    }

    // Only process output files (not input files)
    if (!fileName.includes('/output/')) {
      console.log('⚠️  Skipping non-output file:', fileName);
      return res.status(200).send('OK');
    }

    // Extract workspaceId from GCS path: batches/output/{workspaceId}/{timestamp}/file.jsonl
    const pathParts = fileName.split('/');
    const outputIndex = pathParts.indexOf('output');
    if (outputIndex === -1 || outputIndex + 1 >= pathParts.length) {
      console.error('Could not extract workspaceId from path:', fileName);
      return res.status(400).send('Invalid file path structure');
    }
    const workspaceId = pathParts[outputIndex + 1];

    console.log(`📍 Extracted workspace ID: ${workspaceId}`);

    // Import batch helpers
    const { downloadVertexBatchResults } = require('../graphql/mutations/helpers/batch/vertex');

    // Connect to workspace database
    const workspaceUri = `${mongoUri}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
    const workspaceConn = mongoose.createConnection(workspaceUri);
    await workspaceConn.asPromise();
    const workspaceDb = workspaceConn.db;

    // Find the batch document by GCS output prefix
    const gcsPrefix = `gs://${bucket}/${fileName.split('/').slice(0, -1).join('/')}/`;

    let batch = await workspaceDb.collection('batches').findOne({
      outputGcsPrefix: gcsPrefix,
      status: { $in: ['submitted', 'processing'] }
    });

    if (!batch) {
      // Try to find by checking if the prefix matches
      const batches = await workspaceDb.collection('batches').find({
        status: { $in: ['submitted', 'processing'] }
      }).toArray();

      for (const b of batches) {
        if (b.outputGcsPrefix && gcsPrefix.startsWith(b.outputGcsPrefix)) {
          batch = b;
          break;
        }
      }

      if (!batch) {
        console.log(`⚠️  No matching batch found for ${gcsPrefix}`);
        await workspaceConn.close();
        return res.status(200).send('OK');
      }
    }

    console.log(`✓ Found batch: ${batch.batchId} (${batch.provider})`);

    // Download and process results for Vertex AI batches
    if (batch.provider === 'vertex') {
      await downloadVertexBatchResults(batch.outputGcsPrefix, workspaceDb, batch.batchId);
      console.log(`✅ Vertex batch results downloaded and stored for ${batch.batchId}`);
    } else {
      console.log(`⚠️  Batch provider ${batch.provider} not handled by stream service`);
    }

    await workspaceConn.close();
    res.status(200).send('OK');

  } catch (error) {
    console.error('💥 Batch webhook error:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.listen(port, () => {
  console.log(`🌊 AIRank Stream Service listening on port ${port}`);
});

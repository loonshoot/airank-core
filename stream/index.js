const express = require('express');
const mongoose = require('mongoose');
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
// This endpoint is lightweight and only creates notification documents
// The listener service will watch for these and trigger batcher jobs
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

    // Connect to workspace database
    const workspaceUri = `${mongoUri}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
    const workspaceConn = mongoose.createConnection(workspaceUri);
    await workspaceConn.asPromise();
    const workspaceDb = workspaceConn.db;

    // Create notification document for the listener to pick up
    // This keeps the stream service lightweight and fast
    const gcsUri = `gs://${bucket}/${fileName}`;
    const notification = {
      gcsUri,
      bucket,
      fileName,
      workspaceId,
      receivedAt: new Date(),
      processed: false
    };

    await workspaceDb.collection('batchnotifications').insertOne(notification);
    console.log(`✅ Created batch notification document for ${workspaceId}`);

    await workspaceConn.close();

    // Return 200 immediately - processing happens asynchronously
    res.status(200).send('OK');

  } catch (error) {
    console.error('💥 Batch webhook error:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.listen(port, () => {
  console.log(`🌊 AIRank Stream Service listening on port ${port}`);
});

const express = require('express');
const mongoose = require("mongoose");
const sanitizeHtml = require('sanitize-html'); 
require('dotenv').config();
const { handleHubspotWebhook } = require('./src/helpers/hubspot');
const { handleSalesforceWebhook } = require('./src/helpers/salesforce');
const { handleStreamPost } = require('./src/helpers/streams');
const { sourceSchema, Source } = require('./src/models/source');
const { streamHistorySchema } = require('./src/models/streamHistory');

const app = express();
const port = 3003;

// Middleware to parse JSON request body
app.use(express.json());

// Connect to MongoDB
const mongoUri = `${process.env.MONGODB_URI}`;
const adminUri = `${mongoUri}/outrun?${process.env.MONGODB_PARAMS}`;
const adminConnection = mongoose.createConnection(adminUri, { serverSelectionTimeoutMS: 60000 });

// Stream endpoint
app.post('/api/v1/workspace/:workspaceID/stream/:sourceID', async (req, res) => {
  await handleStreamPost(req, res, mongoUri, req.params.sourceID, req.params.workspaceID);
});

// Hubspot webhook endpoint
app.post('/api/v1/webhook/hubspot', handleHubspotWebhook);

// Salesforce webhook endpoint
app.post('/api/v1/webhook/salesforce', handleSalesforceWebhook);

app.listen(port, () => {
  console.log(`Streaming Service listening on port ${port}`);
});
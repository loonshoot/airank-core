const mongoose = require('mongoose');
const { sourceSchema } = require('../models/source');
const { streamHistorySchema } = require('../models/streamHistory');
const { validateAndAdd } = require('./common');
async function processHubspotWebhook(source, payload, ipAddress, workspaceId, sourceId ) {
  if (!source || !source.workspaceId) {
    console.error('Invalid source object:', source);
    throw new Error('Invalid source object: workspaceId is required');
  }

  const mongoUri = `${process.env.MONGODB_URI}`;
  const dataLakeUri = `${mongoUri}/workspace_${source.workspaceId}?${process.env.MONGODB_PARAMS}`;
  const dataLakeConnection = mongoose.createConnection(dataLakeUri, { serverSelectionTimeoutMS: 60000 });

  try {
    const datalakeCollection = "source_" + source._id + "_stream";
    const datalakeModel = dataLakeConnection.model("Datalake", new mongoose.Schema({}, { strict: false }), datalakeCollection);

    const streamHistoryModel = dataLakeConnection.model("streamHistory", new mongoose.Schema({
      sourceID: String,
      startTime: Date,
      endTime: Date,
      runtimeMilliseconds: Number,
      totalIngressBytes: Number,
      ipAddress: String
    }), "streamHistory");

    const startTime = new Date();
    const streamHistory = await streamHistoryModel.create({
      sourceID: source._id,
      startTime: startTime.toISOString(),
      ipAddress
    });

    const cleanedData = {
      ...payload,
      streamId: streamHistory._id,
      processedDate: new Date().toISOString()
    };

    await datalakeModel.create(cleanedData);

    const endTime = new Date();
    await streamHistory.updateOne({
      endTime: endTime.toISOString(),
      runtimeMilliseconds: endTime - startTime,
      totalIngressBytes: Buffer.byteLength(JSON.stringify(cleanedData))
    });

  } finally {
    await dataLakeConnection.close();
  }
}

async function handleHubspotWebhook(req, res) {
  console.log("Running Webhook");
  let datalakeConnection;
  let adminConnection;
  
  try {
    const portalId = req.body.portalId;
    
    console.log('Request body:', req.body);
    
    const mongoUri = `${process.env.MONGODB_URI}`;
    const adminUri = `${mongoUri}/airank?${process.env.MONGODB_PARAMS}`;
    adminConnection = mongoose.createConnection(adminUri, { serverSelectionTimeoutMS: 60000 });
    
    const WebhookModel = adminConnection.model('Webhook', new mongoose.Schema({
      service: String,
      sourceId: String,
      workspaceId: String,
      data: {
        portalId: String
      }
    }), 'streamRoute');

    const webhook = await WebhookModel.findOne({
      service: 'hubspot',
      'data.portalId': portalId.toString ? portalId.toString() : portalId
    });
    
    console.log('Found webhook:', webhook);
    
    if (!webhook) {
      console.error('No webhook configuration found for Hubspot portal:', portalId);
      return res.status(404).json({ error: 'No webhook configuration found for this Hubspot portal' });
    }

    const sourceId = webhook.data.sourceId;
    const workspaceId = webhook.data.workspaceId;

    if (!workspaceId || !sourceId) {
      console.error('Invalid webhook configuration - missing workspaceId or sourceId');
      return res.status(400).json({ error: 'Invalid webhook configuration' });
    }

    const dataLakeUri = `${mongoUri}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
    datalakeConnection = mongoose.createConnection(dataLakeUri, { serverSelectionTimeoutMS: 60000 });
    
    const Source = datalakeConnection.model('Source', sourceSchema, 'sources');
    const source = await Source.findOne({ _id: sourceId });

    console.log('Found source:', source);

    if (!source) {
      console.error('Source not found:', sourceId);
      return res.status(404).json({ error: 'Source not found' });
    }

    source.workspaceId = workspaceId;

    await processHubspotWebhook(source, req.body, req.headers['x-client-ip'], workspaceId, sourceId);
    res.status(200).json({ message: 'Webhook processed successfully' });

  } catch (error) {
    console.error('Error processing Hubspot webhook:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    if (datalakeConnection) await datalakeConnection.close();
    if (adminConnection) await adminConnection.close();
  }
}

module.exports = { handleHubspotWebhook }; 
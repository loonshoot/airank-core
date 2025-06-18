const mongoose = require("mongoose");
const { sourceSchema } = require('../models/source');
const { streamHistorySchema } = require('../models/streamHistory');
const { validateAndAdd } = require('./common');
const { Source } = require('../models/source');

async function handleStreamPost(req, res, mongoUri, sourceID, workspaceID) {
    console.log("Running Stream");
  const dataLakeUri = `${mongoUri}/workspace_${workspaceID}?${process.env.MONGODB_PARAMS}`;
  const dataLakeConnection = mongoose.createConnection(dataLakeUri, { 
    serverSelectionTimeoutMS: 60000,
    maxPoolSize: 10,
    minPoolSize: 5,
    maxIdleTimeMS: 30000,
    connectTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    writeConcern: { w: 1 },
    retryWrites: true,
    retryReads: true
  });

  const startTime = new Date();
  const ipAddress = req.headers['x-client-ip'];

  try {
    // Create Source model with the dataLakeConnection
    const SourceModel = dataLakeConnection.model('Source', sourceSchema, 'sources');
    
    // Use the connection-specific model to find the source
    const source = await SourceModel.findOne({ _id: sourceID });
    
    if (!source) {
      return res.status(404).json({ error: 'Source document not found' });
    }
    const inputs = source.inputs;
    const datalakeCollection = "source_"+sourceID+"_stream";
    const datalakeModel = dataLakeConnection.model("Datalake", new mongoose.Schema({}, { strict: false }), datalakeCollection);

    let totalIngressBytes = 0;

    // Create streamHistory model using the schema
    const streamHistoryModel = dataLakeConnection.model("streamHistory", streamHistorySchema, "streamHistory");

    const streamHistory = await streamHistoryModel.create({
      sourceID,
      startTime: startTime.toISOString(),
      ipAddress
    });

    if (Array.isArray(req.body)) {
      const processedDate = new Date().toISOString();
      const BATCH_SIZE = 100;
      const newDocuments = [];

      for (const item of req.body) {
        let cleanedData = {};

        if (inputs.length === 0) {
          cleanedData = { ...item };
        } else {
          for (const field of inputs) {
            if (!validateAndAdd(field, item, cleanedData, res)) {
              res.status(400).json({ error: 'Validation failed for an item in the array' });
              return;
            }
          }
        }

        // Add the streamHistory ID and processed date
        cleanedData.streamId = streamHistory._id;
        cleanedData.processedDate = processedDate;
        newDocuments.push(cleanedData);

        totalIngressBytes += Buffer.byteLength(JSON.stringify(cleanedData));
      }

      // Process in batches
      for (let i = 0; i < newDocuments.length; i += BATCH_SIZE) {
        const batch = newDocuments.slice(i, i + BATCH_SIZE);
        await datalakeModel.insertMany(batch, { 
          ordered: false,
          writeConcern: { w: 1 },
          maxTimeMS: 30000
        });
      }

      res.status(201).json({ message: 'Documents created successfully' });
    } else {
      let cleanedData = {};

      if (inputs.length === 0) {
        cleanedData = { ...req.body };
      } else {
        for (const field of inputs) {
          if (!validateAndAdd(field, req.body, cleanedData, res)) {
            return;
          }
        }
      }

      // Add the streamHistory ID, processed date and IP
      cleanedData.streamId = streamHistory._id;
      cleanedData.processedDate = new Date().toISOString();
      cleanedData.ipAddress = ipAddress;

      const newEntry = await datalakeModel.create(cleanedData);
      res.status(201).json({ message: 'Document created successfully' });

      totalIngressBytes += Buffer.byteLength(JSON.stringify(cleanedData));
    }

    const endTime = new Date();
    const runtimeMilliseconds = endTime - startTime;

    // Update the existing streamHistory document with final data
    await streamHistory.updateOne({
      endTime: endTime.toISOString(),
      runtimeMilliseconds,
      totalIngressBytes
    });
  } catch (error) {
    console.error('Error in stream processing:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    await dataLakeConnection.close();
  }
}

module.exports = {
  handleStreamPost
}; 
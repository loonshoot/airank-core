require('dotenv').config();
const mongoose = require('mongoose');
const { Agenda } = require('@hokify/agenda');
const { Listener } = require('./src/models');
const os = require('os');
const crypto = require('crypto');
const config = require('@airank/config');

// Connect to MongoDB
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_PARAMS = process.env.MONGODB_PARAMS;

// Generate a unique instance ID
const INSTANCE_ID = crypto.randomBytes(16).toString('hex');
console.log(`Instance ID: ${INSTANCE_ID}`);

// Initialize Agenda
const agenda = new Agenda({
  db: {
    address: `${MONGODB_URI}/airank?${MONGODB_PARAMS}`,
    collection: 'jobs'
  },
  maxConcurrency: 20,
  defaultConcurrency: 5
});

// Map to store active change streams
const activeChangeStreams = new Map();

// Function to acquire lock for a listener
async function acquireListenerLock(listenerId) {
  try {
    // Try to update the listener with our lock
    const updatedListener = await Listener.findOneAndUpdate(
      {
        _id: listenerId,
        $or: [
          { 'lockInfo.instanceId': { $exists: false } },
          { 'lockInfo.instanceId': INSTANCE_ID },
          { 'lockInfo.lastHeartbeat': { $lt: new Date(Date.now() - 30000) } }
        ]
      },
      {
        'lockInfo.instanceId': INSTANCE_ID,
        'lockInfo.lastHeartbeat': new Date()
      },
      { new: true }
    );

    return updatedListener !== null;
  } catch (error) {
    console.error(`Error acquiring lock for listener ${listenerId}:`, error);
    return false;
  }
}

// Function to update heartbeat for locked listeners
async function updateLocksHeartbeat() {
  try {
    await Listener.updateMany(
      { 'lockInfo.instanceId': INSTANCE_ID },
      { 'lockInfo.lastHeartbeat': new Date() }
    );
  } catch (error) {
    console.error('Error updating locks heartbeat:', error);
  }
}

// Start heartbeat interval
const heartbeatInterval = setInterval(updateLocksHeartbeat, 10000);

// Function to release lock
async function releaseListenerLock(listenerId) {
  try {
    await Listener.updateOne(
      { 
        _id: listenerId,
        'lockInfo.instanceId': INSTANCE_ID
      },
      {
        $unset: { lockInfo: "" }
      }
    );
  } catch (error) {
    console.error(`Error releasing lock for listener ${listenerId}:`, error);
  }
}

// Function to ensure database and collection exist
async function ensureDatabaseAndCollection(workspaceId, collectionName) {
  try {
    const db = mongoose.connection.useDb(`workspace_${workspaceId}`, {
      useCache: true
    });
    
    // Get list of collections
    const collections = await db.db.listCollections({ name: collectionName }).toArray();
    
    if (collections.length === 0) {
      // Collection doesn't exist, create it
      console.log(`Creating collection ${collectionName} in workspace_${workspaceId}`);
      const collection = await db.createCollection(collectionName);
      return collection;
    } else {
      // Collection exists, return it
      return db.collection(collectionName);
    }
  } catch (error) {
    console.error(`Error ensuring database/collection exists:`, error);
    throw error;
  }
}

// Function to close change stream
async function closeChangeStream(listenerId) {
  const changeStream = activeChangeStreams.get(listenerId);
  if (changeStream) {
    try {
      await changeStream.close();
      activeChangeStreams.delete(listenerId);
      await releaseListenerLock(listenerId);
      console.log(`Closed change stream for listener ${listenerId}`);
    } catch (error) {
      console.error(`Error closing change stream for ${listenerId}:`, error);
    }
  }
}

// Function to lock and process document
async function lockAndProcessDocument(collection, change, listener) {
  const docId = change.documentKey._id;
  const listenerId = listener._id.toString();
  const docObjectType = change.fullDocument?.metadata?.objectType;
  const listenerObjectType = listener.metadata?.objectType;
  const listenerJobName = listener.jobName;
  const mappedSourceTypes = listener.metadata?.mappedSourceTypes || [];

  // Log every attempt for this listener
  // console.log(`[Listener] lockAndProcessDocument called for Listener: ${listenerJobName} (${listenerId}), Doc ID: ${docId}, Doc Type: ${docObjectType}`);
  
  // Skip changes inside the metadata object
  if (change.updateDescription && change.updateDescription.updatedFields) {
    const updatedFields = Object.keys(change.updateDescription.updatedFields);
    if (updatedFields.every(field => field.startsWith('metadata'))) {
      // console.log(`Skipping job creation for metadata change in document ${docId}`);
      return;
    }
  }

  // Enhanced type checking:
  // 1. Direct match: document type equals listener type
  // 2. Mapped type: document type is in the mapped source types array
  // 3. Dynamic listener: listener is configured to handle any object type
  const isTypeMatch = 
    docObjectType === listenerObjectType || 
    mappedSourceTypes.includes(docObjectType) ||
    listener.metadata?.handleAnyObjectType === true;

  // Skip if there is no type match
  if (listenerObjectType && !isTypeMatch) {
    // console.log(`[Listener] Skipping job creation: Listener (${listenerJobName} for ${listenerObjectType}) does not match document objectType (${docObjectType}) for doc ID ${docId}`);
    // console.log(`[Listener] Accepted types: ${[listenerObjectType, ...mappedSourceTypes].filter(Boolean).join(', ')}`);
    return;
  }

  try {
    // First check if document exists
    const existingDoc = await collection.findOne({
      _id: docId
    });

    if (!existingDoc) {
      console.log(`Document ${docId} not found`);
      return;
    }

    // Check if this specific listener has already processed this document
    if (existingDoc?.metadata?.listeners?.[listenerId]?.status === 'complete') {
      console.log(`Document ${docId} is already processed by listener ${listenerId}`);
      return;
    }

    // Update the document with listener-specific metadata - only initialize if null or doesn't exist
    await collection.updateOne(
      { 
        _id: docId, 
        $or: [
          { "metadata.listeners": { $exists: false } },
          { "metadata.listeners": null }
        ]
      },
      {
        $set: {
          "metadata.listeners": {} // Initialize listeners as an empty object only if it doesn't exist or is null
        }
      }
    );
    
    // Now set the listener-specific fields
    await collection.updateOne(
      { _id: docId },
      {
        $set: {
          [`metadata.listeners.${listenerId}.lastRun`]: new Date(),
          [`metadata.listeners.${listenerId}.status`]: null,
          [`metadata.listeners.${listenerId}.listenerId`]: listenerId
        }
      }
    );

    // Load source config if available
    let sourceConfig = {};
    if (listener.metadata.sourceType) {
      const sourceConfigs = await config.loadSourceConfigs();
      sourceConfig = sourceConfigs[listener.metadata.sourceType] || {};
    }

    // Create agenda job with metadata contents from the changed document
    const jobData = {
      // Start with document metadata if it exists
      ...(change.fullDocument?.metadata || {}),
      // Override with listener metadata to ensure it takes priority
      ...listener.metadata,
      // Add source config
      sourceConfig,
      // Add the change object
      change,
      // Ensure critical fields from listener are included
      sourceId: listener.metadata.sourceId,
      sourceType: listener.metadata.sourceType,
      workspaceId: listener.metadata.workspaceId,
      // Also set workspaceSlug (needed by destination jobs)
      workspaceSlug: listener.metadata.workspaceId,
      objectType: change.fullDocument?.metadata?.objectType || listener.metadata.objectType,
      // ALWAYS use the MongoDB ObjectId for objectId, never an external ID
      objectId: change.documentKey._id,
      // If available, also pass the external record ID separately for reference
      externalRecordId: change.fullDocument?.record?.id,
      // Explicitly include the collection name that triggered the change event
      // This ensures the job handler has the correct collection to reference
      collectionName: listener.collection,
      // Include the specific listener ID that triggered this job
      listenerId: listenerId
    };

    // console.log(`[Listener] Creating job ${listener.jobName} for change in ${listener.collection}, doc ID: ${change.documentKey._id}, objectType: ${jobData.objectType}, jobObjectId: ${jobData.objectId}`);
    const job = agenda.create(listener.jobName, jobData);
    
    // Add try/catch around job.save()
    let savedJobResult;
    try {
        savedJobResult = await job.save();
        // console.log(`[Listener] Job ${listener.jobName} saved successfully, DB ID: ${savedJobResult.attrs._id}`);
    } catch (saveError) {
        console.error(`[Listener] FAILED to save job ${listener.jobName} for doc ID ${change.documentKey._id}:`, saveError);
        // Attempt to mark the document as failed since job creation failed
        try {
            await collection.updateOne(
                { 
                    _id: docId, 
                    $or: [
                        { "metadata.listeners": { $exists: false } },
                        { "metadata.listeners": null }
                    ]
                },
                {
                    $set: {
                        "metadata.listeners": {} // Initialize listeners as an empty object only if it doesn't exist or is null
                    }
                }
            );
            
            // Now set the listener-specific fields
            await collection.updateOne(
                { _id: docId },
                {
                    $set: {
                        [`metadata.listeners.${listenerId}.status`]: null,
                        [`metadata.listeners.${listenerId}.error`]: `Job save failed: ${saveError.message}`,
                        [`metadata.listeners.${listenerId}.lastError`]: new Date()
                    }
                }
            );
        } catch (updateError) {
            console.error('Error updating document status after job save failure:', updateError);
        }
        return; // Exit processing for this document if job save fails
    }

    // Update document with completed status - only initialize if null or doesn't exist
    await collection.updateOne(
      { 
        _id: docId, 
        $or: [
          { "metadata.listeners": { $exists: false } },
          { "metadata.listeners": null }
        ]
      },
      {
        $set: {
          "metadata.listeners": {} // Initialize listeners as an empty object only if it doesn't exist or is null
        }
      }
    );
    
    // Now set the listener-specific fields
    await collection.updateOne(
      { _id: docId },
      {
        $set: {
          [`metadata.listeners.${listenerId}.status`]: 'complete',
          [`metadata.listeners.${listenerId}.jobId`]: savedJobResult.attrs._id.toString()
        }
      }
    );

    // console.log(`[Listener] Marked doc ${docId} as complete for listener ${listenerId}, associated Job DB ID: ${savedJobResult.attrs._id}`);
  } catch (error) {
    console.error('[Listener] Error processing document:', error);
    
    // Mark document as failed using listener-specific metadata
    try {
      await collection.updateOne(
        { 
          _id: docId, 
          $or: [
            { "metadata.listeners": { $exists: false } },
            { "metadata.listeners": null }
          ]
        },
        {
          $set: {
            "metadata.listeners": {} // Initialize listeners as an empty object only if it doesn't exist or is null
          }
        }
      );
      
      // Now set the listener-specific fields
      await collection.updateOne(
        { _id: docId },
        {
          $set: {
            [`metadata.listeners.${listenerId}.status`]: null,
            [`metadata.listeners.${listenerId}.error`]: error.message,
            [`metadata.listeners.${listenerId}.lastError`]: new Date()
          }
        }
      );
    } catch (updateError) {
      console.error('Error updating document status:', updateError);
    }
  }
}

// Function to check for incomplete documents
async function pollForIncompleteDocuments() {
  try {
    // Get all active listeners we own
    const ourListeners = await Listener.find({
      isActive: true,
      'lockInfo.instanceId': INSTANCE_ID
    });

    let totalIncompleteCount = 0;
    let processedListeners = 0;

    for (const listener of ourListeners) {
      const listenerId = listener._id.toString();
      const collection = await ensureDatabaseAndCollection(
        listener.metadata.workspaceId,
        listener.collection
      );

      // Find documents that need processing for this specific listener
      const incompleteDocs = await collection.find({
        $or: [
          // Document doesn't have any listeners metadata for this listener
          { [`metadata.listeners.${listenerId}`]: { $exists: false } },
          // Document has listeners metadata but not complete status for this listener
          { [`metadata.listeners.${listenerId}.status`]: { $ne: 'complete' } }
        ]
      }).toArray();

      totalIncompleteCount += incompleteDocs.length;
      processedListeners++;
      
      for (const doc of incompleteDocs) {
        await lockAndProcessDocument(collection, { documentKey: { _id: doc._id }, fullDocument: doc }, listener);
      }
    }

    if (totalIncompleteCount > 0) {
      console.log(`[Listener] Found ${totalIncompleteCount} docs waiting for processing across ${processedListeners} listeners`);
    }
  } catch (error) {
    console.error('Error polling for incomplete documents:', error);
  }
}

// Start polling for incomplete documents (every 30 seconds)
const incompleteDocsInterval = setInterval(pollForIncompleteDocuments, 30000);

// Function to start watching a collection
async function watchCollection(listener) {
  const listenerId = listener._id.toString();
  
  // Try to acquire lock
  const lockAcquired = await acquireListenerLock(listenerId);
  if (!lockAcquired) {
    // console.log(`Lock not acquired for listener ${listenerId}, skipping`);
    return { success: false, reason: 'lock_failed' };
  }

  try {
    // Close existing change stream if it exists
    await closeChangeStream(listenerId);

    const collection = await ensureDatabaseAndCollection(
      listener.metadata.workspaceId,
      listener.collection
    );
    
    // Ensure operationType is an array
    const operationTypes = Array.isArray(listener.operationType) 
      ? listener.operationType 
      : [listener.operationType].filter(Boolean);

    // Handle array of operation types
    const pipeline = [
      { 
        $match: { 
          operationType: { $in: operationTypes },
          ...listener.filter 
        } 
      }
    ];

    const changeStream = collection.watch(pipeline);

    changeStream.on('change', async (change) => {
      if (!listener.isActive) {
        return;
      }

      await lockAndProcessDocument(collection, change, listener);
    });

    changeStream.on('error', async (error) => {
      console.error(`Error in change stream for ${listener.collection}:`, error);
      // Remove from active streams on error
      activeChangeStreams.delete(listenerId);
      await releaseListenerLock(listenerId);
      
      // Try to restart the change stream after a delay
      setTimeout(async () => {
        try {
          await watchCollection(listener);
        } catch (error) {
          console.error(`Failed to restart change stream for ${listener.collection}:`, error);
        }
      }, 5000);
    });

    // Store the change stream
    activeChangeStreams.set(listenerId, changeStream);
    // console.log(`Started watching ${listener.collection} for operations [${operationTypes.join(', ')}] for listener ${listenerId}`);

    return changeStream;
  } catch (error) {
    console.error(`Error setting up watch for ${listener.collection}:`, error);
    await releaseListenerLock(listenerId);
    return null;
  }
}

// Function to handle listener changes
async function handleListenerChange(change) {
  try {
    const listenerId = change.documentKey._id.toString();

    if (change.operationType === 'insert') {
      if (change.fullDocument.isActive) {
        await watchCollection(change.fullDocument);
      }
    } else if (change.operationType === 'update') {
      // Only handle if we own the lock
      const lock = await Listener.findOne({ listenerId });
      if (lock && lock.instanceId === INSTANCE_ID) {
        await closeChangeStream(listenerId);
        const listener = await Listener.findById(listenerId);
        if (listener && listener.isActive) {
          await watchCollection(listener);
        }
      }
    } else if (change.operationType === 'delete') {
      console.log(`Listener ${listenerId} was deleted, closing change stream`);
      await closeChangeStream(listenerId);
    }
  } catch (error) {
    console.error('Error handling listener change:', error);
  }
}

// Function to check for available listeners
async function pollForAvailableListeners() {
  try {
    // Find active listeners that either have no lock or stale locks
    const availableListeners = await Listener.find({
      isActive: true,
      $or: [
        { 'lockInfo.instanceId': { $exists: false } },
        { 'lockInfo.lastHeartbeat': { $lt: new Date(Date.now() - 30000) } }
      ],
      // Exclude listeners we already own
      'lockInfo.instanceId': { $ne: INSTANCE_ID }
    });

    let lockFailuresCount = 0;

    for (const listener of availableListeners) {
      // Try to acquire lock and start watching
      const result = await watchCollection(listener);
      if (result && result.reason === 'lock_failed') {
        lockFailuresCount++;
      }
    }

    if (lockFailuresCount > 0) {
      console.log(`[Listener] Lock not acquired for ${lockFailuresCount} listeners, waiting 15 seconds before retry`);
    }
  } catch (error) {
    console.error('Error polling for available listeners:', error);
  }
}

// Start polling interval (check every 15 seconds)
const pollingInterval = setInterval(pollForAvailableListeners, 15000);

// Main function to start the service
async function startService() {
  try {
    // Connect to MongoDB with improved options
    await mongoose.connect(`${MONGODB_URI}/airank?${MONGODB_PARAMS}`, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 30000,
      waitQueueTimeoutMS: 30000,
      maxPoolSize: 50,
      minPoolSize: 10,
      retryWrites: true,
      retryReads: true
    });
    
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
      // Attempt to reconnect
      setTimeout(() => {
        mongoose.connect(`${MONGODB_URI}/airank?${MONGODB_PARAMS}`).catch(console.error);
      }, 5000);
    });

    mongoose.connection.on('disconnected', () => {
      console.log('MongoDB disconnected. Attempting to reconnect...');
      setTimeout(() => {
        mongoose.connect(`${MONGODB_URI}/airank?${MONGODB_PARAMS}`).catch(console.error);
      }, 5000);
    });

    console.log('Connected to MongoDB');

    // Start Agenda
    await agenda.start();
    console.log('Agenda started');

    // Get all active listeners
    const listeners = await Listener.find({ isActive: true });
    console.log(`Found ${listeners.length} active listeners`);

    // Start watching each collection
    await Promise.all(
      listeners.map(listener => watchCollection(listener))
    );

    // Watch for listener changes
    const listenerChangeStream = Listener.watch([], {
      fullDocument: 'updateLookup'
    });
    
    listenerChangeStream.on('change', handleListenerChange);
    
    // Handle process termination
    process.on('SIGTERM', async () => {
      console.log('Shutting down...');
      
      // Clear intervals
      clearInterval(heartbeatInterval);
      clearInterval(pollingInterval);
      clearInterval(incompleteDocsInterval);
      
      // Close all change streams and release locks
      for (const [listenerId] of activeChangeStreams) {
        await closeChangeStream(listenerId);
      }
      
      await agenda.stop();
      await mongoose.disconnect();
      process.exit(0);
    });

  } catch (error) {
    console.error('Error starting service:', error);
    process.exit(1);
  }
}

startService(); 
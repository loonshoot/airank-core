const { MongoClient } = require('mongodb');
const mongoose = require('mongoose');
const Agenda = require('agenda');
const config = require('./config');
const { Listener } = require('./listener-model');

// Connection pool settings to prevent connection explosion
// In sharded clusters, each change stream opens connections to ALL shards
// With 4 shards and default maxPoolSize=100, this can quickly become 400+ connections
const CONNECTION_POOL_OPTIONS = {
  maxPoolSize: 10,        // Limit connections per pool (default is 100)
  minPoolSize: 2,         // Minimum connections to keep open
  maxIdleTimeMS: 30000,   // Close idle connections after 30 seconds
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
};

class ListenerManager {
  constructor() {
    this.client = null;
    this.agenda = null;
    this.changeStreams = new Map();
    this.instanceId = config.listener.instanceId;
    this.heartbeatInterval = null;
    this.pollingInterval = null;
    this.listenerWatchStream = null;
  }

  async initialize() {
    console.log('🔌 Initializing Dynamic Listener Manager...');
    console.log(`📋 Instance ID: ${this.instanceId}`);
    console.log(`📊 Connection pool settings: maxPoolSize=${CONNECTION_POOL_OPTIONS.maxPoolSize}, minPoolSize=${CONNECTION_POOL_OPTIONS.minPoolSize}`);

    // Connect to MongoDB with connection pool limits
    const mongoUri = `${config.mongodb.uri}?${config.mongodb.params}`;
    this.client = new MongoClient(mongoUri, CONNECTION_POOL_OPTIONS);
    await this.client.connect();
    console.log('✓ Connected to MongoDB');

    // Connect Mongoose for listener model - use same pool limits
    // Reuse the existing MongoClient connection instead of creating a separate one
    const airankUri = `${config.mongodb.uri}/${config.mongodb.agendaDatabase}?${config.mongodb.params}`;
    await mongoose.connect(airankUri, CONNECTION_POOL_OPTIONS);
    console.log('✓ Mongoose connected');

    // Initialize Agenda for job scheduling
    this.agenda = new Agenda({
      db: { address: airankUri, collection: config.mongodb.agendaCollection }
    });

    await this.agenda.start();
    console.log('✓ Agenda initialized');

    // Ensure listeners collection has required indexes
    await this.ensureIndexes();

    // Bootstrap default listeners if they don't exist
    await this.bootstrapDefaultListeners();

    // Start heartbeat for distributed locks
    this.startHeartbeat();

    console.log('✓ Initialization complete');
  }

  async ensureIndexes() {
    await Listener.collection.createIndex({ collection: 1, jobName: 1 });
    await Listener.collection.createIndex({ isActive: 1 });
    await Listener.collection.createIndex({ 'lockInfo.instanceId': 1 });
    await Listener.collection.createIndex({ 'lockInfo.lastHeartbeat': 1 });
    console.log('✓ Listener indexes ensured');
  }

  async bootstrapDefaultListeners() {
    console.log('🌱 Bootstrapping default listeners...');

    const defaultListeners = [
      {
        collection: 'batches',
        filter: {
          status: 'received',
          isProcessed: false
        },
        operationType: ['insert', 'update'],
        jobName: 'processBatchResults',
        isActive: true,
        metadata: {
          description: 'Process batch results when they are received'
        }
      },
      {
        collection: 'batchnotifications',
        filter: {
          processed: false,
          provider: 'vertex'
        },
        operationType: ['insert', 'update'],
        jobName: 'processVertexBatchNotification',
        isActive: true,
        metadata: {
          description: 'Process Vertex AI batch completion notifications from GCS'
        }
      },
      {
        collection: 'batchnotifications',
        filter: {
          processed: false,
          provider: 'openai'
        },
        operationType: ['insert', 'update'],
        jobName: 'processOpenAIBatchNotification',
        isActive: true,
        metadata: {
          description: 'Process OpenAI batch completion notifications'
        }
      }
    ];

    for (const listenerConfig of defaultListeners) {
      try {
        // Check if listener already exists
        const existing = await Listener.findOne({
          collection: listenerConfig.collection,
          jobName: listenerConfig.jobName
        });

        if (!existing) {
          // Create new listener
          const listener = new Listener({
            ...listenerConfig,
            createdAt: new Date(),
            updatedAt: new Date()
          });
          await listener.save();
          console.log(`  ✓ Created default listener: ${listenerConfig.collection} → ${listenerConfig.jobName}`);
        } else {
          console.log(`  ✓ Listener exists: ${listenerConfig.collection} → ${listenerConfig.jobName}`);
        }
      } catch (error) {
        console.error(`  ❌ Failed to bootstrap listener ${listenerConfig.jobName}:`, error);
      }
    }

    const count = await Listener.countDocuments({ isActive: true });
    console.log(`✓ Bootstrap complete: ${count} active listeners in database`);
  }

  async startListeners() {
    console.log('🎧 Starting dynamic listeners...');

    // Get all active listeners from database
    const listeners = await Listener.find({ isActive: true });
    console.log(`📊 Found ${listeners.length} active listener configurations`);

    // Get list of all workspace databases
    const adminDb = this.client.db().admin();
    const { databases } = await adminDb.listDatabases();
    const workspaceDbs = databases.filter(db => db.name.startsWith('workspace_'));
    console.log(`📊 Found ${workspaceDbs.length} workspace databases`);

    // Start listeners for each workspace x listener combination
    for (const dbInfo of workspaceDbs) {
      const workspaceId = dbInfo.name.replace('workspace_', '');
      for (const listener of listeners) {
        await this.startWorkspaceListener(workspaceId, listener);
      }
    }

    console.log(`✓ All listeners started (${this.changeStreams.size} active streams)`);

    // Watch for changes to the listeners collection
    await this.watchListenerCollection();

    // Start polling for available listeners (failover)
    this.startPolling();
  }

  async watchListenerCollection() {
    console.log('👀 Watching listeners collection for configuration changes...');

    try {
      this.listenerWatchStream = Listener.watch([], {
        fullDocument: 'updateLookup'
      });

      this.listenerWatchStream.on('change', async (change) => {
        await this.handleListenerChange(change);
      });

      this.listenerWatchStream.on('error', (error) => {
        console.error('❌ Listener watch stream error:', error);
        // Attempt to restart the watch
        setTimeout(() => this.watchListenerCollection(), 5000);
      });

      console.log('✓ Listener collection watch established');
    } catch (error) {
      console.error('❌ Failed to watch listeners collection:', error);
    }
  }

  async handleListenerChange(change) {
    try {
      const listenerId = change.documentKey._id.toString();
      console.log(`📨 Listener change detected: ${change.operationType} (${listenerId})`);

      if (change.operationType === 'insert') {
        // New listener created - start watching for all workspaces
        if (change.fullDocument && change.fullDocument.isActive) {
          const listener = change.fullDocument;
          console.log(`  → Starting new listener: ${listener.collection} → ${listener.jobName}`);

          const adminDb = this.client.db().admin();
          const { databases } = await adminDb.listDatabases();
          const workspaceDbs = databases.filter(db => db.name.startsWith('workspace_'));

          for (const dbInfo of workspaceDbs) {
            const workspaceId = dbInfo.name.replace('workspace_', '');
            await this.startWorkspaceListener(workspaceId, listener);
          }
        }
      } else if (change.operationType === 'update') {
        // Listener updated - close and restart affected streams
        const listener = await Listener.findById(listenerId);
        if (listener) {
          console.log(`  → Updating listener: ${listener.collection} → ${listener.jobName}`);

          // Close all streams for this listener
          const streamsToClose = [];
          for (const [key, stream] of this.changeStreams.entries()) {
            if (key.includes(`-${listener.collection}-${listener.jobName}`)) {
              streamsToClose.push(key);
            }
          }

          for (const key of streamsToClose) {
            await this.closeChangeStream(key);
          }

          // Restart if active
          if (listener.isActive) {
            const adminDb = this.client.db().admin();
            const { databases } = await adminDb.listDatabases();
            const workspaceDbs = databases.filter(db => db.name.startsWith('workspace_'));

            for (const dbInfo of workspaceDbs) {
              const workspaceId = dbInfo.name.replace('workspace_', '');
              await this.startWorkspaceListener(workspaceId, listener);
            }
          }
        }
      } else if (change.operationType === 'delete') {
        // Listener deleted - close all related streams
        console.log(`  → Deleting listener streams for ${listenerId}`);

        const streamsToClose = [];
        for (const [key, stream] of this.changeStreams.entries()) {
          // Close any streams that might be related (we don't have the listener doc anymore)
          if (key.includes(listenerId)) {
            streamsToClose.push(key);
          }
        }

        for (const key of streamsToClose) {
          await this.closeChangeStream(key);
        }
      }
    } catch (error) {
      console.error('❌ Error handling listener change:', error);
    }
  }

  async startWorkspaceListener(workspaceId, listener) {
    const dbName = `workspace_${workspaceId}`;
    const db = this.client.db(dbName);
    const collection = db.collection(listener.collection);
    const streamKey = `${workspaceId}-${listener.collection}-${listener.jobName}`;

    // Check if already listening
    if (this.changeStreams.has(streamKey)) {
      return;
    }

    // Create change stream pipeline
    const pipeline = [];

    // Filter by operation type
    if (listener.operationType && listener.operationType.length > 0) {
      pipeline.push({
        $match: {
          operationType: { $in: listener.operationType }
        }
      });
    }

    // Filter by document fields
    if (listener.filter && Object.keys(listener.filter).length > 0) {
      const filterMatch = {};
      for (const [key, value] of Object.entries(listener.filter)) {
        filterMatch[`fullDocument.${key}`] = value;
      }
      pipeline.push({ $match: filterMatch });
    }

    console.log(`🎧 Starting listener: ${streamKey} with filter:`, JSON.stringify(listener.filter || {}));

    try {
      // Create change stream
      const changeStream = collection.watch(pipeline, {
        fullDocument: 'updateLookup'
      });

      // Handle change events
      changeStream.on('change', async (change) => {
        try {
          await this.handleWorkspaceChange(workspaceId, listener, change);
        } catch (error) {
          console.error(`❌ Error handling change in ${streamKey}:`, error);
        }
      });

      // Handle errors
      changeStream.on('error', (error) => {
        console.error(`❌ Change stream error in ${streamKey}:`, error);
        this.changeStreams.delete(streamKey);
      });

      // Handle close
      changeStream.on('close', () => {
        console.log(`🔌 Change stream closed: ${streamKey}`);
        this.changeStreams.delete(streamKey);
      });

      this.changeStreams.set(streamKey, changeStream);
    } catch (error) {
      console.error(`❌ Failed to start listener ${streamKey}:`, error);
    }
  }

  async handleWorkspaceChange(workspaceId, listener, change) {
    const { operationType, fullDocument, documentKey } = change;

    console.log(`📨 Change detected: ${listener.collection} (${operationType}) in workspace ${workspaceId}`);

    // Schedule job via Agenda
    const jobData = {
      workspaceId,
      documentId: documentKey._id.toString(),
      collection: listener.collection,
      operationType,
      document: fullDocument,
      metadata: listener.metadata
    };

    try {
      const job = await this.agenda.now(listener.jobName, jobData);
      console.log(`✓ Scheduled job: ${listener.jobName} (${job.attrs._id}) for workspace ${workspaceId}`);
    } catch (error) {
      console.error(`❌ Failed to schedule job ${listener.jobName}:`, error);
    }
  }

  async closeChangeStream(streamKey) {
    const stream = this.changeStreams.get(streamKey);
    if (stream) {
      console.log(`🔌 Closing stream: ${streamKey}`);
      await stream.close();
      this.changeStreams.delete(streamKey);
    }
  }

  startHeartbeat() {
    console.log('💓 Starting heartbeat...');

    this.heartbeatInterval = setInterval(async () => {
      const stats = {
        instanceId: this.instanceId,
        activeStreams: this.changeStreams.size,
        timestamp: new Date(),
        uptime: process.uptime()
      };

      console.log(`💓 Heartbeat: ${stats.activeStreams} active streams, uptime: ${Math.floor(stats.uptime)}s`);

      // Update heartbeat for all locks held by this instance
      try {
        await Listener.updateMany(
          { 'lockInfo.instanceId': this.instanceId },
          { 'lockInfo.lastHeartbeat': new Date() }
        );
      } catch (error) {
        console.error('❌ Error updating heartbeat:', error);
      }
    }, config.listener.heartbeatInterval);
  }

  startPolling() {
    console.log('🔄 Starting polling for available listeners...');

    this.pollingInterval = setInterval(async () => {
      try {
        // Find active listeners
        const listeners = await Listener.find({ isActive: true });

        // Get workspace list
        const adminDb = this.client.db().admin();
        const { databases } = await adminDb.listDatabases();
        const workspaceDbs = databases.filter(db => db.name.startsWith('workspace_'));

        // Check for missing streams
        for (const listener of listeners) {
          for (const dbInfo of workspaceDbs) {
            const workspaceId = dbInfo.name.replace('workspace_', '');
            const streamKey = `${workspaceId}-${listener.collection}-${listener.jobName}`;

            if (!this.changeStreams.has(streamKey)) {
              console.log(`🔄 Polling found missing stream: ${streamKey}`);
              await this.startWorkspaceListener(workspaceId, listener);
            }
          }
        }
      } catch (error) {
        console.error('❌ Error in polling:', error);
      }
    }, 60000); // Poll every 60 seconds (reduced from 15s to lower database load)
  }

  async shutdown() {
    console.log('🛑 Shutting down Dynamic Listener Manager...');

    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Stop polling
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }

    // Close listener watch stream
    if (this.listenerWatchStream) {
      await this.listenerWatchStream.close();
    }

    // Close all workspace change streams
    for (const [key, stream] of this.changeStreams.entries()) {
      console.log(`🔌 Closing stream: ${key}`);
      await stream.close();
    }
    this.changeStreams.clear();

    // Stop Agenda
    if (this.agenda) {
      await this.agenda.stop();
      console.log('✓ Agenda stopped');
    }

    // Close Mongoose
    await mongoose.disconnect();
    console.log('✓ Mongoose disconnected');

    // Close MongoDB connection
    if (this.client) {
      await this.client.close();
      console.log('✓ MongoDB connection closed');
    }

    console.log('✓ Shutdown complete');
  }
}

module.exports = ListenerManager;

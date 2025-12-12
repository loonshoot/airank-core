const { MongoClient } = require('mongodb');
const Agenda = require('agenda');
const config = require('./config');

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
  }

  async initialize() {
    console.log('🔌 Initializing Listener Manager...');
    console.log(`📋 Instance ID: ${this.instanceId}`);
    console.log(`📊 Connection pool settings: maxPoolSize=${CONNECTION_POOL_OPTIONS.maxPoolSize}, minPoolSize=${CONNECTION_POOL_OPTIONS.minPoolSize}`);

    // Connect to MongoDB with connection pool limits
    const mongoUri = `${config.mongodb.uri}?${config.mongodb.params}`;
    this.client = new MongoClient(mongoUri, CONNECTION_POOL_OPTIONS);
    await this.client.connect();
    console.log('✓ Connected to MongoDB');

    // Initialize Agenda for job scheduling
    const agendaUri = `${config.mongodb.uri}/${config.mongodb.agendaDatabase}?${config.mongodb.params}`;
    this.agenda = new Agenda({
      db: { address: agendaUri, collection: config.mongodb.agendaCollection }
    });

    await this.agenda.start();
    console.log('✓ Agenda initialized');

    // Start heartbeat
    this.startHeartbeat();
  }

  async startListeners() {
    console.log('🎧 Starting listeners for all workspace databases...');

    // Get list of all workspace databases
    const adminDb = this.client.db().admin();
    const { databases } = await adminDb.listDatabases();

    const workspaceDbs = databases.filter(db => db.name.startsWith('workspace_'));
    console.log(`📊 Found ${workspaceDbs.length} workspace databases`);

    for (const dbInfo of workspaceDbs) {
      const workspaceId = dbInfo.name.replace('workspace_', '');
      await this.startWorkspaceListener(workspaceId);
    }

    console.log(`✓ All listeners started (${this.changeStreams.size} active streams)`);
  }

  async startWorkspaceListener(workspaceId) {
    const dbName = `workspace_${workspaceId}`;
    const db = this.client.db(dbName);

    for (const rule of config.rules) {
      const collection = db.collection(rule.collection);
      const streamKey = `${workspaceId}-${rule.collection}`;

      // Check if already listening
      if (this.changeStreams.has(streamKey)) {
        console.log(`⚠️ Already listening to ${streamKey}`);
        continue;
      }

      // Create change stream pipeline
      const pipeline = [];

      // Filter by operation type
      if (rule.operationType && rule.operationType.length > 0) {
        pipeline.push({
          $match: {
            operationType: { $in: rule.operationType }
          }
        });
      }

      // Filter by document fields
      if (rule.filter) {
        const filterMatch = {};
        for (const [key, value] of Object.entries(rule.filter)) {
          filterMatch[`fullDocument.${key}`] = value;
        }
        pipeline.push({ $match: filterMatch });
      }

      console.log(`🎧 Starting listener: ${streamKey} (job: ${rule.jobName})`);

      // Create change stream
      const changeStream = collection.watch(pipeline, {
        fullDocument: 'updateLookup'
      });

      // Handle change events
      changeStream.on('change', async (change) => {
        try {
          await this.handleChange(workspaceId, rule, change);
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
    }
  }

  async handleChange(workspaceId, rule, change) {
    const { operationType, fullDocument, documentKey } = change;

    console.log(`📨 Change detected: ${rule.collection} (${operationType}) in workspace ${workspaceId}`);

    // Schedule job via Agenda
    const jobData = {
      workspaceId,
      documentId: documentKey._id.toString(),
      collection: rule.collection,
      operationType,
      document: fullDocument,
      metadata: rule.metadata
    };

    try {
      const job = await this.agenda.now(rule.jobName, jobData);
      console.log(`✓ Scheduled job: ${rule.jobName} (${job.attrs._id}) for workspace ${workspaceId}`);
    } catch (error) {
      console.error(`❌ Failed to schedule job ${rule.jobName}:`, error);
    }
  }

  startHeartbeat() {
    console.log('💓 Starting heartbeat...');

    this.heartbeatInterval = setInterval(() => {
      const stats = {
        instanceId: this.instanceId,
        activeStreams: this.changeStreams.size,
        timestamp: new Date(),
        uptime: process.uptime()
      };

      console.log(`💓 Heartbeat: ${stats.activeStreams} active streams, uptime: ${Math.floor(stats.uptime)}s`);
    }, config.listener.heartbeatInterval);
  }

  async shutdown() {
    console.log('🛑 Shutting down Listener Manager...');

    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Close all change streams
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

    // Close MongoDB connection
    if (this.client) {
      await this.client.close();
      console.log('✓ MongoDB connection closed');
    }

    console.log('✓ Shutdown complete');
  }
}

module.exports = ListenerManager;

const mongoose = require('mongoose');
const axios = require('axios');
const { TriggerListener } = require('../common/schemas/workflow');

class EventDrivenWorkflowListener {
  constructor() {
    this.graphqlEndpoint = process.env.GRAPHQL_ENDPOINT || 'http://localhost:3002/graphql';
    this.listeners = new Map();
    this.isRunning = false;
  }

  async start() {
    if (this.isRunning) {
      console.log('Event-driven workflow listener is already running');
      return;
    }

    try {
      // Connect to outrun database
      const outrunUri = `${process.env.MONGODB_URI}/outrun?${process.env.MONGODB_PARAMS}`;
      this.outrunConnection = mongoose.createConnection(outrunUri);
      await this.outrunConnection.asPromise();
      
      console.log('Connected to outrun database');
      
      // Load and start all active trigger listeners
      await this.loadTriggerListeners();
      
      this.isRunning = true;
      console.log('Event-driven workflow listener started successfully');
    } catch (error) {
      console.error('Error starting event-driven workflow listener:', error);
      throw error;
    }
  }

  async stop() {
    if (!this.isRunning) {
      return;
    }

    // Stop all listeners
    for (const [listenerId, listener] of this.listeners) {
      if (listener.changeStream) {
        await listener.changeStream.close();
      }
    }
    this.listeners.clear();

    // Close database connection
    if (this.outrunConnection) {
      await this.outrunConnection.close();
    }

    this.isRunning = false;
    console.log('Event-driven workflow listener stopped');
  }

  async loadTriggerListeners() {
    const TriggerListenerModel = this.outrunConnection.model('TriggerListener', TriggerListener.schema);
    
    // Get all active trigger listeners
    const activeListeners = await TriggerListenerModel.find({ active: true });
    
    console.log(`Found ${activeListeners.length} active trigger listeners`);

    for (const listener of activeListeners) {
      await this.startListener(listener);
    }
  }

  async startListener(triggerListener) {
    const { id, workspaceId, workflowId, triggerType, config } = triggerListener;

    try {
      switch (triggerType) {
        case 'data_change':
          await this.startDataChangeListener(triggerListener);
          break;
        case 'webhook':
          // Webhook listeners are handled by the stream service
          console.log(`Webhook listener ${id} managed by stream service`);
          break;
        case 'schedule':
          await this.startScheduleListener(triggerListener);
          break;
        default:
          console.warn(`Unknown trigger type: ${triggerType}`);
      }
    } catch (error) {
      console.error(`Error starting listener ${id}:`, error);
    }
  }

  async startDataChangeListener(triggerListener) {
    const { id, workspaceId, workflowId, config } = triggerListener;
    
    try {
      // Connect to workspace database
      const workspaceUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
      const workspaceConnection = mongoose.createConnection(workspaceUri);
      await workspaceConnection.asPromise();

      // Create change stream on the specified collection
      const collection = workspaceConnection.collection(config.collection);
      const changeStreamOptions = {
        fullDocument: 'updateLookup'
      };

      // Add filter if specified
      const pipeline = [];
      if (config.operation) {
        pipeline.push({
          $match: {
            operationType: config.operation
          }
        });
      }

      if (config.filter) {
        pipeline.push({
          $match: {
            'fullDocument': config.filter
          }
        });
      }

      const changeStream = collection.watch(pipeline, changeStreamOptions);

      changeStream.on('change', async (change) => {
        console.log(`Data change detected for listener ${id}:`, change.operationType);
        
        // Queue workflow execution
        await this.queueWorkflow(workspaceId, workflowId, {
          type: 'data_change',
          source: config.collection,
          payload: {
            operationType: change.operationType,
            documentKey: change.documentKey,
            fullDocument: change.fullDocument
          }
        });
      });

      changeStream.on('error', (error) => {
        console.error(`Change stream error for listener ${id}:`, error);
      });

      // Store listener info
      this.listeners.set(id, {
        type: 'data_change',
        workspaceId,
        workflowId,
        changeStream,
        workspaceConnection
      });

      console.log(`Started data change listener ${id} for collection ${config.collection}`);
    } catch (error) {
      console.error(`Error starting data change listener ${id}:`, error);
    }
  }

  async startScheduleListener(triggerListener) {
    const { id, workspaceId, workflowId, config } = triggerListener;
    
    // For schedule listeners, we would typically use a cron job scheduler
    // For this implementation, we'll just log that it should be handled
    console.log(`Schedule listener ${id} should be handled by a cron scheduler with expression: ${config.cronExpression}`);
    
    // Store listener info
    this.listeners.set(id, {
      type: 'schedule',
      workspaceId,
      workflowId,
      config
    });
  }

  async queueWorkflow(workspaceId, workflowId, triggeredBy) {
    try {
      const mutation = `
        mutation CreateWorkflowRun($workspaceId: String!, $workflowId: String!, $triggeredBy: JSON!) {
          createWorkflowRun(workspaceId: $workspaceId, workflowId: $workflowId, triggeredBy: $triggeredBy) {
            id
            status
            createdAt
          }
        }
      `;

      const variables = {
        workspaceId,
        workflowId,
        triggeredBy
      };

      const response = await axios.post(this.graphqlEndpoint, {
        query: mutation,
        variables
      }, {
        headers: {
          'Content-Type': 'application/json',
          // In a real implementation, you'd need proper authentication
          'Authorization': `Bearer ${process.env.SYSTEM_API_KEY || 'system-key'}`
        }
      });

      if (response.data.errors) {
        console.error('GraphQL errors:', response.data.errors);
        return;
      }

      const workflowRun = response.data.data.createWorkflowRun;
      console.log(`Queued workflow ${workflowId} with run ID: ${workflowRun.id}`);
      
      // Here you would typically notify the workflow runner service
      await this.notifyWorkflowRunner(workflowRun.id);
      
    } catch (error) {
      console.error('Error queuing workflow:', error);
    }
  }

  async notifyWorkflowRunner(runId) {
    try {
      // In a real implementation, this would call the workflow runner service
      console.log(`Notifying workflow runner to execute run: ${runId}`);
      
      // Example: HTTP call to workflow runner
      // await axios.post('http://workflow-runner:3003/execute', { runId });
      
    } catch (error) {
      console.error('Error notifying workflow runner:', error);
    }
  }

  async addTriggerListener(triggerListener) {
    // Add a new trigger listener dynamically
    await this.startListener(triggerListener);
  }

  async removeTriggerListener(listenerId) {
    // Remove a trigger listener dynamically
    const listener = this.listeners.get(listenerId);
    if (listener) {
      if (listener.changeStream) {
        await listener.changeStream.close();
      }
      if (listener.workspaceConnection) {
        await listener.workspaceConnection.close();
      }
      this.listeners.delete(listenerId);
      console.log(`Removed trigger listener: ${listenerId}`);
    }
  }
}

// Export the listener class and create a singleton instance
const eventDrivenListener = new EventDrivenWorkflowListener();

// Start the listener if this script is run directly
if (require.main === module) {
  eventDrivenListener.start().catch(console.error);
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down gracefully...');
    await eventDrivenListener.stop();
    process.exit(0);
  });
}

module.exports = { EventDrivenWorkflowListener, eventDrivenListener }; 
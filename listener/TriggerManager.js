const cron = require('node-cron')
const express = require('express')
const { TriggerListener, Workflow } = require('../common/schemas/workflow')
const WorkflowQueue = require('./WorkflowQueue')

class TriggerManager {
  constructor() {
    this.scheduledJobs = new Map()
    this.webhookListeners = new Map()
    this.dataChangeWatchers = new Map()
    this.workflowQueue = new WorkflowQueue()
    this.app = express()
    this.setupWebhookEndpoints()
  }

  async initialize() {
    console.log('Initializing Trigger Manager...')
    
    // Load all active triggers from database
    const triggers = await TriggerListener.find({ active: true })
    
    for (const trigger of triggers) {
      await this.setupTrigger(trigger)
    }
    
    console.log(`Initialized ${triggers.length} triggers`)
  }

  async setupTrigger(trigger) {
    switch (trigger.triggerType) {
      case 'webhook':
        this.setupWebhookTrigger(trigger)
        break
      case 'schedule':
        this.setupScheduleTrigger(trigger)
        break
      case 'data_change':
        this.setupDataChangeTrigger(trigger)
        break
    }
  }

  setupWebhookTrigger(trigger) {
    const webhookPath = `/webhook/${trigger.workspaceId}/${trigger.id}`
    
    this.app.post(webhookPath, async (req, res) => {
      try {
        console.log(`Webhook triggered: ${trigger.id}`)
        
        // Validate webhook secret if configured
        if (trigger.config.webhookSecret) {
          const signature = req.headers['x-webhook-signature']
          if (!this.validateWebhookSignature(req.body, signature, trigger.config.webhookSecret)) {
            return res.status(401).json({ error: 'Invalid signature' })
          }
        }

        // Queue workflow execution
        await this.triggerWorkflow(trigger.workflowId, {
          type: 'webhook',
          source: webhookPath,
          payload: req.body
        })

        // Update trigger stats
        await this.updateTriggerStats(trigger.id)
        
        res.json({ success: true, message: 'Workflow triggered' })
      } catch (error) {
        console.error('Webhook trigger error:', error)
        res.status(500).json({ error: error.message })
      }
    })

    this.webhookListeners.set(trigger.id, webhookPath)
    console.log(`Webhook listener setup: ${webhookPath}`)
  }

  setupScheduleTrigger(trigger) {
    const cronExpression = trigger.config.cronExpression
    
    if (!cron.validate(cronExpression)) {
      console.error(`Invalid cron expression for trigger ${trigger.id}: ${cronExpression}`)
      return
    }

    const job = cron.schedule(cronExpression, async () => {
      try {
        console.log(`Schedule triggered: ${trigger.id}`)
        
        await this.triggerWorkflow(trigger.workflowId, {
          type: 'schedule',
          source: cronExpression,
          payload: { triggeredAt: new Date() }
        })

        await this.updateTriggerStats(trigger.id)
      } catch (error) {
        console.error('Schedule trigger error:', error)
      }
    }, {
      scheduled: true,
      timezone: trigger.config.timezone || 'UTC'
    })

    this.scheduledJobs.set(trigger.id, job)
    console.log(`Schedule trigger setup: ${trigger.id} (${cronExpression})`)
  }

  setupDataChangeTrigger(trigger) {
    // MongoDB Change Streams
    const collection = trigger.config.collection
    const operation = trigger.config.operation
    const filter = trigger.config.filter || {}

    // This would be implemented with MongoDB change streams
    // For now, just log the setup
    console.log(`Data change trigger setup: ${trigger.id} on ${collection}`)
    
    // Example implementation:
    /*
    const db = mongoose.connection.db
    const changeStream = db.collection(collection).watch([
      { $match: { 
        operationType: operation,
        ...filter 
      }}
    ])
    
    changeStream.on('change', async (change) => {
      await this.triggerWorkflow(trigger.workflowId, {
        type: 'data_change',
        source: collection,
        payload: change
      })
    })
    */
  }

  async triggerWorkflow(workflowId, triggerInfo) {
    try {
      // Load workflow from database
      const workflow = await Workflow.findOne({ id: workflowId, status: 'active' })
      
      if (!workflow) {
        throw new Error(`Active workflow not found: ${workflowId}`)
      }

      // Queue the workflow for execution
      await this.workflowQueue.enqueue({
        workflowId: workflow.id,
        workspaceId: workflow.workspaceId,
        nodes: workflow.nodes,
        edges: workflow.edges,
        settings: workflow.settings,
        triggeredBy: triggerInfo
      })

      console.log(`Workflow queued for execution: ${workflowId}`)
      
    } catch (error) {
      console.error('Error triggering workflow:', error)
      throw error
    }
  }

  async updateTriggerStats(triggerId) {
    await TriggerListener.findOneAndUpdate(
      { id: triggerId },
      { 
        $set: { lastTriggered: new Date() },
        $inc: { triggerCount: 1 }
      }
    )
  }

  validateWebhookSignature(payload, signature, secret) {
    // Implement webhook signature validation
    // This would typically use HMAC SHA256
    return true // Simplified for now
  }

  setupWebhookEndpoints() {
    this.app.use(express.json())
    
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        service: 'trigger-manager',
        triggers: {
          webhooks: this.webhookListeners.size,
          schedules: this.scheduledJobs.size,
          dataChanges: this.dataChangeWatchers.size
        }
      })
    })
  }

  async addTrigger(triggerConfig) {
    const trigger = new TriggerListener(triggerConfig)
    await trigger.save()
    await this.setupTrigger(trigger)
    return trigger
  }

  async removeTrigger(triggerId) {
    // Remove from database
    await TriggerListener.findOneAndUpdate(
      { id: triggerId },
      { active: false }
    )

    // Cleanup active listeners
    if (this.scheduledJobs.has(triggerId)) {
      this.scheduledJobs.get(triggerId).stop()
      this.scheduledJobs.delete(triggerId)
    }

    if (this.webhookListeners.has(triggerId)) {
      this.webhookListeners.delete(triggerId)
    }

    if (this.dataChangeWatchers.has(triggerId)) {
      // Cleanup data change watcher
      this.dataChangeWatchers.delete(triggerId)
    }
  }

  startServer(port = 3006) {
    this.app.listen(port, () => {
      console.log(`Trigger Manager listening on port ${port}`)
    })
  }
}

module.exports = TriggerManager 
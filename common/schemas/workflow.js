const mongoose = require('mongoose')

// Workflow definition schema
const workflowSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  workspaceId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  description: { type: String },
  version: { type: Number, default: 1 },
  status: { 
    type: String, 
    enum: ['draft', 'active', 'paused', 'archived'], 
    default: 'draft' 
  },
  
  // Visual workflow definition
  nodes: [{ type: mongoose.Schema.Types.Mixed }],
  edges: [{ type: mongoose.Schema.Types.Mixed }],
  
  // Trigger configuration
  triggers: [{
    id: { type: String, required: true },
    type: { 
      type: String, 
      enum: ['webhook', 'schedule', 'data_change', 'manual'],
      required: true 
    },
    config: { type: mongoose.Schema.Types.Mixed },
    active: { type: Boolean, default: true }
  }],
  
  // Execution settings
  settings: {
    timeout: { type: Number, default: 300000 }, // 5 minutes
    retryPolicy: {
      maxRetries: { type: Number, default: 3 },
      backoffStrategy: { type: String, enum: ['linear', 'exponential'], default: 'exponential' }
    },
    concurrency: { type: Number, default: 1 }
  },
  
  // Metadata
  createdBy: { type: String, required: true },
  updatedBy: { type: String },
  tags: [{ type: String }],
  
  // Statistics
  stats: {
    totalRuns: { type: Number, default: 0 },
    successfulRuns: { type: Number, default: 0 },
    failedRuns: { type: Number, default: 0 },
    lastRun: { type: Date },
    avgExecutionTime: { type: Number, default: 0 }
  }
}, {
  timestamps: true,
  collection: 'workflows'
})

// Workflow run schema  
const workflowRunSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  workflowId: { type: String, required: true, index: true },
  workspaceId: { type: String, required: true, index: true },
  
  // Execution details
  status: { 
    type: String, 
    enum: ['queued', 'running', 'completed', 'failed', 'cancelled', 'timeout'],
    default: 'queued'
  },
  startedAt: { type: Date },
  completedAt: { type: Date },
  duration: { type: Number }, // milliseconds
  
  // Trigger information
  triggeredBy: {
    type: { type: String, enum: ['webhook', 'schedule', 'data_change', 'manual'] },
    source: { type: String },
    payload: { type: mongoose.Schema.Types.Mixed }
  },
  
  // Execution data
  input: { type: mongoose.Schema.Types.Mixed },
  output: { type: mongoose.Schema.Types.Mixed },
  error: {
    message: { type: String },
    stack: { type: String },
    nodeId: { type: String } // Which node failed
  },
  
  // Step-by-step execution log
  steps: [{
    nodeId: { type: String, required: true },
    nodeType: { type: String, required: true },
    status: { type: String, enum: ['pending', 'running', 'completed', 'failed', 'skipped'] },
    startedAt: { type: Date },
    completedAt: { type: Date },
    duration: { type: Number },
    input: { type: mongoose.Schema.Types.Mixed },
    output: { type: mongoose.Schema.Types.Mixed },
    error: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed }
  }],
  
  // Resource usage
  usage: {
    aiTokensUsed: { type: Number, default: 0 },
    estimatedCost: { type: Number, default: 0 },
    webhooksCalled: { type: Number, default: 0 },
    dataParsed: { type: Number, default: 0 } // bytes
  }
}, {
  timestamps: true,
  collection: 'workflowRuns'
})

// Workflow trigger listener schema
const triggerListenerSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  workflowId: { type: String, required: true, index: true },
  workspaceId: { type: String, required: true, index: true },
  
  triggerType: { 
    type: String, 
    enum: ['webhook', 'schedule', 'data_change'],
    required: true 
  },
  
  config: {
    // Webhook config
    webhookUrl: { type: String },
    webhookSecret: { type: String },
    
    // Schedule config  
    cronExpression: { type: String },
    timezone: { type: String, default: 'UTC' },
    
    // Data change config
    collection: { type: String },
    operation: { type: String, enum: ['insert', 'update', 'delete'] },
    filter: { type: mongoose.Schema.Types.Mixed }
  },
  
  active: { type: Boolean, default: true },
  lastTriggered: { type: Date },
  triggerCount: { type: Number, default: 0 }
}, {
  timestamps: true
})

module.exports = {
  Workflow: mongoose.model('Workflow', workflowSchema),
  WorkflowRun: mongoose.model('WorkflowRun', workflowRunSchema), 
  TriggerListener: mongoose.model('TriggerListener', triggerListenerSchema)
} 
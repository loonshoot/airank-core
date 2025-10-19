const mongoose = require('mongoose');

/**
 * Batch Schema
 * Stores batch processing jobs and their results
 *
 * Lifecycle:
 * 1. submitted - Batch job created and sent to provider
 * 2. processing - Provider is processing the batch
 * 3. completed - Provider finished, results in GCS
 * 4. received - Results downloaded to MongoDB, GCS files deleted
 * 5. processed - Results analyzed (sentiment, SoV, mentions)
 * 6. failed - Batch job failed
 */

const BatchSchema = new mongoose.Schema({
  // Batch identification
  workspaceId: {
    type: String,
    required: true,
    index: true
  },

  batchId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // Provider information
  provider: {
    type: String,
    required: true,
    enum: ['openai', 'anthropic', 'google'], // anthropic = claude via vertex ai
    index: true
  },

  providerBatchId: {
    type: String, // External batch ID from provider
    required: true
  },

  // Batch configuration
  models: [{
    modelId: String,
    name: String
  }],

  prompts: [{
    promptId: String,
    phrase: String
  }],

  brands: [{
    brandId: String,
    name: String,
    isOwnBrand: Boolean
  }],

  // Request counts
  totalRequests: {
    type: Number,
    required: true
  },

  requestCounts: {
    succeeded: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    cancelled: { type: Number, default: 0 },
    expired: { type: Number, default: 0 }
  },

  // Status tracking
  status: {
    type: String,
    required: true,
    enum: ['submitted', 'processing', 'completed', 'received', 'processed', 'failed'],
    default: 'submitted',
    index: true
  },

  // GCS file locations (before download)
  gcsInputFile: String,
  gcsOutputFile: String,

  // Full batch results (stored after download from GCS)
  results: [{
    custom_id: String, // Format: "workspace_model_prompt_brand"

    // Parsed identifiers from custom_id
    modelId: String,
    promptId: String,
    brandId: String,

    // Response data (varies by provider)
    response: mongoose.Schema.Types.Mixed,

    // Result status
    status: {
      type: String,
      enum: ['succeeded', 'failed', 'cancelled', 'expired']
    },

    // Error information if failed
    error: {
      type: String,
      message: String,
      code: String
    },

    // Token usage
    usage: {
      inputTokens: Number,
      outputTokens: Number,
      totalTokens: Number
    }
  }],

  // Processing flags
  isProcessed: {
    type: Boolean,
    default: false,
    index: true
  },

  processedAt: Date,

  // Error tracking
  error: {
    message: String,
    stack: String,
    timestamp: Date
  },

  // Timestamps
  submittedAt: {
    type: Date,
    default: Date.now
  },

  completedAt: Date,  // When provider finished
  receivedAt: Date,   // When downloaded to MongoDB

  // Metadata
  metadata: {
    jobFrequency: String,
    costSavings: Number, // 50% savings amount
    estimatedCost: Number
  },

  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },

  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update timestamp on save
BatchSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Indexes for common queries
BatchSchema.index({ workspaceId: 1, status: 1 });
BatchSchema.index({ workspaceId: 1, isProcessed: 1 });
BatchSchema.index({ workspaceId: 1, createdAt: -1 });
BatchSchema.index({ status: 1, createdAt: 1 }); // For finding old unprocessed batches

module.exports = BatchSchema;

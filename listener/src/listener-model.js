const mongoose = require('mongoose');

/**
 * Listener Schema - Stores dynamic listener configurations
 * Stored in 'airank' database, 'listeners' collection
 */
const listenerSchema = new mongoose.Schema({
  collection: {
    type: String,
    required: true,
    index: true
  },
  filter: {
    type: Object,
    default: {}
  },
  operationType: {
    type: [String],
    default: ['insert', 'update'],
    set: v => Array.isArray(v) ? v : [v].filter(Boolean)
  },
  jobName: {
    type: String,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  metadata: {
    type: Object,
    default: {}
  },
  lockInfo: {
    instanceId: String,
    lastHeartbeat: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update timestamp on save
listenerSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const Listener = mongoose.model('Listener', listenerSchema, 'listeners');

module.exports = { Listener, listenerSchema };

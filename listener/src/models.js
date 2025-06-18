const mongoose = require('mongoose');

const listenerSchema = new mongoose.Schema({
  collection: String,
  filter: Object,
  operationType: {
    type: [String],
    set: v => Array.isArray(v) ? v : [v].filter(Boolean)
  },
  jobName: String,
  isActive: Boolean,
  metadata: Object,
  lockInfo: {
    instanceId: String,
    lastHeartbeat: Date
  },
  createdAt: Date,
  updatedAt: Date
});

const Listener = mongoose.model('Listener', listenerSchema);

module.exports = { Listener }; 

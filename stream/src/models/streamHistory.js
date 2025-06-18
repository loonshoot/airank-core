const mongoose = require('mongoose');

const streamHistorySchema = new mongoose.Schema({
  sourceID: String,
  startTime: Date,
  endTime: Date,
  runtimeMilliseconds: Number,
  totalIngressBytes: Number,
  ipAddress: String
});

module.exports = { streamHistorySchema }; 
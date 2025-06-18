const mongoose = require('mongoose');

const sourceSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  name: String,
  whitelistedIp: [String],
  bearerToken: String,
  tokenId: String,
  sourceType: String,
  matchingField: String,
  inputs: [{
    name: String,
    type: String,
    validation: String
  }],
  datalakeCollection: String,
  workspaceId: String,
  batchConfig: {
    batchJob: String,
    batchSites: [String],
    batchFrequency: String,
    backfillDate: Date
  },
  __v: Number
});

const Source = mongoose.model('Source', sourceSchema, 'sources');

module.exports = { sourceSchema, Source };
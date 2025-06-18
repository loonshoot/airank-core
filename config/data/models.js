const mongoose = require('mongoose');

// Token Schema
const TokenSchema = new mongoose.Schema({
    email: { type: String, required: true },
    externalId: { type: String },
    displayName: { type: String },
    encryptedAuthToken: { type: String, required: true },
    encryptedAuthTokenIV: { type: String, required: true },
    encryptedRefreshToken: { type: String, required: true },
    encryptedRefreshTokenIV: { type: String, required: true },
    service: { type: String, required: true },
    issueTime: { type: Number, required: true },
    expiryTime: { type: Number, required: true },
    tokenType: { type: String, required: true },
    instanceUrl: { type: String },
    scopes: { type: [String], required: true },
    errorMessages: { type: [String], default: [] }
}, { suppressReservedKeysWarning: true });

// Source Schema
const SourceSchema = new mongoose.Schema({
    name: { type: String, required: true },
    type: { type: String, required: true },
    tokenId: { type: mongoose.Schema.Types.ObjectId, ref: 'Token' },
    batchConfig: {
        type: Object,
        default: {}
    }
});

// Job History Schema
const JobHistorySchema = new mongoose.Schema({
    name: { type: String, required: true },
    status: { type: String, required: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date },
    runtimeMilliseconds: { type: Number },
    errors: [{ type: Object }],
    data: { type: Object },
    jobId: { type: String },
    ingressBytes: { type: Number },
    apiCalls: { type: Number }
}, { suppressReservedKeysWarning: true });

// Search Analytics Data Schema
const SearchAnalyticsDataSchema = new mongoose.Schema({
    site: { type: String, required: true },
    date: { type: Date, required: true },
    query: { type: String, required: true },
    page: { type: String, required: true },
    device: { type: String, required: true },
    country: { type: String, required: true },
    clicks: { type: Number, required: true },
    impressions: { type: Number, required: true },
    ctr: { type: Number, required: true },
    position: { type: Number, required: true },
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobHistory' }
});

// Hubspot Data Schema
const HubspotDataSchema = new mongoose.Schema({
    record: { type: Object, required: true },
    metadata: {
        sourceId: { type: mongoose.Schema.Types.ObjectId, required: true },
        objectType: { type: String, required: true },
        sourceType: { type: String, required: true },
        createdAt: { type: Date, required: true },
        updatedAt: { type: Date, required: true },
        jobHistoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobHistory' }
    }
});

// Generic Schema for Consolidated Records (used by consolidatePeople, etc.)
const ConsolidatedRecordSchema = new mongoose.Schema({}, { strict: false });

// Export both models and schemas
module.exports = {
    Source: mongoose.model('Source', SourceSchema),
    Token: mongoose.model('Token', TokenSchema),
    JobHistory: mongoose.model('JobHistory', JobHistorySchema),
    SearchAnalyticsDataSchema,
    HubspotDataSchema,
    ConsolidatedRecordSchema,
    // Export schemas as well
    TokenSchema,
    SourceSchema,
    JobHistorySchema
}; 
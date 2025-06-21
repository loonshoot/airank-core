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

// Prompt Schema
const PromptSchema = new mongoose.Schema({
    phrase: { type: String, required: true },
    workspaceId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Brand Schema
const BrandSchema = new mongoose.Schema({
    name: { type: String, required: true },
    isOwnBrand: { type: Boolean, default: false },
    workspaceId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Model Schema
const ModelSchema = new mongoose.Schema({
    name: { type: String, required: true },
    provider: { type: String, required: true }, // e.g., 'openai', 'anthropic', 'google'
    modelId: { type: String, required: true }, // e.g., 'gpt-4', 'claude-3-sonnet'
    isEnabled: { type: Boolean, default: true },
    workspaceId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Helper function to get or create a model
const getOrCreateModel = (modelName, schema) => {
    return mongoose.models[modelName] || mongoose.model(modelName, schema);
};

// Export both models and schemas
module.exports = {
    Source: getOrCreateModel('Source', SourceSchema),
    Token: getOrCreateModel('Token', TokenSchema),
    JobHistory: getOrCreateModel('JobHistory', JobHistorySchema),
    Prompt: getOrCreateModel('Prompt', PromptSchema),
    Brand: getOrCreateModel('Brand', BrandSchema),
    Model: getOrCreateModel('Model', ModelSchema),
    SearchAnalyticsDataSchema,
    HubspotDataSchema,
    ConsolidatedRecordSchema,
    // Export schemas as well
    TokenSchema,
    SourceSchema,
    JobHistorySchema,
    PromptSchema,
    BrandSchema,
    ModelSchema
}; 
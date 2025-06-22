# AIRank Jobs Directory

This directory contains dedicated job files that are separate from data source connectors. Jobs here are designed for processing, analysis, and batch operations.

## Structure

```
config/jobs/
├── README.md                    # This file
├── promptModelTester.js         # Tests prompts against AI models
├── promptModelTester.json       # Configuration for promptModelTester
└── [future-job-name].js         # Additional jobs...
```

## Available Jobs

### 1. Prompt Model Tester (`promptModelTester`)

**Purpose**: Tests all workspace prompts against all enabled AI models, stores results, and performs sentiment analysis.

**Features**:
- ✅ Multi-provider support (OpenAI, Anthropic, Google Vertex AI)
- ✅ Redis-based rate limiting per provider/model
- ✅ Automatic sentiment analysis using Gemini
- ✅ Brand mention detection
- ✅ Comprehensive result storage
- ✅ Progress tracking

**Required Environment Variables**:
```bash
# Database
MONGODB_URI=mongodb://localhost:27017
MONGODB_PARAMS=retryWrites=true&w=majority

# Redis (for rate limiting)
REDIS_URL=redis://localhost:6379

# AI Providers (at least one required)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

**Usage**:
```bash
# Trigger via script
node scripts/trigger-prompt-model-test.js <workspaceId>

# Or schedule via API/GraphQL
```

**Database Schema**:
The job stores results in the `previousModelResults` collection with the following structure:

```javascript
{
  promptId: ObjectId,           // Reference to the prompt
  modelId: ObjectId,            // Reference to the model
  prompt: String,               // The actual prompt text
  modelName: String,            // Human-readable model name
  provider: String,             // 'openai', 'anthropic', 'google'
  response: String,             // AI model response
  tokensUsed: Number,           // Total tokens consumed
  responseTime: Number,         // Response time in milliseconds
  workspaceId: String,          // Workspace identifier
  sentimentAnalysis: {          // Added after sentiment analysis
    ownBrandMentioned: Boolean,
    ownBrandSentiment: String,  // 'positive', 'negative', 'neutral', 'not_mentioned'
    competitorBrands: [{
      brandName: String,
      mentioned: Boolean,
      sentiment: String
    }],
    overallSentiment: String,
    analyzedAt: Date,
    analyzedBy: String          // Model used for analysis
  },
  createdAt: Date,
  updatedAt: Date
}
```

## Provider System

The jobs use a unified provider system located in `/config/providers/`:

### OpenAI Provider (`/config/providers/openai/client.js`)
- Supports: GPT-4, GPT-4 Turbo, GPT-3.5 Turbo, GPT-4o, GPT-4o Mini
- Rate limits: 500-3500 RPM depending on model
- Features: Token estimation, automatic retries

### Anthropic Provider (`/config/providers/anthropic/client.js`)
- Supports: Claude 3 Sonnet, Haiku, Opus, Claude 3.5 Sonnet
- Rate limits: 50 RPM, 20k-50k TPM depending on model
- Features: Message format handling, rate limiting

### Google Provider (`/config/providers/google/client.js`)
- Supports: Gemini 1.5 Pro, Gemini 1.5 Flash, Gemini 2.0 Flash
- Rate limits: 300-1000 RPM, 32k-1M TPM
- Features: Vertex AI integration, service account auth

### Provider Factory (`/config/providers/index.js`)
- Unified interface for all providers
- Automatic initialization based on available credentials
- Consistent API across different providers

## Rate Limiting

All providers implement Redis-based rate limiting:

```javascript
// Rate limit keys follow this pattern:
`{provider}:{modelId}:{type}`

// Examples:
"openai:gpt-4:requests"     // Request count for GPT-4
"anthropic:claude-3-sonnet:tokens"  // Token count for Claude
"google:gemini-2.0-flash:requests"  // Request count for Gemini
```

Rate limits are enforced per minute and automatically reset. When limits are hit, jobs will wait for the reset period before continuing.

## Adding New Jobs

1. Create a new `.js` file in this directory
2. Optionally create a `.json` config file with the same name
3. Export a function that takes `(job, done)` parameters
4. The batcher will automatically discover and register the job

**Example job structure**:
```javascript
module.exports = async function myNewJob(job, done) {
    const { workspaceId } = job.attrs.data;
    const redisClient = job.attrs.redisClient;
    
    try {
        // Your job logic here
        console.log('Job started for workspace:', workspaceId);
        
        // Update progress
        job.progress(50);
        
        // Complete the job
        done();
    } catch (error) {
        console.error('Job failed:', error);
        done(error);
    }
};
```

## Monitoring

- Job progress is tracked via Agenda
- Logs include emojis for easy scanning
- Redis keys show current rate limit status
- Database results are stored with timestamps

## Best Practices

1. **Always use the provider factory** instead of direct API calls
2. **Implement proper error handling** with meaningful messages
3. **Update job progress** for long-running operations
4. **Use Redis client** provided by the batcher
5. **Follow the workspace isolation** pattern
6. **Add delays** between API calls to be respectful
7. **Log with emojis** for better readability in logs 
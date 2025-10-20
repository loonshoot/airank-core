# AIRank Batch Processing System

Complete implementation of cost-optimized batch processing for AI model queries.

## Overview

The batch processing system reduces AI API costs by ~50% by using provider batch APIs instead of real-time API calls. The system intelligently routes models to batch processing for recurring jobs while maintaining real-time processing for immediate jobs.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Recurring Job Triggered                       │
│                 (promptModelTester - Monthly)                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                ┌───────────▼──────────┐
                │   Group by Provider   │
                │  - OpenAI models      │
                │  - Claude models      │
                │  - Gemini models      │
                └───────────┬──────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────▼────────┐  ┌──────▼──────┐   ┌───────▼────────┐
│ OpenAI Batch   │  │ Vertex AI   │   │ Gemini Batch   │
│ Submission     │  │ Batch (Clau)│   │ Submission     │
└───────┬────────┘  └──────┬──────┘   └───────┬────────┘
        │                  │                   │
        │                  │                   │
┌───────▼────────┐  ┌──────▼──────┐   ┌───────▼────────┐
│ Store in       │  │ Store in    │   │ Process        │
│ MongoDB        │  │ MongoDB +   │   │ Inline         │
│ (pending)      │  │ GCS         │   │ (sequential)   │
└───────┬────────┘  └──────┬──────┘   └───────┬────────┘
        │                  │                   │
        │                  └──────┬────────────┘
        │                         │
        │                  ┌──────▼──────────┐
        │                  │  Pub/Sub        │
        │                  │  Notification   │
        │                  └──────┬──────────┘
        │                         │
        │                  ┌──────▼──────────┐
        │                  │  Webhook        │
        │                  │  Download       │
        │                  └──────┬──────────┘
        │                         │
        └─────────────────────────┤
                                  │
                          ┌───────▼────────┐
                          │ MongoDB Change │
                          │ Stream Listener│
                          └───────┬────────┘
                                  │
                          ┌───────▼────────┐
                          │ Process Batch  │
                          │ Results Job    │
                          └───────┬────────┘
                                  │
                          ┌───────▼────────┐
                          │ - Save Results │
                          │ - Sentiment    │
                          │ - Mark Done    │
                          └────────────────┘
```

## Components

### 1. Batch Submission Helpers

Located in: `graphql/mutations/helpers/batch/`

#### OpenAI (`openai.js`)
- Uses OpenAI Batch API
- Uploads JSONL to Files API
- Creates batch job with 24h completion window
- Stores batch metadata in MongoDB
- Downloads results via Files API

#### Vertex AI (`vertex.js`)
- **Handles both Claude AND Gemini models** via Google Cloud Vertex AI
- Uploads JSONL to GCS bucket
- Creates batch prediction job with appropriate publisher:
  - Claude models: `publishers/anthropic/models/{model}`
  - Gemini models: `publishers/google/models/{model}`
- Listens for Pub/Sub notifications when complete
- Downloads results from GCS and deletes files
- Single unified implementation for all Google-provided models

#### Index (`index.js`)
- Unified interface for all providers
- Two batch providers: `openai` and `vertex`
- `submitBatch(provider, requests, workspaceDb, workspaceId)`
- `checkBatchStatus(provider, batchId)`
- `downloadBatchResults(provider, fileId, workspaceDb, batchId)`

### 2. Modified promptModelTester Job

Located in: `config/jobs/promptModelTester.js`

**Key Changes:**
- Detects if job is recurring: `job.attrs.repeatInterval !== null`
- Reads `processByBatch` flag from `models.yaml`
- Separates models into batch-enabled and direct processing
- Groups batch models by provider
- Submits batch jobs for recurring jobs only
- Processes direct models immediately for all jobs

**Batch Grouping Logic:**
```javascript
// Both Claude and Gemini use Vertex AI for batch processing
const modelsByProvider = {
  openai: batchModels.filter(m => m.provider === 'openai'),
  vertex: batchModels.filter(m => m.provider === 'google') // All Google models
};
```

### 3. Listener Service

Located in: `listener/`

**Purpose:** Monitor workspace databases for batch completion events

**How it works:**
1. Connects to MongoDB and discovers all `workspace_*` databases
2. Creates change streams on `batches` collection for each workspace
3. Watches for documents with `status: 'received'` and `isProcessed: false`
4. Triggers `processBatchResults` job via Agenda when matched

**Running:**
```bash
cd listener
npm install
npm start

# Or with PM2
pm2 start listener/index.js --name airank-listener
```

**Configuration:** `listener/src/config.js`

### 4. processBatchResults Job

Located in: `config/jobs/processBatchResults.js`

**Triggered by:** Listener service when batch status changes to 'received'

**Process:**
1. Connects to workspace database
2. Retrieves batch document
3. Parses batch results (custom_id format: `workspaceId-promptId-modelId-timestamp`)
4. Retrieves original prompt documents
5. Saves results as `PreviousModelResult` documents
6. Performs sentiment analysis using Gemini
7. Marks batch as `isProcessed: true`

**Auto-discovered** by batcher (scans `config/jobs/` directory)

### 5. Pub/Sub Webhook Endpoint

Located in: `graphql/index.js` (line 651)

**Endpoint:** `POST /webhooks/batch/:workspaceId`

**Triggered by:** Google Cloud Pub/Sub when files are uploaded to GCS bucket

**Process:**
1. Receives Pub/Sub notification (base64 encoded)
2. Decodes GCS file notification
3. Filters for output files only (skips input files)
4. Finds matching batch document in MongoDB
5. Downloads results based on provider:
   - **OpenAI**: Downloads from Files API
   - **Vertex AI (Claude)**: Downloads from GCS and deletes files
   - **Gemini**: No download needed (processed inline)
6. Updates batch status to 'received'
7. Listener service detects change and triggers processing

**No authentication required** (runs before `authenticateToken` middleware)

## Configuration

### Models Configuration

File: `config/models.yaml`

Added `processByBatch: true` flag to all models where `allowedInBatchJobs: true`

Example:
```yaml
- modelId: gpt-4o-mini-2024-07-18
  name: GPT-4o Mini
  provider: openai
  allowedInBatchJobs: true
  processByBatch: true
```

**Models with batch processing enabled:** 19 total
- OpenAI: gpt-4o-mini, gpt-4o, gpt-4-turbo, gpt-4.1, etc.
- Claude (via Vertex AI): All Claude models
- Gemini: All Gemini models

### GCP Infrastructure

Setup script: `scripts/setup-gcp-batch-infrastructure.sh`

**Creates:**
- GCS bucket for batch files (`{PROJECT_ID}-airank-batches`)
- Lifecycle policy: delete files after 2 days
- Pub/Sub topic for completion notifications
- Pub/Sub push subscription to webhook
- Service account with permissions
- Service account key

**Run once:**
```bash
cd scripts
./setup-gcp-batch-infrastructure.sh
```

**Required environment variables:**
```env
GCP_PROJECT_ID=your-project-id
GCP_REGION=us-central1
GCS_BATCH_BUCKET=your-project-id-airank-batches
PUBSUB_BATCH_TOPIC=airank-batch-completions
BATCH_WEBHOOK_URL=https://your-domain.com/webhooks/batch
GOOGLE_APPLICATION_CREDENTIALS=./gcp-batch-processor-key.json
```

### MongoDB Schema

Collection: `batches` (in each workspace database)

Schema defined in: `config/schemas/batch.js`

```javascript
{
  workspaceId: String,
  batchId: String,           // Provider's batch ID
  provider: 'openai' | 'vertex',
  modelType: 'claude' | 'gemini' | null, // Only for vertex provider
  status: 'submitted' | 'processing' | 'completed' | 'received' | 'processed' | 'failed',
  modelId: String,
  requestCount: Number,
  results: Array,            // Batch results stored here
  isProcessed: Boolean,
  submittedAt: Date,
  completedAt: Date,
  processedAt: Date,
  metadata: {
    requests: Array,
    vertexModelId: String,   // For vertex provider
    publisher: String        // 'anthropic' or 'google' for vertex
  }
}
```

## Workflow

### Immediate Job (First Run)
1. User clicks "Run Your First Report"
2. Job scheduled with `schedule: "now"`
3. Job runs immediately with all models
4. All models processed directly (no batching)
5. Results available immediately

### Recurring Job (Monthly/Weekly/Daily)
1. Agenda triggers recurring job based on entitlements
2. Job detects `repeatInterval` is set
3. Models separated: batch-enabled vs direct
4. **Batch-enabled models:**
   - Grouped by provider
   - Submitted as batch jobs to provider APIs
   - Stored in MongoDB with status 'submitted'
   - Job completes (doesn't wait for results)
5. **Direct models:**
   - Processed immediately as before
   - Results saved to MongoDB
6. **When batch completes (hours/days later):**
   - Provider sends results to GCS (Vertex AI) or Files API (OpenAI)
   - Pub/Sub notification triggers webhook
   - Webhook downloads results and stores in MongoDB
   - Status changed to 'received'
   - Listener detects change
   - `processBatchResults` job scheduled
   - Results processed and sentiment analysis performed
   - Batch marked as 'processed'

## Cost Savings

### OpenAI Batch API
- **Savings:** 50% discount on API costs
- **Completion time:** Up to 24 hours
- **Example:** GPT-4o Mini: $0.055 per 1K tokens (vs $0.11 standard)

### Vertex AI Batch Prediction (Claude & Gemini)
- **Savings:** ~50% discount vs real-time API for both Claude and Gemini
- **Completion time:** Hours to days depending on volume
- **Example:**
  - Claude 3.5 Haiku: Significant cost reduction
  - Gemini 2.5 Flash: ~50% cost reduction vs real-time API
- **Benefit:** True batch processing for all Google models

## Monitoring

### Listener Service
```bash
# View logs
pm2 logs airank-listener

# Heartbeat every 30 seconds
💓 Heartbeat: 5 active streams, uptime: 3600s
```

### Batch Jobs
```bash
# Check batch status in MongoDB
use workspace_{workspaceId}
db.batches.find({ isProcessed: false })

# View job logs in Agenda
use airank
db.jobs.find({ name: 'processBatchResults' })
```

### Webhook
Check GraphQL server logs for webhook activity:
```
📨 Batch webhook received for workspace {id}
📦 GCS notification: {fileName}
✓ Found batch: {batchId} ({provider})
✅ Batch results downloaded and stored
```

## Deployment

### 1. Deploy GCP Infrastructure
```bash
./scripts/setup-gcp-batch-infrastructure.sh
```

### 2. Update Environment Variables
Add to `.env`:
```env
GCP_PROJECT_ID=
GCS_BATCH_BUCKET=
GOOGLE_APPLICATION_CREDENTIALS=./gcp-batch-processor-key.json
```

### 3. Start Listener Service
```bash
pm2 start listener/index.js --name airank-listener
pm2 save
```

### 4. Deploy GraphQL Server
Webhook endpoint is automatically available at:
`POST https://your-domain.com/webhooks/batch/:workspaceId`

### 5. Update Pub/Sub Subscription
Point the push endpoint to your production webhook URL:
```bash
gcloud pubsub subscriptions update airank-batch-webhook \
  --push-endpoint="https://your-domain.com/webhooks/batch"
```

## Testing

### Test Batch Submission
```bash
# Trigger a recurring job manually
cd batcher
node trigger-job.js
```

### Test Webhook
```bash
# Send test Pub/Sub message
gcloud pubsub topics publish airank-batch-completions \
  --message='{"name":"batches/output/workspace_123/file.jsonl","bucket":"your-bucket"}'
```

### Test Listener
```bash
# Update a batch document
use workspace_{workspaceId}
db.batches.updateOne(
  { batchId: 'test-batch' },
  { $set: { status: 'received', isProcessed: false } }
)
# Listener should trigger processBatchResults job
```

## Troubleshooting

### Batches not processing
1. Check listener service is running: `pm2 status airank-listener`
2. Check batch status in MongoDB: `db.batches.find()`
3. Check Agenda jobs: `db.jobs.find({ name: 'processBatchResults' })`

### Webhook not receiving notifications
1. Verify Pub/Sub subscription: `gcloud pubsub subscriptions describe airank-batch-webhook`
2. Check webhook endpoint is accessible
3. Check GCS bucket has notification configured

### GCS files not deleted
1. Check service account permissions
2. Verify batch download function is called
3. Check for errors in GraphQL server logs

## Future Enhancements

1. **Batch status polling:** Periodic job to check OpenAI batch status
2. **Retry logic:** Automatic retry for failed batches
3. **Dashboard:** UI to monitor batch processing status
4. **Cost tracking:** Track savings from batch processing
5. **Multiple webhooks:** Support multiple workspaces with different endpoints
6. **Batch priorities:** Priority queue for urgent vs regular batches

## Files Created/Modified

### New Files
- `graphql/mutations/helpers/batch/openai.js` - OpenAI batch API integration
- `graphql/mutations/helpers/batch/vertex.js` - Unified Vertex AI for Claude + Gemini
- `graphql/mutations/helpers/batch/index.js` - Unified batch interface
- `config/jobs/processBatchResults.js` - Batch result processor job
- `listener/package.json` - Listener service dependencies
- `listener/index.js` - Listener service entry point
- `listener/src/config.js` - Listener configuration
- `listener/src/listener-manager.js` - Change stream manager
- `listener/README.md` - Listener documentation
- `scripts/setup-gcp-batch-infrastructure.sh` - GCP setup script
- `scripts/add-process-by-batch.js` - Add processByBatch flag to models
- `docs/BATCH_PROCESSING.md` - This documentation

### Modified Files
- `config/jobs/promptModelTester.js` - Added batch processing logic
- `config/models.yaml` - Added `processByBatch: true` to all models
- `graphql/index.js` - Added webhook endpoint

## Dependencies Added

- `@google-cloud/storage` - GCS file operations
- `@google-cloud/aiplatform` - Vertex AI batch predictions
- `@google/generative-ai` - Gemini API
- `openai` - OpenAI Batch API

All dependencies already exist in package.json.

# Vertex AI Batch Processing Setup Guide

## Current Status

✅ **OpenAI Batch Processing** - Working (tested successfully)
❌ **Vertex AI Batch Processing** - Requires setup

## Issues Found

1. ❌ **GCS Bucket Missing**: `gs://airank-production-batches` doesn't exist
2. ❌ **Pub/Sub Not Configured**: No topic/subscription for GCS notifications
3. ⚠️ **Service Account Permissions**: May need additional IAM roles

## Architecture Overview

### Optimized for Security & Scalability

```
Vertex AI Batch Flow (Horizontally Scalable):
┌─────────────────────────────────────────────────────────────┐
│ 1. Submit Batch (promptModelTester job)                     │
│    └─> Upload JSONL to GCS: gs://bucket/batches/input/...  │
│    └─> Create Vertex AI BatchPredictionJob                  │
│    └─> Store batch doc (status: 'submitted')                │
└─────────────────────────────────────────────────────────────┘
                           ⬇
┌─────────────────────────────────────────────────────────────┐
│ 2. Vertex AI Processing (Async - minutes to hours)          │
│    └─> Processes batch in Google's infrastructure           │
│    └─> Writes results to GCS: gs://bucket/batches/output/...│
└─────────────────────────────────────────────────────────────┘
                           ⬇
┌─────────────────────────────────────────────────────────────┐
│ 3. GCS Pub/Sub Notification (MISSING - NEEDS SETUP)         │
│    └─> GCS detects new file (OBJECT_FINALIZE event)         │
│    └─> Publishes to Pub/Sub topic                           │
│    └─> Pub/Sub pushes to webhook endpoint                   │
└─────────────────────────────────────────────────────────────┘
                           ⬇
┌─────────────────────────────────────────────────────────────┐
│ 4. Stream Service - Lightweight Webhook (READY)             │
│    POST /webhooks/batch                                      │
│    └─> Receives GCS notification                            │
│    └─> Extracts workspaceId from GCS path                   │
│    └─> Creates batchnotifications document                  │
│    └─> Returns 200 immediately                              │
│                                                              │
│    🔒 Security: No GCS credentials exposed to internet      │
│    📈 Scalable: Fast response, can handle high throughput   │
└─────────────────────────────────────────────────────────────┘
                           ⬇
┌─────────────────────────────────────────────────────────────┐
│ 5. Listener Service - Change Stream Monitor (READY)         │
│    └─> Watches batchnotifications collection                │
│    └─> Detects new notification (processed: false)          │
│    └─> Creates processVertexBatchNotification job           │
│                                                              │
│    📈 Scalable: Can run multiple listener instances         │
└─────────────────────────────────────────────────────────────┘
                           ⬇
┌─────────────────────────────────────────────────────────────┐
│ 6. Batcher Service - Download & Process (READY)             │
│    processVertexBatchNotification job:                       │
│    └─> Downloads results from GCS (secure credentials)      │
│    └─> Updates batch to status: 'received'                  │
│    └─> Deletes GCS files (cleanup)                          │
│    └─> Marks notification as processed                      │
│                                                              │
│    💰 Cost Optimization: Can restrict scaling (non-realtime)│
│    🔒 Security: GCS credentials only in batcher             │
└─────────────────────────────────────────────────────────────┘
                           ⬇
┌─────────────────────────────────────────────────────────────┐
│ 7. Listener Service - Batch Results Monitor (READY)         │
│    └─> Detects batch.status = 'received'                    │
│    └─> Creates processBatchResults job                      │
└─────────────────────────────────────────────────────────────┘
                           ⬇
┌─────────────────────────────────────────────────────────────┐
│ 8. Batcher Service - Sentiment Analysis (READY)             │
│    processBatchResults job:                                  │
│    └─> Parses results and saves to database                 │
│    └─> Runs sentiment analysis (Gemini)                     │
│    └─> Marks batch.isProcessed = true                       │
└─────────────────────────────────────────────────────────────┘
```

### Key Architectural Benefits

1. **Security**: GCS credentials never exposed to internet-facing webhook
2. **Scalability**: Stream service can scale horizontally for high throughput
3. **Cost Optimization**: Batcher can be scaled conservatively (non-realtime processing)
4. **Separation of Concerns**: Each service has a single, focused responsibility

## Required Setup Steps

### Step 1: Create GCS Bucket

```bash
# Create bucket in same region as Vertex AI
gsutil mb -p airank-production -l us-east5 gs://airank-production-batches

# Set lifecycle policy to auto-delete old files (optional but recommended)
cat > lifecycle.json <<EOF
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "Delete"},
        "condition": {"age": 7}
      }
    ]
  }
}
EOF

gsutil lifecycle set lifecycle.json gs://airank-production-batches
```

### Step 2: Grant Service Account Permissions

```bash
# Storage permissions
gcloud projects add-iam-policy-binding airank-production \
  --member="serviceAccount:airank-batch-processor@airank-production.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"

# Vertex AI permissions (if not already granted)
gcloud projects add-iam-policy-binding airank-production \
  --member="serviceAccount:airank-batch-processor@airank-production.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

# Pub/Sub publisher (for GCS notifications)
gcloud projects add-iam-policy-binding airank-production \
  --member="serviceAccount:service-791169578153@gs-project-accounts.iam.gserviceaccount.com" \
  --role="roles/pubsub.publisher"
```

### Step 3: Create Pub/Sub Topic

```bash
# Create topic for batch completion notifications
gcloud pubsub topics create vertex-batch-completion --project=airank-production
```

### Step 4: Create Pub/Sub Push Subscription

**Domain**: stream.getairank.com (maps to stream service port 4003)

```bash
# Webhook URL - generic endpoint that extracts workspaceId from GCS file path
WEBHOOK_URL="https://stream.getairank.com/webhooks/batch"

# Create push subscription
gcloud pubsub subscriptions create vertex-batch-sub \
  --topic=vertex-batch-completion \
  --push-endpoint="${WEBHOOK_URL}" \
  --project=airank-production

# Note: The webhook automatically extracts workspaceId from the GCS file path
# Path format: batches/output/{workspaceId}/{timestamp}/file.jsonl
```

### Step 5: Configure GCS Bucket Notifications

```bash
# Set up GCS to send notifications when files are created in output folder
gcloud storage buckets notifications create \
  gs://airank-production-batches \
  --topic=vertex-batch-completion \
  --event-types=OBJECT_FINALIZE \
  --payload-format=json \
  --project=airank-production

# Verify notification was created
gcloud storage buckets notifications list gs://airank-production-batches
```

### Step 6: Test the Complete Flow

```bash
# 1. Enable a Gemini or Claude model in your workspace
node enable-gemini-model.js <workspaceId>
node allow-gemini.js <workspaceId>

# 2. Create a test batch
node create-test-batch.js <workspaceId>

# 3. Check batch was created
node test-vertex-batch-flow.js <workspaceId>

# 4. Monitor GCS for output files (will take time - could be hours)
gsutil ls gs://airank-production-batches/batches/output/

# 5. Check webhook logs when complete
# Look for "Batch webhook received" in graphql service logs

# 6. Verify processing
node check-batch-processing.js <workspaceId>
```

## Environment Variables

Required in `.env` and production:

```bash
# GCP Configuration
GCP_PROJECT_ID=airank-production
GCP_REGION=us-east5
GCS_BATCH_BUCKET=airank-production-batches
GOOGLE_APPLICATION_CREDENTIALS=./gcp-batch-processor-key.json  # Path to service account key
```

## Webhook Endpoint

The webhook is implemented in dedicated `stream` service (`stream/index.js`):

```
Service: stream (port 4003)
POST /webhooks/batch

Handles:
- GCS Pub/Sub push notifications for Vertex AI batches
- Extracts workspaceId from GCS file path automatically
- Downloads Vertex AI batch results from GCS
- Updates batch status to 'received' (triggers listener)
- Cleans up GCS files

URL: https://stream.getairank.com/webhooks/batch
```

**Architecture**: Following outrun-core pattern, webhooks and external integrations
are handled by a dedicated `stream` service, separate from the GraphQL API.

## Supported Models via Vertex AI

### Gemini Models (Google)
- gemini-2.5-flash
- gemini-2.5-pro
- gemini-2.5-flash-lite
- gemini-2.0-flash
- gemini-1.5-pro
- gemini-1.5-flash

### Claude Models (Anthropic via Vertex)
- claude-3-5-haiku-20241022
- claude-3-5-sonnet-20241022
- claude-haiku-4-5
- claude-3-opus-20240229

## Testing Scripts

Created during this session:

1. `test-vertex-ai.js` - Test basic Vertex AI API access
2. `test-vertex-batch-submit.js` - Test batch job submission
3. `test-vertex-batch-flow.js` - Check existing batches and flow
4. `enable-gemini-model.js` - Enable Gemini model in workspace
5. `allow-gemini.js` - Add Gemini to billing profile allowed models
6. `check-batch-processing.js` - Verify batch processing completion

## Troubleshooting

### Batch Submission Fails with "project not found"
- Check `GCP_PROJECT_ID` environment variable
- Verify Vertex AI API is enabled: `gcloud services enable aiplatform.googleapis.com`

### Batch Stays in "submitted" Status Forever
- Check GCS bucket exists
- Verify Pub/Sub topic and subscription exist
- Check webhook endpoint is accessible from Google
- Review graphql service logs for webhook errors

### Webhook Not Receiving Notifications
- Verify GCS notification is configured: `gcloud storage buckets notifications list`
- Check Pub/Sub subscription delivery status
- Ensure webhook URL is correct and accessible
- Check for firewall/security rules blocking Google IPs

### Results Not Processed
- Check listener service is running
- Verify MongoDB change streams are working
- Check batcher service is running
- Review Agenda jobs collection for errors

## Next Steps

1. **Create GCS bucket** (requires admin/owner permissions)
2. **Set up Pub/Sub** topic and subscription
3. **Configure GCS notifications**
4. **Test with a Gemini batch**
5. **Monitor webhook logs**
6. **Verify end-to-end flow**

## Cost Considerations

- GCS storage costs for input/output files (minimal, auto-deleted after 7 days)
- Pub/Sub message costs (very low, <$0.01 per 1000 notifications)
- Vertex AI batch processing costs (cheaper than real-time API)
- Gemini: ~50% cost reduction vs real-time
- Claude via Vertex: Similar pricing to real-time but better throughput

## Summary

**Status**:
- ✅ Code is ready (webhook, batch submission, processing)
- ✅ OpenAI batch flow tested and working
- ❌ Infrastructure setup needed for Vertex AI
- ⏳ Requires admin access to create GCS bucket and Pub/Sub resources

**Estimated Setup Time**: 15-30 minutes
**Testing Time**: 1-2 hours (waiting for batch to complete)

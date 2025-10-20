# AIRank Batch Processing - Setup & Testing Guide

Complete guide to set up, deploy, and test the batch processing system.

## Prerequisites

- Google Cloud Platform account with billing enabled
- Project with Vertex AI API enabled
- OpenAI API key
- MongoDB database
- Node.js and npm installed

## Part 1: Google Cloud Setup

### Step 1: Enable Required APIs

```bash
# Set your project ID
export GCP_PROJECT_ID="your-project-id"
gcloud config set project $GCP_PROJECT_ID

# Enable required APIs
gcloud services enable aiplatform.googleapis.com
gcloud services enable storage.googleapis.com
gcloud services enable pubsub.googleapis.com
```

### Step 2: Run Infrastructure Setup Script

```bash
cd /Users/graysoncampbell/dev/airank-core
chmod +x scripts/setup-gcp-batch-infrastructure.sh
./scripts/setup-gcp-batch-infrastructure.sh
```

This script will:
- ✅ Create GCS bucket for batch files
- ✅ Set lifecycle policy (delete after 2 days)
- ✅ Create Pub/Sub topic
- ✅ Create GCS notification → Pub/Sub
- ✅ Create service account with permissions
- ✅ Generate service account key (`gcp-batch-processor-key.json`)

### Step 3: Configure Pub/Sub Push Subscription

**During development (local testing):**

Use ngrok to expose your local server:
```bash
# Install ngrok
brew install ngrok

# Start ngrok
ngrok http 4002

# Copy the HTTPS URL (e.g., https://abc123.ngrok.io)
```

**Create push subscription:**
```bash
export WEBHOOK_URL="https://abc123.ngrok.io/webhooks/batch"

gcloud pubsub subscriptions create airank-batch-webhook \
  --topic=airank-batch-completions \
  --push-endpoint="${WEBHOOK_URL}/{workspaceId}" \
  --ack-deadline=60
```

**For production:**
```bash
export WEBHOOK_URL="https://api.airank.com/webhooks/batch"

gcloud pubsub subscriptions create airank-batch-webhook \
  --topic=airank-batch-completions \
  --push-endpoint="${WEBHOOK_URL}/{workspaceId}" \
  --ack-deadline=60
```

## Part 2: Environment Configuration

### Step 1: Update .env File

Add/update the following in `/Users/graysoncampbell/dev/airank-core/.env`:

```env
# Existing MongoDB and API keys
MONGODB_URI=mongodb://localhost:27017
MONGODB_PARAMS=authSource=admin
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...

# NEW: Google Cloud Batch Processing
GCP_PROJECT_ID=your-project-id
GCP_REGION=us-central1
GCS_BATCH_BUCKET=your-project-id-airank-batches
GOOGLE_APPLICATION_CREDENTIALS=./gcp-batch-processor-key.json
```

### Step 2: Copy Service Account Key

```bash
# The setup script created this file
# Make sure it's in the airank-core root directory
ls -la /Users/graysoncampbell/dev/airank-core/gcp-batch-processor-key.json
```

## Part 3: Install Dependencies

### Main Project

```bash
cd /Users/graysoncampbell/dev/airank-core

# Check if dependencies are already installed
npm list @google-cloud/storage @google-cloud/aiplatform openai

# If not, they should already be in package.json
# Just run:
npm install
```

### Listener Service

```bash
cd /Users/graysoncampbell/dev/airank-core/listener
npm install
```

## Part 4: Start Services

### Terminal 1: GraphQL Server (with webhook)

```bash
cd /Users/graysoncampbell/dev/airank-core/graphql
npm start

# Should see:
# ✓ Connected to MongoDB
# GraphQL server listening on port 4002
```

### Terminal 2: Batcher (job processor)

```bash
cd /Users/graysoncampbell/dev/airank-core/batcher
npm start

# Should see:
# ✓ Connected to Redis
# ✓ Agenda initialized
# Discovering jobs...
# Found jobs: promptModelTester, processBatchResults, ...
```

### Terminal 3: Listener Service

```bash
cd /Users/graysoncampbell/dev/airank-core/listener
npm start

# Should see:
# 🚀 Starting AIRank Listener Service...
# 🔌 Connecting to MongoDB...
# ✓ Connected to MongoDB
# ✓ Agenda initialized
# 💓 Starting heartbeat...
# 🎧 Starting listeners for all workspace databases...
# 📊 Found X workspace databases
# 🎧 Starting listener: workspaceId-batches (job: processBatchResults)
# ✅ AIRank Listener Service is running
```

### Terminal 4: Ngrok (for local testing)

```bash
ngrok http 4002

# Copy the HTTPS forwarding URL
# Update Pub/Sub subscription if needed
```

## Part 5: Testing

### Test 1: Verify Configuration

```bash
# Check models have processByBatch flag
cd /Users/graysoncampbell/dev/airank-core
grep -A2 "processByBatch: true" config/models.yaml | head -20

# Should see multiple models with processByBatch: true
```

### Test 2: Create Test Workspace

```bash
# Use the GraphQL playground or create via app
# Make sure you have:
# - At least 1 prompt
# - At least 1 brand (own brand)
# - At least 1 model selected
# - Billing profile with recurring job frequency
```

### Test 3: Trigger Immediate Job (No Batching)

```bash
cd /Users/graysoncampbell/dev/airank-core/batcher

# Edit trigger-job.js to use your workspace ID
# Change line 14:
const workspaceId = 'YOUR_WORKSPACE_ID_HERE';

# Run immediate job
node trigger-job.js
```

**Expected output:**
```
🚀 Starting prompt-model testing job for workspace {id}
📋 Job type: IMMEDIATE (will use direct API calls)
📊 Found X prompts, Y brands, and Z available models
🔄 Starting direct processing for Z models...
📝 Processing prompt: "..."
✓ Completed gpt-4o-mini for prompt: "..."
🎯 Direct model testing completed. X successful, Y failed
🔍 Starting sentiment analysis...
✓ Sentiment analysis completed
🎉 Job completed successfully
```

### Test 4: Trigger Recurring Job (WITH Batching!)

```bash
# First, schedule a recurring job via the app UI:
# 1. Go to workspace
# 2. Click "Run Your First Report"
# 3. This creates a recurring job

# Or manually schedule:
cd /Users/graysoncampbell/dev/airank-core

# Create a script: test-batch-job.js
cat > test-batch-job.js << 'EOF'
const Agenda = require('agenda');
require('dotenv').config();

const mongoUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;

async function scheduleBatchJob() {
  const agenda = new Agenda({ db: { address: mongoUri } });
  await agenda.start();

  const workspaceId = 'YOUR_WORKSPACE_ID';

  // Create a recurring job
  const job = await agenda.create('promptModelTester', {
    workspaceId: workspaceId
  });

  job.repeatEvery('1 month');
  await job.save();

  // Also run it now to test
  await agenda.now('promptModelTester', { workspaceId });

  console.log('✓ Recurring job scheduled');
  setTimeout(() => process.exit(0), 2000);
}

scheduleBatchJob();
EOF

node test-batch-job.js
```

**Expected output in Batcher logs:**
```
🚀 Starting prompt-model testing job for workspace {id}
📋 Job type: RECURRING (will use batch processing)
📊 Found 1 prompts, 1 brands
📊 Models: 15 batch-enabled, 0 direct processing
📦 Starting batch processing for batch-enabled models...
📦 Preparing openai batch with 5 models × 1 prompts = 5 requests
✓ Submitted openai batch: batch_abc123 (5 requests)
📦 Preparing vertex batch with 10 models × 1 prompts = 10 requests
✓ Submitted vertex batch: projects/.../batchPredictionJobs/123 (10 requests)
📦 Batch submission completed. Results will be processed when batches complete.
```

**Check MongoDB:**
```bash
# Connect to workspace database
mongosh "mongodb://localhost:27017/workspace_YOUR_WORKSPACE_ID?authSource=admin"

# Check batches collection
db.batches.find().pretty()

# Should see documents like:
{
  "_id": ObjectId("..."),
  "workspaceId": "...",
  "batchId": "batch_abc123",
  "provider": "openai",
  "status": "submitted",
  "requestCount": 5,
  ...
}
{
  "_id": ObjectId("..."),
  "workspaceId": "...",
  "batchId": "projects/.../batchPredictionJobs/123",
  "provider": "vertex",
  "modelType": "claude",
  "status": "submitted",
  "requestCount": 10,
  ...
}
```

### Test 5: Monitor Batch Status

**For OpenAI batches:**
```bash
# Check OpenAI dashboard
# https://platform.openai.com/batches

# Or via API:
curl https://api.openai.com/v1/batches/batch_abc123 \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

**For Vertex AI batches:**
```bash
gcloud ai batch-prediction-jobs list \
  --region=us-central1 \
  --project=$GCP_PROJECT_ID

# Get details:
gcloud ai batch-prediction-jobs describe JOB_ID \
  --region=us-central1
```

### Test 6: Simulate Batch Completion (Webhook Test)

**For Vertex AI (GCS notification):**

```bash
# Manually trigger webhook with test data
curl -X POST http://localhost:4002/webhooks/batch/YOUR_WORKSPACE_ID \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "data": "'$(echo -n '{"name":"batches/output/YOUR_WORKSPACE_ID/12345/results.jsonl","bucket":"'$GCS_BATCH_BUCKET'"}' | base64)'"
    }
  }'
```

**Expected GraphQL server logs:**
```
📨 Batch webhook received for workspace {id}
📦 GCS notification: {fileName: "batches/output/..."}
✓ Found batch: {batchId} (vertex)
✓ Downloaded 10 results for batch {batchId}
✓ Deleted input file: batches/input/...
✓ Deleted output file: batches/output/...
✅ Batch results downloaded and stored for {batchId}
```

**Expected Listener logs:**
```
📨 Change detected: batches (update) in workspace {id}
✓ Scheduled job: processBatchResults ({jobId}) for workspace {id}
```

**Expected Batcher logs (processBatchResults job):**
```
🔄 Processing batch results for workspace {id}, batch {documentId}
✓ Connected to workspace database
📦 Batch: {batchId} (vertex) - 10 results
🏷️ Brands: Own brand "{name}", 0 competitors
✓ Processed result 1/10
✓ Processed result 2/10
...
✓ Sentiment analysis completed
✅ Batch processing completed: 10 results saved, 10 sentiment analyses
```

### Test 7: Verify Results in Database

```bash
mongosh "mongodb://localhost:27017/workspace_YOUR_WORKSPACE_ID?authSource=admin"

# Check processed batch
db.batches.findOne({ batchId: "batch_abc123" })

# Should show:
# status: "received"
# isProcessed: true
# processedAt: ISODate("...")
# processingStats: { savedResults: 10, sentimentCompleted: 10, ... }

# Check model results
db.previousmodelresults.find({ batchId: "batch_abc123" }).count()
# Should match requestCount

# Check individual result
db.previousmodelresults.findOne({ batchId: "batch_abc123" })

# Should have:
# - response: "..." (AI response)
# - sentimentAnalysis: { brands: [...], overallSentiment: "..." }
# - processedAt: ISODate("...")
```

## Part 6: Production Deployment

### Using PM2

```bash
# Install PM2
npm install -g pm2

# Start services
cd /Users/graysoncampbell/dev/airank-core

# GraphQL Server
pm2 start graphql/index.js --name airank-graphql

# Batcher
pm2 start batcher/index.js --name airank-batcher

# Listener
pm2 start listener/index.js --name airank-listener

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

### Update Pub/Sub for Production

```bash
# Update webhook URL to production
gcloud pubsub subscriptions update airank-batch-webhook \
  --push-endpoint="https://api.airank.com/webhooks/batch/{workspaceId}"
```

## Troubleshooting

### Issue: Batches not submitting

**Check:**
1. Job is recurring (has `repeatInterval` set)
2. Models have `processByBatch: true` in models.yaml
3. Environment variables are set (GCP_PROJECT_ID, GCS_BATCH_BUCKET, etc.)
4. Service account key file exists and is valid

**Debug:**
```bash
# Check job attributes
mongosh "mongodb://localhost:27017/airank?authSource=admin"
db.jobs.findOne({ name: 'promptModelTester' })

# Should have:
# repeatInterval: "1 month" (or other interval)
```

### Issue: Webhook not receiving notifications

**Check:**
1. Pub/Sub subscription is created
2. GCS bucket has notification configured
3. Webhook endpoint is accessible (use ngrok for local)
4. Pub/Sub has correct push endpoint URL

**Test webhook directly:**
```bash
curl -X POST http://localhost:4002/webhooks/batch/test \
  -H "Content-Type: application/json" \
  -d '{"message":{"data":"'$(echo -n '{"name":"test","bucket":"test"}' | base64)'"}}'

# Should return 200 OK
```

**Check Pub/Sub logs:**
```bash
gcloud logging read "resource.type=pubsub_subscription" --limit 50
```

### Issue: Listener not triggering processBatchResults

**Check:**
1. Listener service is running
2. Batch status changed to "received"
3. Batch isProcessed is false
4. Listener is watching correct workspace database

**Debug:**
```bash
# Check listener logs
pm2 logs airank-listener

# Manually update batch to trigger
mongosh "mongodb://localhost:27017/workspace_YOUR_WORKSPACE_ID?authSource=admin"
db.batches.updateOne(
  { batchId: "test" },
  { $set: { status: "received", isProcessed: false } }
)

# Should trigger job immediately
```

### Issue: GCS files not deleted

**Check:**
1. Service account has `storage.objects.delete` permission
2. Batch provider is "vertex" (only Vertex uses GCS)
3. Download function is being called successfully

**Debug:**
```bash
# Check GCS bucket
gsutil ls -r gs://$GCS_BATCH_BUCKET/batches/

# Manually delete old files
gsutil rm -r gs://$GCS_BATCH_BUCKET/batches/output/OLD_WORKSPACE_ID/
```

### Issue: High costs

**Check:**
1. GCS lifecycle policy is active (2-day deletion)
2. Batches are being marked as processed (prevents reprocessing)
3. No duplicate jobs running

**Verify lifecycle:**
```bash
gsutil lifecycle get gs://$GCS_BATCH_BUCKET
```

## Monitoring

### PM2 Dashboard

```bash
pm2 monit
```

### Logs

```bash
# All services
pm2 logs

# Specific service
pm2 logs airank-listener

# Follow logs
pm2 logs --lines 100 --raw
```

### MongoDB Queries

```bash
# Check active batches
db.batches.find({
  status: { $in: ['submitted', 'processing'] }
}).count()

# Check processed batches today
db.batches.find({
  processedAt: {
    $gte: new Date(new Date().setHours(0,0,0,0))
  }
}).count()

# Check failed batches
db.batches.find({ status: 'failed' })
```

### Google Cloud Console

- **Vertex AI Jobs**: https://console.cloud.google.com/vertex-ai/batch-predictions
- **GCS Bucket**: https://console.cloud.google.com/storage/browser
- **Pub/Sub**: https://console.cloud.google.com/cloudpubsub

## Cost Optimization Tips

1. **Use lifecycle policies** - Already set to 2 days
2. **Monitor batch sizes** - Larger batches = fewer overhead costs
3. **Check batch completion times** - Optimize for your use case
4. **Use regional resources** - Keep bucket and Vertex AI in same region
5. **Clean up old batches** - Regularly purge old batch documents from MongoDB

## Next Steps

Once everything is working:

1. ✅ Test with real prompts and brands
2. ✅ Monitor costs for first few batches
3. ✅ Set up alerts for failed batches
4. ✅ Create dashboard for batch monitoring
5. ✅ Document any production-specific configurations

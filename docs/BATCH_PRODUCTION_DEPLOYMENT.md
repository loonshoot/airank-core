# Batch Processing - Production Deployment & Testing

Complete guide for deploying and testing batch processing in production (avoiding ngrok limitations).

## Why Production Testing?

**Problem with Local Testing:**
- Ngrok URLs expire
- OpenAI batches: up to 24 hours to complete
- Vertex AI batches: hours to days to complete
- Webhook needs stable URL for Pub/Sub notifications

**Solution:**
Deploy to production with stable webhook URL, test there.

## Pre-Deployment Checklist

- [x] GCP infrastructure created (bucket, Pub/Sub, service account)
- [x] Service account key generated
- [x] Code changes committed
- [ ] Production webhook URL identified
- [ ] Pub/Sub subscription configured with production URL
- [ ] Code deployed to production
- [ ] Environment variables set in production
- [ ] Services restarted

## Step 1: Identify Production URLs

What's your production setup?
- GraphQL API: `https://api.airank.com` or similar?
- Where are you deploying? (DigitalOcean App Platform, Railway, Heroku, etc.)

**Required endpoint:**
- `POST https://YOUR_DOMAIN/webhooks/batch/{workspaceId}`

## Step 2: Update Pub/Sub Subscription

Once you know your production URL:

```bash
# Set your production webhook URL
export PROD_WEBHOOK_URL="https://api.airank.com/webhooks/batch"

# Update Pub/Sub subscription
gcloud pubsub subscriptions update airank-batch-webhook \
  --project=outrun-infrastructure-dev \
  --push-endpoint="${PROD_WEBHOOK_URL}/{workspaceId}"

# Verify
gcloud pubsub subscriptions describe airank-batch-webhook \
  --project=outrun-infrastructure-dev \
  --format="value(pushConfig.pushEndpoint)"
```

## Step 3: Commit and Push Changes

```bash
cd /Users/graysoncampbell/dev/airank-core

# Check what we're committing
git status

# Expected files:
# - graphql/mutations/helpers/batch/openai.js
# - graphql/mutations/helpers/batch/vertex.js
# - graphql/mutations/helpers/batch/index.js
# - graphql/index.js (webhook endpoint)
# - config/jobs/promptModelTester.js
# - config/jobs/processBatchResults.js
# - config/models.yaml
# - listener/
# - .env (DO NOT COMMIT - add to .gitignore)

# Add .env to .gitignore if not already
echo "gcp-batch-processor-key.json" >> .gitignore
echo ".env" >> .gitignore

# Commit changes
git add -A
git commit -m "Add batch processing for OpenAI, Claude, and Gemini

- Implement batch submission helpers for OpenAI and Vertex AI
- Consolidate Claude and Gemini to use Vertex AI batch prediction
- Add webhook endpoint for Pub/Sub notifications
- Create listener service for batch completion events
- Add processBatchResults job for sentiment analysis
- Update promptModelTester to route recurring jobs to batch APIs
- Add processByBatch flag to all models in models.yaml

Closes #XXX - Batch processing implementation
"

git push origin main
```

## Step 4: Set Production Environment Variables

**For DigitalOcean App Platform:**

Go to your app → Settings → Environment Variables:

```
GCP_PROJECT_ID=outrun-infrastructure-dev
GCP_REGION=us-central1
GCS_BATCH_BUCKET=outrun-infrastructure-dev-airank-batches
GOOGLE_APPLICATION_CREDENTIALS=/app/gcp-batch-processor-key.json
```

**Add Service Account Key as Secret File:**

1. Go to Settings → Environment → Add Secret File
2. Name: `GCP_SERVICE_ACCOUNT_KEY`
3. Mount path: `/app/gcp-batch-processor-key.json`
4. Content: Paste contents of `gcp-batch-processor-key.json`

**For Other Platforms (Railway, Heroku, etc.):**

Set environment variables through their dashboard or CLI:

```bash
# Railway
railway variables set GCP_PROJECT_ID=outrun-infrastructure-dev
railway variables set GCP_REGION=us-central1
railway variables set GCS_BATCH_BUCKET=outrun-infrastructure-dev-airank-batches

# Copy service account key
railway variables set GOOGLE_APPLICATION_CREDENTIALS="$(cat gcp-batch-processor-key.json | base64)"
```

## Step 5: Deploy Services

### GraphQL Service (with Webhook)

This is your main API server that already exists.

**Changes needed:**
- Webhook endpoint added to `graphql/index.js`
- No additional deployment needed (uses existing deployment)

**Verify webhook is accessible:**
```bash
curl -X POST https://api.airank.com/webhooks/batch/test \
  -H "Content-Type: application/json" \
  -d '{"test":"true"}'

# Should return 200 or 500 (not 404)
```

### Batcher Service

This should already be running.

**Changes needed:**
- Updated `promptModelTester.js` job
- Added `processBatchResults.js` job
- Auto-discovered, no manual registration needed

**Restart batcher:**
```bash
# If using PM2
pm2 restart airank-batcher

# If using DigitalOcean/Railway
# Redeploy the batcher component
```

### Listener Service (NEW)

This is a new service that needs to be deployed.

**Option A: Deploy as separate service on same platform**

DigitalOcean App Platform:
1. Go to your app → Create → Component
2. Type: Worker
3. Source: Same repo
4. Run Command: `cd listener && npm install && npm start`
5. Environment variables: Same as GraphQL service

**Option B: Run with PM2 alongside other services**

```bash
# SSH into your server
ssh your-server

cd /path/to/airank-core/listener
npm install

# Start with PM2
pm2 start index.js --name airank-listener
pm2 save
```

**Option C: Docker (if using containers)**

Create `listener/Dockerfile`:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY listener/package*.json ./
RUN npm ci --only=production
COPY listener/ ./
CMD ["node", "index.js"]
```

## Step 6: Verify Deployment

### Check Services are Running

```bash
# Check batcher
# Should see: promptModelTester, processBatchResults in job definitions

# Check listener
pm2 logs airank-listener
# Should see: "✅ AIRank Listener Service is running"
# Should see: "💓 Heartbeat: X active streams"

# Check GraphQL
curl https://api.airank.com/health
# Should return 200
```

### Check Environment Variables

```bash
# SSH into server or check platform dashboard
echo $GCP_PROJECT_ID
echo $GCS_BATCH_BUCKET
ls -la $GOOGLE_APPLICATION_CREDENTIALS
```

## Step 7: Production Testing

### Test 1: Immediate Job (No Batching)

1. Go to your production app: https://app.airank.com
2. Navigate to workspace
3. Click "Run Your First Report" for the FIRST time
4. Watch batcher logs

**Expected:**
```
🚀 Starting prompt-model testing job
📋 Job type: IMMEDIATE (will use direct API calls)
✓ Completed gpt-4o-mini for prompt: "..."
```

**Verify in MongoDB:**
```bash
mongosh "YOUR_PRODUCTION_MONGO_URI/workspace_XXX"
db.previousmodelresults.count()
# Should have results immediately
```

### Test 2: Recurring Job (WITH Batching!)

1. In the same workspace, the recurring job should now be scheduled
2. Manually trigger it OR wait for next scheduled run:

**Manual trigger:**
```bash
# Connect to production MongoDB
mongosh "YOUR_PRODUCTION_MONGO_URI/airank"

# Find the recurring job
db.jobs.findOne({
  name: 'promptModelTester',
  'data.workspaceId': 'YOUR_WORKSPACE_ID',
  repeatInterval: { $exists: true }
})

# Manually run it NOW
# (Or just wait for it to run on schedule)
```

**Watch batcher logs:**
```
📋 Job type: RECURRING (will use batch processing)
📦 Preparing openai batch with 5 models × 1 prompts = 5 requests
✓ Submitted openai batch: batch_abc123 (5 requests)
📦 Preparing vertex batch with 10 models × 1 prompts = 10 requests
✓ Submitted vertex batch: projects/.../jobs/456 (10 requests)
```

**Verify batches in MongoDB:**
```bash
mongosh "YOUR_PRODUCTION_MONGO_URI/workspace_XXX"

db.batches.find().pretty()

# Should see:
# {
#   provider: "openai",
#   status: "submitted",
#   batchId: "batch_abc123",
#   ...
# }
# {
#   provider: "vertex",
#   status: "submitted",
#   batchId: "projects/.../jobs/456",
#   ...
# }
```

### Test 3: Monitor Batch Status

**OpenAI batches:**
```bash
# Check OpenAI dashboard
# https://platform.openai.com/batches

# Or via API
curl https://api.openai.com/v1/batches/batch_abc123 \
  -H "Authorization: Bearer $OPENAI_API_KEY"

# Status progression:
# validating → in_progress → completed → finalizing → completed
# Usually takes: 1-12 hours
```

**Vertex AI batches:**
```bash
# Check GCP Console
# https://console.cloud.google.com/vertex-ai/batch-predictions

# Or via gcloud
gcloud ai batch-prediction-jobs list \
  --region=us-central1 \
  --project=outrun-infrastructure-dev

# Status progression:
# PENDING → RUNNING → SUCCEEDED
# Usually takes: hours to days
```

### Test 4: Webhook Receives Notification

**When batches complete:**

**For OpenAI:** You need to poll and check status (OpenAI doesn't send webhooks)
- Could set up a cron job to check every hour
- Or manually check after 12-24 hours

**For Vertex AI:** GCS Pub/Sub sends notification automatically
- When batch completes → Results uploaded to GCS
- GCS notification → Pub/Sub topic
- Pub/Sub → Your webhook

**Watch GraphQL logs:**
```
📨 Batch webhook received for workspace XXX
📦 GCS notification: {fileName: "batches/output/..."}
✓ Found batch: batch_abc123 (vertex)
✓ Downloaded 10 results for batch batch_abc123
✓ Deleted input file: batches/input/...
✓ Deleted output file: batches/output/...
✅ Batch results downloaded and stored
```

**Watch Listener logs:**
```
📨 Change detected: batches (update) in workspace XXX
✓ Scheduled job: processBatchResults (12345) for workspace XXX
```

**Watch Batcher logs (processBatchResults):**
```
🔄 Processing batch results for workspace XXX
📦 Batch: batch_abc123 (vertex) - 10 results
✓ Processed result 1/10
✓ Processed result 2/10
...
✓ Sentiment analysis completed
✅ Batch processing completed: 10 results saved
```

### Test 5: Verify Results

```bash
mongosh "YOUR_PRODUCTION_MONGO_URI/workspace_XXX"

# Check batch is marked as processed
db.batches.findOne({ batchId: "batch_abc123" })
# Should show:
# status: "received"
# isProcessed: true
# processingStats: { savedResults: 10, sentimentCompleted: 10 }

# Check results were saved
db.previousmodelresults.find({ batchId: "batch_abc123" }).count()
# Should equal requestCount

# Check a result has sentiment
db.previousmodelresults.findOne({ batchId: "batch_abc123" })
# Should have:
# sentimentAnalysis: {
#   brands: [...],
#   overallSentiment: "positive"
# }
```

## Monitoring in Production

### CloudWatch/Logs

Set up logging for:
1. **Batcher:** Job executions, batch submissions
2. **Listener:** Change stream events, job triggering
3. **GraphQL:** Webhook calls

### Alerts

Set up alerts for:
1. **Failed batches:** `db.batches.find({ status: 'failed' })`
2. **Stale batches:** Batches older than 48 hours still in 'submitted' status
3. **Listener downtime:** No heartbeat logs for > 5 minutes
4. **Webhook errors:** 500 errors on `/webhooks/batch/*`

### Cost Tracking

Track:
1. **GCS storage costs:** Should be minimal (lifecycle deletes after 2 days)
2. **Pub/Sub costs:** Very low (pennies)
3. **Vertex AI batch costs:** ~50% of real-time API costs
4. **OpenAI batch costs:** 50% of real-time API costs

Compare:
- Before: $X per 1000 requests
- After: $X/2 per 1000 requests
- Monthly savings: $Y

## Troubleshooting Production Issues

### Webhook Not Receiving Notifications

**Check Pub/Sub subscription:**
```bash
gcloud pubsub subscriptions describe airank-batch-webhook \
  --project=outrun-infrastructure-dev

# Verify pushEndpoint matches your production URL
```

**Test webhook manually:**
```bash
# Publish test message
gcloud pubsub topics publish airank-batch-completions \
  --project=outrun-infrastructure-dev \
  --message='{"name":"test","bucket":"test"}'

# Check GraphQL logs for webhook call
```

### Listener Not Detecting Batches

**Check listener is running:**
```bash
pm2 list | grep listener
# Or check platform dashboard
```

**Check MongoDB change streams are enabled:**
```bash
mongosh "YOUR_PRODUCTION_MONGO_URI/admin"
rs.status()
# Must be running as replica set
```

**Check listener logs:**
```bash
pm2 logs airank-listener
# Should see: "🎧 Starting listener: workspaceId-batches"
```

### Batches Not Processing

**Check processBatchResults job exists:**
```bash
# In batcher logs
# Should see: "Found jobs: promptModelTester, processBatchResults, ..."
```

**Check batch document:**
```bash
db.batches.findOne({ status: 'received', isProcessed: false })
# Should trigger listener
```

**Manually trigger job:**
```bash
mongosh "YOUR_PRODUCTION_MONGO_URI/airank"
db.jobs.insertOne({
  name: 'processBatchResults',
  data: {
    workspaceId: 'XXX',
    documentId: 'BATCH_DOC_ID'
  },
  nextRunAt: new Date()
})
```

## Rollback Plan

If something goes wrong:

1. **Revert code changes:**
```bash
git revert HEAD
git push origin main
```

2. **Jobs will continue to work:**
- Immediate jobs still work (direct API calls)
- Recurring jobs will fail batch submission but can be fixed later

3. **No data loss:**
- Batches are stored in MongoDB
- Can be reprocessed later
- Direct API results still saved

## Next Steps After Successful Testing

1. ✅ Monitor first batch completion (24-48 hours)
2. ✅ Verify cost savings in billing
3. ✅ Set up alerts and monitoring
4. ✅ Document any production-specific configurations
5. ✅ Create runbook for common issues

## Quick Reference

**Pub/Sub Subscription:**
```bash
gcloud pubsub subscriptions describe airank-batch-webhook --project=outrun-infrastructure-dev
```

**Check Batches:**
```bash
db.batches.find({ status: { $in: ['submitted', 'processing'] } })
```

**Restart Services:**
```bash
pm2 restart airank-batcher
pm2 restart airank-listener
```

**View Logs:**
```bash
pm2 logs airank-batcher
pm2 logs airank-listener
tail -f /var/log/graphql.log
```

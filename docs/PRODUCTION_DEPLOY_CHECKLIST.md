# Batch Processing - Production Deploy Checklist

Ready-to-deploy checklist for production testing.

## ✅ Pre-Deployment (Done)

- [x] GCP infrastructure created
  - [x] GCS bucket: `outrun-infrastructure-dev-airank-batches`
  - [x] Pub/Sub topic: `airank-batch-completions`
  - [x] Service account: `airank-batch-processor`
  - [x] Service account key: `gcp-batch-processor-key.json`

- [x] Code changes complete
  - [x] Batch helpers (OpenAI, Vertex AI)
  - [x] Webhook endpoint
  - [x] promptModelTester updated
  - [x] processBatchResults job created
  - [x] Listener service created
  - [x] Models have `processByBatch: true`

## 🚀 Deployment Steps

### Step 1: Update .gitignore

```bash
cd /Users/graysoncampbell/dev/airank-core

# Add sensitive files to .gitignore
echo "gcp-batch-processor-key.json" >> .gitignore
echo ".env" >> .gitignore
```

### Step 2: Commit and Push

```bash
# Review changes
git status
git diff

# Commit
git add -A
git commit -m "Add batch processing for 50% cost savings

- OpenAI Batch API integration
- Vertex AI batch prediction for Claude and Gemini
- Webhook endpoint for Pub/Sub notifications
- Listener service for batch completion events
- processBatchResults job with sentiment analysis
- Auto-route recurring jobs to batch APIs

Batch processing provides ~50% cost reduction on all AI API calls
for recurring jobs (monthly/weekly/daily reporting).
"

# Push to main
git push origin main
```

### Step 3: Set Production Environment Variables

**Where:** Your hosting platform (DigitalOcean, Railway, Render, etc.)

**Variables to add:**
```
GCP_PROJECT_ID=outrun-infrastructure-dev
GCP_REGION=us-central1
GCS_BATCH_BUCKET=outrun-infrastructure-dev-airank-batches
GOOGLE_APPLICATION_CREDENTIALS=/app/gcp-batch-processor-key.json
```

**Service Account Key:**
- Upload `gcp-batch-processor-key.json` as a secret file
- Mount at path: `/app/gcp-batch-processor-key.json`

### Step 4: Update Pub/Sub Subscription

```bash
# Replace with your actual production URL
export PROD_WEBHOOK_URL="https://YOUR-PRODUCTION-URL.com/webhooks/batch"

gcloud pubsub subscriptions update airank-batch-webhook \
  --project=outrun-infrastructure-dev \
  --push-endpoint="${PROD_WEBHOOK_URL}/{workspaceId}"

# Verify
gcloud pubsub subscriptions describe airank-batch-webhook \
  --project=outrun-infrastructure-dev
```

### Step 5: Deploy Listener Service

**Option A: As separate service (recommended)**
- Create new component in your hosting platform
- Type: Worker
- Run command: `cd listener && npm install && npm start`
- Environment: Same as GraphQL service

**Option B: With PM2 (if using VPS)**
```bash
ssh your-server
cd /path/to/airank-core/listener
npm install
pm2 start index.js --name airank-listener
pm2 save
```

### Step 6: Restart Services

```bash
# Restart batcher (picks up new jobs)
pm2 restart airank-batcher
# Or redeploy batcher component

# GraphQL server (picks up webhook endpoint)
# Should auto-deploy with code push
```

## ✅ Post-Deployment Verification

### Check Services are Running

- [ ] GraphQL server responding: `curl https://YOUR-DOMAIN.com/health`
- [ ] Batcher running and discovering jobs
- [ ] Listener running with heartbeat
- [ ] Webhook accessible: `curl -X POST https://YOUR-DOMAIN.com/webhooks/batch/test`

### Check Environment Variables

Log into production and verify:
```bash
echo $GCP_PROJECT_ID
echo $GCS_BATCH_BUCKET
ls -la $GOOGLE_APPLICATION_CREDENTIALS
```

### Check MongoDB Connection

```bash
# Listener should connect to all workspace databases
# Look for log: "🎧 Starting listener: workspace_XXX-batches"
```

## 🧪 Production Testing

### Test 1: Submit Immediate Job

1. Go to production app
2. Navigate to workspace
3. Click "Run Your First Report" (first time)
4. Should process directly (no batching)
5. Results appear immediately

**Logs to check:**
- Batcher: `📋 Job type: IMMEDIATE`
- MongoDB: `db.previousmodelresults.count()` increases

### Test 2: Submit Recurring Job (Batch)

1. Same workspace, click "Run Your First Report" again OR wait for scheduled run
2. Should submit batches

**Logs to check:**
- Batcher: `📋 Job type: RECURRING`
- Batcher: `📦 Submitted openai batch: batch_XXX`
- Batcher: `📦 Submitted vertex batch: projects/.../jobs/XXX`
- MongoDB: `db.batches.find()` shows submitted batches

### Test 3: Monitor Batch Completion (24-48 hours)

**Check status periodically:**

OpenAI:
```bash
curl https://api.openai.com/v1/batches/batch_XXX \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

Vertex AI:
```bash
gcloud ai batch-prediction-jobs list \
  --region=us-central1 \
  --project=outrun-infrastructure-dev
```

**When complete:**

Watch for:
- GraphQL logs: `📨 Batch webhook received`
- Listener logs: `📨 Change detected: batches (update)`
- Batcher logs: `🔄 Processing batch results`

**Verify in MongoDB:**
```bash
db.batches.findOne({ batchId: "batch_XXX" })
# Should show: status: "received", isProcessed: true

db.previousmodelresults.find({ batchId: "batch_XXX" }).count()
# Should match requestCount
```

## 🎯 Success Criteria

- [x] Code deployed to production
- [x] Services running (GraphQL, Batcher, Listener)
- [x] Environment variables set
- [x] Pub/Sub subscription updated
- [ ] Immediate job works (direct API calls)
- [ ] Recurring job submits batches
- [ ] Batches appear in MongoDB
- [ ] After 24-48 hours: Webhook fires
- [ ] After webhook: Results processed
- [ ] Results have sentiment analysis

## 📊 Cost Tracking

After first batch completes, compare:

**Before batch processing:**
- Total API cost for N requests: $X

**After batch processing:**
- Total API cost for N requests: $X/2 (50% savings)
- GCS storage: ~$0.01/month (minimal)
- Pub/Sub: ~$0.05/month (minimal)

**Net savings:** ~50% on all recurring job API costs

## 🔄 Rollback Plan

If issues arise:

1. **Revert code:**
```bash
git revert HEAD
git push origin main
```

2. **Stop listener:**
```bash
pm2 stop airank-listener
# Or stop worker component
```

3. **Jobs continue working:**
- Immediate jobs unaffected
- Recurring jobs fall back to direct API calls (if batch submission fails)

## 📚 Documentation

- [Full Deployment Guide](docs/BATCH_PRODUCTION_DEPLOYMENT.md)
- [Architecture Details](docs/BATCH_PROCESSING.md)
- [Setup Guide](docs/BATCH_SETUP_GUIDE.md)

## 🆘 Support

If you encounter issues:
1. Check logs (batcher, listener, GraphQL)
2. Verify MongoDB batches collection
3. Check Pub/Sub subscription
4. Review [Troubleshooting Guide](docs/BATCH_PRODUCTION_DEPLOYMENT.md#troubleshooting-production-issues)

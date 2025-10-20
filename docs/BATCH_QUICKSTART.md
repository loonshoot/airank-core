# Batch Processing Quick Start

## 🚀 Quick Setup (5 minutes)

### 1. Google Cloud Setup
```bash
cd /Users/graysoncampbell/dev/airank-core
./scripts/setup-gcp-batch-infrastructure.sh
```
✅ **DONE** - Created: GCS bucket, Pub/Sub topic, service account

### 2. Update .env
Add to `/Users/graysoncampbell/dev/airank-core/.env`:
```env
GCP_PROJECT_ID=outrun-infrastructure-dev
GCP_REGION=us-central1
GCS_BATCH_BUCKET=outrun-infrastructure-dev-airank-batches
GOOGLE_APPLICATION_CREDENTIALS=./gcp-batch-processor-key.json
```
✅ **DONE** - Variables added

### 3. Update Pub/Sub with Production URL
⚠️ **IMPORTANT:** Batches take 24+ hours. Must use production URL, not ngrok!

```bash
# Set your production URL
export PROD_URL="https://api.airank.com/webhooks/batch"

# Update Pub/Sub subscription
gcloud pubsub subscriptions update airank-batch-webhook \
  --project=outrun-infrastructure-dev \
  --push-endpoint="${PROD_URL}/{workspaceId}"
```

### 4. Deploy to Production

See: [BATCH_PRODUCTION_DEPLOYMENT.md](docs/BATCH_PRODUCTION_DEPLOYMENT.md) for full deployment guide

**Quick version:**
1. Commit changes: `git add -A && git commit -m "Add batch processing"`
2. Push: `git push origin main`
3. Set production environment variables (GCP_PROJECT_ID, GCS_BATCH_BUCKET, service account key)
4. Deploy listener service
5. Restart batcher service

## ✅ Quick Test

### Test Immediate Job (No Batching)
```bash
cd batcher
# Edit trigger-job.js with your workspace ID
node trigger-job.js
```

**Expected:** Direct API calls, results immediately

### Test Recurring Job (WITH Batching)
In the UI:
1. Go to your workspace
2. Click "Run Your First Report"
3. Check batcher logs for "📦 Starting batch processing..."

**Expected:** Batch submission, results in hours/days

### Check Results
```bash
mongosh "mongodb://localhost:27017/workspace_YOUR_ID?authSource=admin"

# Check batches
db.batches.find().pretty()

# Check status
db.batches.findOne({ provider: "vertex" })
```

## 📊 What to Monitor

1. **Batcher logs** - Look for "📦 Submitted batch"
2. **Listener logs** - Look for "💓 Heartbeat" every 30s
3. **GraphQL logs** - Look for "📨 Batch webhook received"
4. **MongoDB batches collection** - Should see documents with status "submitted"

## 🔥 Common Issues

| Issue | Quick Fix |
|-------|-----------|
| "GCS_BATCH_BUCKET is not defined" | Add to .env file |
| "Service account key not found" | Run setup script, check for .json file |
| Webhook not called | Check ngrok is running, update Pub/Sub endpoint |
| Listener not detecting batches | Check listener is running, check MongoDB change streams |
| No batches submitted | Check job has repeatInterval set (recurring job) |

## 📚 Full Documentation

- **Complete Setup Guide:** [docs/BATCH_SETUP_GUIDE.md](docs/BATCH_SETUP_GUIDE.md)
- **Architecture Details:** [docs/BATCH_PROCESSING.md](docs/BATCH_PROCESSING.md)
- **Refactoring Notes:** [docs/BATCH_REFACTORING_SUMMARY.md](docs/BATCH_REFACTORING_SUMMARY.md)

## 🎯 Next Steps

Once basic testing works:
1. Test with real prompts and multiple models
2. Monitor first batch completion (OpenAI: hours, Vertex: hours-days)
3. Verify webhook receives notification
4. Check processBatchResults job runs automatically
5. Confirm results appear in previousmodelresults collection
6. Deploy to production with PM2

## 💡 Pro Tips

- **Local development:** Always use ngrok for webhook testing
- **Cost saving:** Batches only run for recurring jobs (monthly/weekly/daily)
- **Immediate jobs:** First job runs immediately (no batching) for instant feedback
- **Model support:** All OpenAI, Claude, and Gemini models support batching
- **Savings:** ~50% cost reduction on all batch-processed requests

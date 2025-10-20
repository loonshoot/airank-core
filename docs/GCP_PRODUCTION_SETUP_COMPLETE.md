# ✅ AIRank Production GCP Setup Complete!

Complete production-ready GCP infrastructure for batch processing.

## What Was Created

### GCP Project
- **Project ID:** `airank-production`
- **Project Number:** `791169578153`
- **Billing:** Linked to account `018750-D44015-0F48F9`

### Enabled APIs
- ✅ Cloud Storage API (`storage.googleapis.com`)
- ✅ Pub/Sub API (`pubsub.googleapis.com`)
- ✅ Vertex AI API (`aiplatform.googleapis.com`)
- ✅ IAM API (`iam.googleapis.com`)

### Storage Infrastructure
- **GCS Bucket:** `gs://airank-production-batches`
- **Region:** `us-central1`
- **Lifecycle Policy:** Delete files after 2 days (cost optimization)
- **Purpose:** Store batch input/output files temporarily

### Pub/Sub Infrastructure
- **Topic:** `projects/airank-production/topics/airank-batch-completions`
- **Subscription:** `projects/airank-production/subscriptions/airank-batch-webhook`
- **Type:** Push subscription
- **Current Endpoint:** `https://your-domain.com/webhooks/batch` (NEEDS UPDATE!)

### Service Account
- **Email:** `airank-batch-processor@airank-production.iam.gserviceaccount.com`
- **Permissions:**
  - `roles/storage.objectAdmin` - Full access to GCS bucket
  - `roles/aiplatform.user` - Create and manage Vertex AI batch jobs
  - `roles/pubsub.publisher` - Publish to Pub/Sub topics

### Service Account Key
- **Location:** `/Users/graysoncampbell/dev/airank-core/gcp-batch-processor-key.json`
- **Type:** JSON key file
- **⚠️ SECURITY:** Added to .gitignore, DO NOT COMMIT

## Environment Configuration

Updated `.env` file with:
```env
GCP_PROJECT_ID=airank-production
GCP_REGION=us-central1
GCS_BATCH_BUCKET=airank-production-batches
GOOGLE_APPLICATION_CREDENTIALS=./gcp-batch-processor-key.json
```

## ⚠️ NEXT STEPS REQUIRED

### 1. Update Pub/Sub Subscription with Production URL

**CRITICAL:** The webhook URL is currently set to placeholder!

```bash
# Replace with your ACTUAL production URL
export PROD_WEBHOOK_URL="https://api.airank.com/webhooks/batch"
# OR
export PROD_WEBHOOK_URL="https://airank-api.ondigitalocean.app/webhooks/batch"
# OR whatever your production API domain is

# Update subscription
gcloud pubsub subscriptions update airank-batch-webhook \
  --project=airank-production \
  --push-endpoint="${PROD_WEBHOOK_URL}/{workspaceId}"

# Verify
gcloud pubsub subscriptions describe airank-batch-webhook \
  --project=airank-production \
  --format="value(pushConfig.pushEndpoint)"
```

### 2. Deploy Code to Production

Follow: [PRODUCTION_DEPLOY_CHECKLIST.md](PRODUCTION_DEPLOY_CHECKLIST.md)

**Quick checklist:**
- [ ] Add `gcp-batch-processor-key.json` to .gitignore
- [ ] Commit code changes
- [ ] Push to git
- [ ] Set production environment variables
- [ ] Upload service account key as secret
- [ ] Deploy listener service
- [ ] Restart batcher service
- [ ] Update Pub/Sub webhook URL

### 3. Test in Production

1. **Immediate job:** Click "Run Your First Report" (first time)
   - Should process directly
   - Results appear immediately

2. **Recurring job:** Click "Run Your First Report" again OR wait for schedule
   - Should submit batches
   - Check MongoDB for batch documents

3. **Monitor completion:** Check after 24-48 hours
   - Webhook should fire
   - Results should be processed
   - Sentiment analysis complete

## Cost Estimates

### Monthly Costs (Estimated)

**GCS Storage:**
- Input files: ~$0.01/GB/month (deleted after processing)
- Output files: ~$0.01/GB/month (deleted after 2 days)
- **Est:** $0.10-$1.00/month depending on volume

**Pub/Sub:**
- Message delivery: $0.40 per million messages
- **Est:** $0.05-$0.50/month

**Vertex AI Batch Prediction:**
- 50% cheaper than real-time API
- **Savings:** ~50% of your Claude/Gemini API costs

**OpenAI Batch API:**
- 50% cheaper than real-time API
- **Savings:** ~50% of your OpenAI API costs

**Total Infrastructure:** ~$0.15-$1.50/month
**Total Savings:** 50% on all recurring job API costs

### Example Savings

If you're currently spending:
- $100/month on OpenAI API calls
- $100/month on Claude/Gemini API calls

With batch processing for recurring jobs (assuming 50% of calls):
- OpenAI: $75/month ($25 saved)
- Claude/Gemini: $75/month ($25 saved)
- Infrastructure: $1/month
- **Net savings: $49/month** or **25% overall**

## Security Notes

### Service Account Key

The service account key (`gcp-batch-processor-key.json`) provides access to:
- GCS bucket (read/write/delete)
- Vertex AI (create batch jobs)
- Pub/Sub (publish messages)

**Security best practices:**
1. ✅ Added to .gitignore
2. ✅ Should be uploaded as secret in production (not checked into git)
3. ✅ Rotate every 90 days
4. ✅ Monitor usage in GCP IAM

### Rotating the Key

```bash
# Create new key
gcloud iam service-accounts keys create new-key.json \
  --iam-account=airank-batch-processor@airank-production.iam.gserviceaccount.com \
  --project=airank-production

# Update production environment variable
# Deploy with new key

# Delete old key
gcloud iam service-accounts keys delete OLD_KEY_ID \
  --iam-account=airank-batch-processor@airank-production.iam.gserviceaccount.com \
  --project=airank-production
```

## Monitoring & Debugging

### View GCS Bucket Contents

```bash
gsutil ls -r gs://airank-production-batches/
```

### Check Pub/Sub Messages

```bash
# Pull messages (for debugging)
gcloud pubsub subscriptions pull airank-batch-webhook \
  --project=airank-production \
  --limit=5
```

### View Vertex AI Batch Jobs

```bash
gcloud ai batch-prediction-jobs list \
  --region=us-central1 \
  --project=airank-production
```

### Check Service Account Permissions

```bash
gcloud projects get-iam-policy airank-production \
  --flatten="bindings[].members" \
  --filter="bindings.members:airank-batch-processor@airank-production.iam.gserviceaccount.com"
```

## Cleanup / Rollback

If you need to remove everything:

```bash
# Delete Pub/Sub subscription
gcloud pubsub subscriptions delete airank-batch-webhook --project=airank-production

# Delete Pub/Sub topic
gcloud pubsub topics delete airank-batch-completions --project=airank-production

# Delete GCS bucket
gsutil rm -r gs://airank-production-batches

# Delete service account
gcloud iam service-accounts delete \
  airank-batch-processor@airank-production.iam.gserviceaccount.com \
  --project=airank-production

# Optionally delete project
gcloud projects delete airank-production
```

## Documentation

- [Production Deploy Checklist](PRODUCTION_DEPLOY_CHECKLIST.md)
- [Production Deployment Guide](docs/BATCH_PRODUCTION_DEPLOYMENT.md)
- [Architecture Documentation](docs/BATCH_PROCESSING.md)
- [Quick Start Guide](BATCH_QUICKSTART.md)

## Support & Troubleshooting

If issues arise:
1. Check GCP Console: https://console.cloud.google.com/home/dashboard?project=airank-production
2. Review logs in production
3. Verify webhook URL is correct
4. Check MongoDB batches collection
5. See troubleshooting guide in [BATCH_PRODUCTION_DEPLOYMENT.md](docs/BATCH_PRODUCTION_DEPLOYMENT.md)

---

**Status:** ✅ GCP infrastructure ready for production deployment
**Next Step:** Update Pub/Sub webhook URL with your production domain
**Then:** Follow [PRODUCTION_DEPLOY_CHECKLIST.md](PRODUCTION_DEPLOY_CHECKLIST.md)

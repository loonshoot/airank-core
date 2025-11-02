# Vertex AI Infrastructure Setup Instructions

## Prerequisites

You need **admin access** to the GCP project to create these resources. The service account (`airank-batch-processor`) doesn't have permission to create buckets or configure Pub/Sub.

## Step 1: Switch to Admin Account

```bash
# Login with your admin account
gcloud auth login

# Set the project
gcloud config set project airank-production

# Verify you're using the right account (should be your @gmail.com or workspace account)
gcloud config get-value account
```

## Step 2: Run the Setup Script

```bash
cd /Users/graysoncampbell/dev/airank-core
./setup-vertex-infrastructure.sh
```

The script will:
1. ✅ Create GCS bucket `gs://airank-production-batches`
2. ✅ Set lifecycle policy (auto-delete files after 7 days)
3. ✅ Grant service account storage permissions
4. ✅ Create Pub/Sub topic `vertex-batch-completion`
5. ✅ Create push subscription pointing to webhook
6. ✅ Configure GCS notifications for `batches/output/` folder
7. ✅ Test webhook endpoint

## Step 3: Switch Back to Service Account (for application use)

After setup is complete, switch back to the service account for normal operations:

```bash
gcloud auth activate-service-account \
  airank-batch-processor@airank-production.iam.gserviceaccount.com \
  --key-file=./gcp-batch-processor-key.json

gcloud config set project airank-production
```

## Alternative: Manual Setup

If you prefer to run commands manually, see [VERTEX_BATCH_SETUP.md](VERTEX_BATCH_SETUP.md) for individual commands.

## Verification

After setup, verify everything is working:

```bash
# Check bucket exists
gsutil ls gs://airank-production-batches

# Check Pub/Sub topic
gcloud pubsub topics list | grep vertex-batch-completion

# Check subscription
gcloud pubsub subscriptions list | grep vertex-batch-completion-push

# Test webhook
curl https://stream.getairank.com/health
```

## Troubleshooting

### Permission Denied Errors

If you see "403 Permission Denied", ensure you're using an admin account:
- Owner role
- Editor role
- Or custom role with: `storage.buckets.create`, `pubsub.topics.create`, `pubsub.subscriptions.create`

### Service Account vs Admin Account

- **Admin account**: For infrastructure setup (buckets, Pub/Sub)
- **Service account**: For application runtime (submit batches, download results)

Never use the service account for infrastructure setup!

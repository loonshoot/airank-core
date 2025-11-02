#!/bin/bash

# Setup Vertex AI Batch Infrastructure
# Run this script with your admin GCP account (not the service account)

set -e

PROJECT_ID="airank-production"
REGION="us-east5"
BUCKET_NAME="airank-production-batches"
TOPIC_NAME="vertex-batch-completion"
SUBSCRIPTION_NAME="vertex-batch-completion-push"
WEBHOOK_URL="https://stream.getairank.com/webhooks/batch"
SERVICE_ACCOUNT="airank-batch-processor@airank-production.iam.gserviceaccount.com"

echo "🚀 Setting up Vertex AI Batch Infrastructure"
echo "=============================================="
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Bucket: gs://$BUCKET_NAME"
echo ""

# Check current account
CURRENT_ACCOUNT=$(gcloud config get-value account 2>/dev/null)
echo "Current GCP account: $CURRENT_ACCOUNT"
echo ""

if [[ "$CURRENT_ACCOUNT" == *"@"*".iam.gserviceaccount.com" ]]; then
    echo "⚠️  WARNING: You're using a service account!"
    echo "You need to use an admin account with Owner or Editor role."
    echo ""
    echo "To switch accounts, run:"
    echo "  gcloud auth login"
    echo "  gcloud config set project $PROJECT_ID"
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Step 1: Create GCS Bucket
echo "1️⃣ Creating GCS bucket..."
if gsutil ls gs://$BUCKET_NAME 2>/dev/null; then
    echo "✅ Bucket already exists"
else
    gsutil mb -p $PROJECT_ID -l $REGION gs://$BUCKET_NAME
    echo "✅ Created bucket: gs://$BUCKET_NAME"
fi
echo ""

# Step 2: Set bucket lifecycle (auto-delete after 7 days)
echo "2️⃣ Configuring bucket lifecycle..."
cat > /tmp/lifecycle.json <<EOF
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
gsutil lifecycle set /tmp/lifecycle.json gs://$BUCKET_NAME
echo "✅ Lifecycle policy set (auto-delete after 7 days)"
rm /tmp/lifecycle.json
echo ""

# Step 3: Grant service account permissions
echo "3️⃣ Granting service account permissions..."
echo "Granting Storage Object Admin..."
gsutil iam ch serviceAccount:$SERVICE_ACCOUNT:objectAdmin gs://$BUCKET_NAME 2>/dev/null || \
    gcloud projects add-iam-policy-binding $PROJECT_ID \
        --member="serviceAccount:$SERVICE_ACCOUNT" \
        --role="roles/storage.objectAdmin" \
        --condition=None
echo "✅ Storage permissions granted"
echo ""

# Step 4: Create Pub/Sub topic
echo "4️⃣ Creating Pub/Sub topic..."
if gcloud pubsub topics describe $TOPIC_NAME --project=$PROJECT_ID &>/dev/null; then
    echo "✅ Topic already exists"
else
    gcloud pubsub topics create $TOPIC_NAME --project=$PROJECT_ID
    echo "✅ Created topic: $TOPIC_NAME"
fi
echo ""

# Step 5: Create push subscription
echo "5️⃣ Creating Pub/Sub push subscription..."
if gcloud pubsub subscriptions describe $SUBSCRIPTION_NAME --project=$PROJECT_ID &>/dev/null; then
    echo "✅ Subscription already exists"
else
    gcloud pubsub subscriptions create $SUBSCRIPTION_NAME \
        --topic=$TOPIC_NAME \
        --push-endpoint=$WEBHOOK_URL \
        --project=$PROJECT_ID \
        --ack-deadline=60
    echo "✅ Created subscription: $SUBSCRIPTION_NAME"
    echo "   Pushing to: $WEBHOOK_URL"
fi
echo ""

# Step 6: Configure GCS notifications
echo "6️⃣ Configuring GCS notifications..."
# Check if notification already exists
EXISTING_NOTIFICATIONS=$(gsutil notification list gs://$BUCKET_NAME 2>/dev/null | grep -c "topic: //pubsub.googleapis.com/projects/$PROJECT_ID/topics/$TOPIC_NAME" || true)

if [ "$EXISTING_NOTIFICATIONS" -gt 0 ]; then
    echo "✅ GCS notification already configured"
else
    gsutil notification create \
        -t $TOPIC_NAME \
        -f json \
        -e OBJECT_FINALIZE \
        -p batches/output/ \
        gs://$BUCKET_NAME
    echo "✅ GCS notifications configured"
    echo "   Watching: gs://$BUCKET_NAME/batches/output/"
fi
echo ""

# Step 7: Test webhook endpoint
echo "7️⃣ Testing webhook endpoint..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" $WEBHOOK_URL/health 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Webhook endpoint is accessible"
else
    echo "⚠️  Warning: Webhook endpoint returned HTTP $HTTP_CODE"
    echo "   URL: $WEBHOOK_URL"
fi
echo ""

echo "=============================================="
echo "✅ Setup Complete!"
echo ""
echo "Summary:"
echo "  Bucket: gs://$BUCKET_NAME"
echo "  Topic: $TOPIC_NAME"
echo "  Subscription: $SUBSCRIPTION_NAME"
echo "  Webhook: $WEBHOOK_URL"
echo ""
echo "Test the flow:"
echo "  1. Enable a Vertex AI model (Gemini/Claude) in your workspace"
echo "  2. Run the batch job (will submit to Vertex AI)"
echo "  3. Wait for Vertex AI to complete (~minutes to hours)"
echo "  4. GCS will notify Pub/Sub → webhook → listener → batcher"
echo "  5. Check logs for processing"
echo ""
echo "Monitor notifications:"
echo "  gcloud pubsub subscriptions pull $SUBSCRIPTION_NAME --limit=10"
echo ""
echo "View bucket contents:"
echo "  gsutil ls -r gs://$BUCKET_NAME"
echo ""

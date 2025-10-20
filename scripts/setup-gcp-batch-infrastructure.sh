#!/bin/bash

# Setup GCP infrastructure for batch processing
# This script creates:
# 1. GCS bucket for batch files
# 2. Pub/Sub topic for batch completion notifications
# 3. Pub/Sub subscription for webhook
# 4. Service account with appropriate permissions

set -e

# Load environment variables
if [ -f .env ]; then
  set -a
  source <(cat .env | grep -v '^#' | sed 's/ *= */=/g')
  set +a
fi

# Configuration
PROJECT_ID="${GCP_PROJECT_ID}"
REGION="${GCP_REGION:-us-central1}"
BUCKET_NAME="${GCS_BATCH_BUCKET:-${PROJECT_ID}-airank-batches}"
TOPIC_NAME="${PUBSUB_BATCH_TOPIC:-airank-batch-completions}"
SUBSCRIPTION_NAME="${PUBSUB_BATCH_SUBSCRIPTION:-airank-batch-webhook}"
WEBHOOK_URL="${BATCH_WEBHOOK_URL:-https://your-domain.com/webhooks/batch}"

echo "Setting up GCP infrastructure for AIRank batch processing..."
echo "Project ID: ${PROJECT_ID}"
echo "Region: ${REGION}"
echo "Bucket: ${BUCKET_NAME}"
echo "Topic: ${TOPIC_NAME}"
echo ""

# Verify gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "Error: gcloud CLI is not installed"
    echo "Install from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Set project
echo "Setting project to ${PROJECT_ID}..."
gcloud config set project ${PROJECT_ID}

# Enable required APIs
echo "Enabling required APIs..."
gcloud services enable storage.googleapis.com
gcloud services enable pubsub.googleapis.com
gcloud services enable aiplatform.googleapis.com

# Create GCS bucket
echo "Creating GCS bucket: ${BUCKET_NAME}..."
if gsutil ls -b gs://${BUCKET_NAME} 2>/dev/null; then
  echo "Bucket already exists"
else
  gsutil mb -p ${PROJECT_ID} -l ${REGION} gs://${BUCKET_NAME}
  echo "Bucket created successfully"
fi

# Set bucket lifecycle to delete files after 2 days (cost optimization)
echo "Setting bucket lifecycle policy..."
cat > /tmp/lifecycle.json << EOF
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "Delete"},
        "condition": {"age": 2}
      }
    ]
  }
}
EOF
gsutil lifecycle set /tmp/lifecycle.json gs://${BUCKET_NAME}
rm /tmp/lifecycle.json

# Create Pub/Sub topic
echo "Creating Pub/Sub topic: ${TOPIC_NAME}..."
if gcloud pubsub topics describe ${TOPIC_NAME} 2>/dev/null; then
  echo "Topic already exists"
else
  gcloud pubsub topics create ${TOPIC_NAME}
  echo "Topic created successfully"
fi

# Create notification from GCS bucket to Pub/Sub
echo "Setting up GCS notification to Pub/Sub..."
gsutil notification create -t ${TOPIC_NAME} -f json -e OBJECT_FINALIZE gs://${BUCKET_NAME}

# Create Pub/Sub subscription (push to webhook)
echo "Creating Pub/Sub push subscription: ${SUBSCRIPTION_NAME}..."
if gcloud pubsub subscriptions describe ${SUBSCRIPTION_NAME} 2>/dev/null; then
  echo "Subscription already exists"
  # Update webhook URL
  gcloud pubsub subscriptions update ${SUBSCRIPTION_NAME} \
    --push-endpoint="${WEBHOOK_URL}"
else
  gcloud pubsub subscriptions create ${SUBSCRIPTION_NAME} \
    --topic=${TOPIC_NAME} \
    --push-endpoint="${WEBHOOK_URL}" \
    --ack-deadline=600
  echo "Subscription created successfully"
fi

# Create service account for batch processing
SERVICE_ACCOUNT_NAME="airank-batch-processor"
SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "Creating service account: ${SERVICE_ACCOUNT_NAME}..."
if gcloud iam service-accounts describe ${SERVICE_ACCOUNT_EMAIL} 2>/dev/null; then
  echo "Service account already exists"
else
  gcloud iam service-accounts create ${SERVICE_ACCOUNT_NAME} \
    --display-name="AIRank Batch Processor" \
    --description="Service account for AIRank batch processing operations"
  echo "Service account created successfully"
fi

# Grant permissions to service account
echo "Granting permissions to service account..."
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/storage.objectAdmin" \
  --condition=None

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/aiplatform.user" \
  --condition=None

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/pubsub.publisher" \
  --condition=None

# Create and download service account key
KEY_FILE="./gcp-batch-processor-key.json"
echo "Creating service account key..."
if [ -f ${KEY_FILE} ]; then
  echo "Key file already exists: ${KEY_FILE}"
  read -p "Overwrite? (y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    gcloud iam service-accounts keys create ${KEY_FILE} \
      --iam-account=${SERVICE_ACCOUNT_EMAIL}
    echo "New key created: ${KEY_FILE}"
  fi
else
  gcloud iam service-accounts keys create ${KEY_FILE} \
    --iam-account=${SERVICE_ACCOUNT_EMAIL}
  echo "Key created: ${KEY_FILE}"
fi

echo ""
echo "✓ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Add to .env file:"
echo "   GCP_PROJECT_ID=${PROJECT_ID}"
echo "   GCS_BATCH_BUCKET=${BUCKET_NAME}"
echo "   PUBSUB_BATCH_TOPIC=${TOPIC_NAME}"
echo "   GOOGLE_APPLICATION_CREDENTIALS=./gcp-batch-processor-key.json"
echo ""
echo "2. Update BATCH_WEBHOOK_URL in this script to your production webhook URL"
echo ""
echo "3. Keep ${KEY_FILE} secure and add to .gitignore"

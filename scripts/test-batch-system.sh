#!/bin/bash

# AIRank Batch Processing Test Script
# This script helps you test the batch processing system step by step

echo "🧪 AIRank Batch Processing Test Script"
echo "========================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${RED}❌ .env file not found!${NC}"
    echo "Please create .env file first"
    exit 1
fi

# Source .env (handle spaces around =)
while IFS= read -r line; do
  # Skip comments and empty lines
  [[ $line =~ ^#.*$ ]] && continue
  [[ -z $line ]] && continue
  # Extract key=value, handling spaces
  if [[ $line =~ ^([A-Z_a-z0-9]+)[[:space:]]*=[[:space:]]*(.+)$ ]]; then
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    # Remove leading/trailing spaces from value
    value=$(echo "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    eval "export $key='$value'"
  fi
done < .env

echo "📋 Running pre-flight checks..."
echo ""

# Check 1: GCP Project ID
if [ -z "$GCP_PROJECT_ID" ]; then
    echo -e "${RED}❌ GCP_PROJECT_ID not set in .env${NC}"
    exit 1
else
    echo -e "${GREEN}✅ GCP_PROJECT_ID: $GCP_PROJECT_ID${NC}"
fi

# Check 2: GCS Bucket
if [ -z "$GCS_BATCH_BUCKET" ]; then
    echo -e "${RED}❌ GCS_BATCH_BUCKET not set in .env${NC}"
    exit 1
else
    echo -e "${GREEN}✅ GCS_BATCH_BUCKET: $GCS_BATCH_BUCKET${NC}"
fi

# Check 3: Service Account Key
if [ ! -f "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
    echo -e "${RED}❌ Service account key not found: $GOOGLE_APPLICATION_CREDENTIALS${NC}"
    echo "Run: ./scripts/setup-gcp-batch-infrastructure.sh"
    exit 1
else
    echo -e "${GREEN}✅ Service account key found${NC}"
fi

# Check 4: OpenAI API Key
if [ -z "$OPENAI_API_KEY" ]; then
    echo -e "${YELLOW}⚠️  OPENAI_API_KEY not set (OpenAI batches will fail)${NC}"
else
    echo -e "${GREEN}✅ OPENAI_API_KEY set${NC}"
fi

# Check 5: MongoDB
if [ -z "$MONGODB_URI" ]; then
    echo -e "${RED}❌ MONGODB_URI not set in .env${NC}"
    exit 1
else
    echo -e "${GREEN}✅ MONGODB_URI set${NC}"
fi

echo ""
echo "🔍 Checking Google Cloud resources..."
echo ""

# Check 6: GCS Bucket exists
if gsutil ls gs://$GCS_BATCH_BUCKET &> /dev/null; then
    echo -e "${GREEN}✅ GCS bucket exists${NC}"
else
    echo -e "${RED}❌ GCS bucket not found${NC}"
    echo "Run: ./scripts/setup-gcp-batch-infrastructure.sh"
    exit 1
fi

# Check 7: Pub/Sub topic exists
if gcloud pubsub topics describe airank-batch-completions --project=$GCP_PROJECT_ID &> /dev/null; then
    echo -e "${GREEN}✅ Pub/Sub topic exists${NC}"
else
    echo -e "${YELLOW}⚠️  Pub/Sub topic not found${NC}"
    echo "Run: ./scripts/setup-gcp-batch-infrastructure.sh"
fi

# Check 8: Pub/Sub subscription exists
if gcloud pubsub subscriptions describe airank-batch-webhook --project=$GCP_PROJECT_ID &> /dev/null; then
    echo -e "${GREEN}✅ Pub/Sub subscription exists${NC}"

    # Show endpoint
    ENDPOINT=$(gcloud pubsub subscriptions describe airank-batch-webhook --project=$GCP_PROJECT_ID --format="value(pushConfig.pushEndpoint)")
    echo "   Endpoint: $ENDPOINT"
else
    echo -e "${YELLOW}⚠️  Pub/Sub subscription not found${NC}"
    echo "You need to create it with your webhook URL"
fi

echo ""
echo "📦 Checking models configuration..."
echo ""

# Check 9: Models have processByBatch
BATCH_MODELS=$(grep -c "processByBatch: true" config/models.yaml || echo "0")
if [ "$BATCH_MODELS" -gt "0" ]; then
    echo -e "${GREEN}✅ Found $BATCH_MODELS models with batch processing enabled${NC}"
else
    echo -e "${RED}❌ No models have processByBatch: true${NC}"
    echo "Run: node scripts/add-process-by-batch.js"
    exit 1
fi

echo ""
echo "🎯 All checks passed!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Next steps:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Start services in separate terminals:"
echo "   Terminal 1: cd graphql && npm start"
echo "   Terminal 2: cd batcher && npm start"
echo "   Terminal 3: cd listener && npm start"
echo ""
echo "2. For local testing, start ngrok (Terminal 4):"
echo "   ngrok http 4002"
echo ""
echo "3. Update Pub/Sub subscription with ngrok URL:"
echo "   gcloud pubsub subscriptions update airank-batch-webhook \\"
echo "     --push-endpoint=\"https://YOUR-NGROK-URL.ngrok.io/webhooks/batch/{workspaceId}\""
echo ""
echo "4. Test batch submission:"
echo "   - Via UI: Click 'Run Your First Report'"
echo "   - Via script: Edit and run batcher/trigger-job.js"
echo ""
echo "5. Monitor logs for batch submission:"
echo "   Look for: 📦 Submitted openai batch: batch_..."
echo "   Look for: 📦 Submitted vertex batch: projects/..."
echo ""
echo "6. Check MongoDB:"
echo "   mongosh \"mongodb://localhost:27017/workspace_YOUR_ID?authSource=admin\""
echo "   db.batches.find().pretty()"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📚 Documentation:"
echo "   Quick Start: BATCH_QUICKSTART.md"
echo "   Full Guide:  docs/BATCH_SETUP_GUIDE.md"
echo ""

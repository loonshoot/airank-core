#!/bin/bash
# Setup GCP credentials from environment variable
# This script runs at container startup to write the GCP_SERVICE_ACCOUNT_KEY
# environment variable to a file that the Google Cloud SDK can use

if [ ! -z "$GCP_SERVICE_ACCOUNT_KEY" ]; then
  echo "✓ Setting up GCP credentials from environment variable..."
  echo "$GCP_SERVICE_ACCOUNT_KEY" > /tmp/gcp-credentials.json
  export GOOGLE_APPLICATION_CREDENTIALS=/tmp/gcp-credentials.json
  echo "✓ GCP credentials configured at $GOOGLE_APPLICATION_CREDENTIALS"
else
  echo "⚠️  GCP_SERVICE_ACCOUNT_KEY not set - batch processing features will not work"
fi

# Execute the command passed to this script
exec "$@"

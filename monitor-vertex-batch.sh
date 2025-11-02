#!/bin/bash

# Monitor Vertex AI batch until completion

BATCH_JOB=$1
CHECK_INTERVAL=${2:-30}  # Default 30 seconds

if [ -z "$BATCH_JOB" ]; then
    echo "Usage: ./monitor-vertex-batch.sh <batch-job-name> [check-interval-seconds]"
    echo "Example: ./monitor-vertex-batch.sh projects/791169578153/locations/us-east5/batchPredictionJobs/5348563318200074240 30"
    exit 1
fi

echo "🔄 Monitoring Vertex AI batch job..."
echo "Job: $BATCH_JOB"
echo "Check interval: ${CHECK_INTERVAL}s"
echo "Press Ctrl+C to stop monitoring"
echo ""

while true; do
    echo "⏰ $(date '+%Y-%m-%d %H:%M:%S') - Checking status..."

    # Run the status check
    OUTPUT=$(node check-vertex-batch-status.js "$BATCH_JOB" 2>&1)

    # Extract the status line
    STATUS_LINE=$(echo "$OUTPUT" | grep "^Status:")
    echo "$STATUS_LINE"

    # Check if completed (succeeded or failed)
    if echo "$OUTPUT" | grep -q "✅ Batch completed successfully"; then
        echo ""
        echo "🎉 Batch completed successfully!"
        echo ""
        echo "$OUTPUT"
        exit 0
    elif echo "$OUTPUT" | grep -q "❌ Batch failed"; then
        echo ""
        echo "💥 Batch failed!"
        echo ""
        echo "$OUTPUT"
        exit 1
    fi

    # Sleep before next check
    sleep $CHECK_INTERVAL
done

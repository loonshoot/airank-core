# Architecture Changes - Vertex AI Batch Processing

## Overview

Refactored the Vertex AI batch processing flow to improve security, scalability, and cost optimization by separating concerns and removing GCS credentials from internet-facing services.

## What Changed

### Before (Security Risk)
```
GCS → Pub/Sub → Stream Service (with GCS creds) → Download → Process
                    ↑
            Internet-facing webhook
            (GCS credentials exposed)
```

### After (Secure & Scalable)
```
GCS → Pub/Sub → Stream Service → Create notification doc
                    ↓
                Listener Service → Detect notification → Trigger job
                    ↓
                Batcher Service (with GCS creds) → Download → Process
                    ↑
            Internal service only
            (GCS credentials secure)
```

## Files Modified

### 1. Stream Service ([stream/index.js](stream/index.js))
**Before**: Downloaded from GCS, processed batch results
**After**: Only creates notification document in MongoDB

**Changes**:
- Removed GCS download logic
- Removed batch processing logic
- Added creation of `batchnotifications` document
- Returns 200 immediately (fast response)

### 2. Stream Dockerfile ([stream/Dockerfile](stream/Dockerfile))
**Before**: Included GCS credentials and batch helpers
**After**: Minimal dependencies, no GCS access

**Changes**:
- Removed GCP environment setup script
- Removed batch helper dependencies
- Removed GCS credential mounting

### 3. Listener Config ([listener/src/config.js](listener/src/config.js))
**Added**: New rule to watch `batchnotifications` collection

**New Rule**:
```javascript
{
  collection: 'batchnotifications',
  filter: { processed: false },
  operationType: ['insert'],
  jobName: 'processVertexBatchNotification',
  metadata: {
    description: 'Process Vertex AI batch completion notifications from GCS'
  }
}
```

### 4. New Batcher Job ([config/jobs/processVertexBatchNotification.js](config/jobs/processVertexBatchNotification.js))
**Purpose**: Download Vertex AI batch results from GCS securely

**Flow**:
1. Receives notification from listener
2. Connects to workspace database
3. Finds matching batch document
4. Downloads results from GCS (using secure credentials)
5. Updates batch status to 'received' (triggers processBatchResults)
6. Marks notification as processed
7. Cleans up GCS files

### 5. Documentation ([VERTEX_BATCH_SETUP.md](VERTEX_BATCH_SETUP.md))
**Updated**: Architecture diagram to reflect new flow
**Added**: Security and scalability benefits section

## Benefits

### 🔒 Security
- **GCS credentials never exposed to internet**: Stream service has no GCS access
- **Reduced attack surface**: Webhook endpoint is lightweight, minimal logic
- **Credential isolation**: Only batcher service has GCS permissions

### 📈 Scalability
- **Stream service**: Can scale horizontally for high throughput
- **Listener service**: MongoDB change streams distribute load automatically
- **Batcher service**: Can be scaled independently based on job queue

### 💰 Cost Optimization
- **Stream instances**: Cheap to run, can scale freely
- **Batcher instances**: Can restrict scaling (processing doesn't need to be realtime)
- **Resource allocation**: Each service sized for its specific workload

### 🎯 Separation of Concerns
- **Stream**: Only receives webhooks and creates notifications
- **Listener**: Only watches for changes and triggers jobs
- **Batcher**: Only processes jobs with heavy workloads

## Database Collections

### New Collection: `batchnotifications`

**Purpose**: Lightweight notification documents created by stream service

**Schema**:
```javascript
{
  _id: ObjectId,
  gcsUri: "gs://bucket/path/to/file.jsonl",
  bucket: "airank-production-batches",
  fileName: "batches/output/workspaceId/timestamp/file.jsonl",
  workspaceId: "690089a0df6b55271c136dee",
  receivedAt: Date,
  processed: false,
  processedAt: Date,  // Set when job completes
  batchId: String     // Set when batch is found
}
```

### Existing Collection: `batches`

**Status Flow**:
1. `submitted` - Initial submission to Vertex AI
2. `processing` - Vertex AI is processing (optional)
3. `received` - Results downloaded and stored (triggers processBatchResults)
4. `processed` - Sentiment analysis complete (isProcessed: true)

## Testing

### Test Stream Webhook (Local)
```bash
# Start stream service locally
cd stream
npm install
npm start

# Send test Pub/Sub message
curl -X POST http://localhost:4003/webhooks/batch \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "data": "eyJuYW1lIjoiYmF0Y2hlcy9vdXRwdXQvNjkwMDg5YTBkZjZiNTUyNzFjMTM2ZGVlLzE3MzAwMDAwMDAvdGVzdC5qc29ubCIsImJ1Y2tldCI6ImFpcmFuay1wcm9kdWN0aW9uLWJhdGNoZXMifQ=="
    }
  }'

# Check if notification was created
mongo "mongodb://..." --eval 'db.getSiblingDB("workspace_690089a0df6b55271c136dee").batchnotifications.find().pretty()'
```

### Test Complete Flow (Production)
1. Deploy changes to production
2. Map `stream.getairank.com` to stream service (port 4003)
3. Set up GCS bucket and Pub/Sub (see [VERTEX_BATCH_SETUP.md](VERTEX_BATCH_SETUP.md))
4. Submit a Vertex AI batch
5. Wait for completion
6. Verify:
   - Notification created in `batchnotifications`
   - Job triggered by listener
   - Results downloaded by batcher
   - Batch status updated to 'received'
   - Sentiment analysis completed

### Monitor Jobs
```bash
# Check listener logs
docker logs -f airank-core-listener

# Check batcher logs
docker logs -f airank-core-batcher

# Check Agenda jobs
mongo "mongodb://..." --eval 'db.getSiblingDB("airank").jobs.find({name: "processVertexBatchNotification"}).pretty()'
```

## Rollback Plan

If issues arise, rollback is safe:
1. The old `batches` collection flow still works for OpenAI
2. New `batchnotifications` collection is isolated
3. Vertex AI batches can be manually processed using existing helper functions

## Next Steps

1. ✅ Deploy to production
2. ⏳ Map `stream.getairank.com` domain
3. ⏳ Create GCS bucket `gs://airank-production-batches`
4. ⏳ Set up Pub/Sub topic and push subscription
5. ⏳ Configure GCS notifications
6. ⏳ Test with real Vertex AI batch

See [VERTEX_BATCH_SETUP.md](VERTEX_BATCH_SETUP.md) for detailed setup instructions.

## Questions?

- Architecture questions: See [VERTEX_BATCH_SETUP.md](VERTEX_BATCH_SETUP.md)
- Job debugging: Check Agenda jobs collection and service logs
- GCS issues: Verify service account permissions and bucket configuration

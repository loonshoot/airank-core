# Dynamic Listener Deployment Guide

## Overview

The listener service has been rewritten to use dynamic database configuration, matching the outrun-core architecture pattern. This enables runtime configuration updates without container restarts.

## Architecture Changes

### Before (Static Config)
- Listeners defined in `listener/src/config.js`
- Required container restart to add/modify listeners
- Fixed configuration per workspace

### After (Dynamic Database)
- Listeners stored in MongoDB `airank.listeners` collection
- Runtime configuration updates via database operations
- Change streams watch for configuration changes
- Distributed locking for high availability
- Automatic failover with polling

## Deployment Steps

### 1. Deploy the Updated Code

In Dokploy, rebuild the airank-core deployment. This will pull the latest code and rebuild all containers.

**That's it!** The listener container will automatically:
- Create indexes on the `listeners` collection
- Bootstrap default listeners if they don't exist
- Start watching for configuration changes

No manual migration script needed! The container is **self-healing** and will seed the required listeners on first startup.

### 2. Verify Automatic Bootstrapping

The listener will automatically create two default listeners:

**Listener 1: processBatchResults**
```json
{
  "collection": "batches",
  "filter": { "status": "received", "isProcessed": false },
  "operationType": ["insert", "update"],
  "jobName": "processBatchResults",
  "isActive": true
}
```

**Listener 2: processVertexBatchNotification**
```json
{
  "collection": "batchnotifications",
  "filter": { "processed": false },
  "operationType": ["insert"],
  "jobName": "processVertexBatchNotification",
  "isActive": true
}
```

### 3. Verify Deployment

Check the listener logs:

```bash
docker logs airank-core-listener --tail 100
```

You should see:
```
🔌 Initializing Dynamic Listener Manager...
📋 Instance ID: listener-xxx-xxx
✓ Connected to MongoDB
✓ Mongoose connected
✓ Agenda initialized
✓ Listener indexes ensured
🌱 Bootstrapping default listeners...
  ✓ Created default listener: batches → processBatchResults
  ✓ Created default listener: batchnotifications → processVertexBatchNotification
✓ Bootstrap complete: 2 active listeners in database
✓ Initialization complete
🎧 Starting dynamic listeners...
📊 Found 2 active listener configurations
📊 Found 15 workspace databases
🎧 Starting listener: workspace_xxx-batches-processBatchResults
🎧 Starting listener: workspace_xxx-batchnotifications-processVertexBatchNotification
...
✓ All listeners started (30 active streams)
👀 Watching listeners collection for configuration changes...
✓ Listener collection watch established
🔄 Starting polling for available listeners...
💓 Heartbeat: 30 active streams, uptime: 10s
```

Expected stream count:
- 15 workspaces × 2 listeners = **30 active streams**

On subsequent restarts, you'll see:
```
🌱 Bootstrapping default listeners...
  ✓ Listener exists: batches → processBatchResults
  ✓ Listener exists: batchnotifications → processVertexBatchNotification
✓ Bootstrap complete: 2 active listeners in database
```

## Managing Listeners at Runtime

### Add a New Listener

```javascript
// Via MongoDB shell or application code
db.listeners.insertOne({
  collection: "newcollection",
  filter: { field: "value" },
  operationType: ["insert", "update"],
  jobName: "newJob",
  isActive: true,
  metadata: { description: "New listener" },
  createdAt: new Date(),
  updatedAt: new Date()
});

// Listener service detects insert immediately
// New change streams started for all workspaces
// No restart needed!
```

### Update a Listener

```javascript
db.listeners.updateOne(
  { collection: "batches", jobName: "processBatchResults" },
  {
    $set: {
      filter: { status: "received", isProcessed: false, priority: "high" },
      updatedAt: new Date()
    }
  }
);

// Listener service detects update
// Closes and restarts affected change streams
// No restart needed!
```

### Disable a Listener

```javascript
db.listeners.updateOne(
  { collection: "batches", jobName: "processBatchResults" },
  {
    $set: {
      isActive: false,
      updatedAt: new Date()
    }
  }
);

// Listener service detects update
// Closes change streams for this listener
// No restart needed!
```

### Delete a Listener

```javascript
db.listeners.deleteOne({
  collection: "batches",
  jobName: "processBatchResults"
});

// Listener service detects deletion
// Closes all related change streams
// No restart needed!
```

## Distributed Locking

The listener service uses distributed locking for high availability:

- **Lock Acquisition**: Each listener attempts to acquire a lock before starting
- **Heartbeat**: Updates every 10 seconds via `lockInfo.lastHeartbeat`
- **Timeout**: Locks expire after 30 seconds of inactivity
- **Failover**: Other instances can take over stale locks
- **Polling**: Every 15 seconds, checks for available listeners

This enables running multiple listener instances for redundancy.

## Monitoring

### Check Active Listeners

```bash
# Via MongoDB
db.listeners.find({ isActive: true })

# Check locks
db.listeners.find({ "lockInfo.instanceId": { $exists: true } })
```

### Check Listener Logs

```bash
docker logs airank-core-listener --tail 100 -f
```

Look for:
- `💓 Heartbeat:` - Shows active stream count
- `📨 Listener change detected:` - Configuration changes
- `📨 Change detected:` - Workspace data changes
- `✓ Scheduled job:` - Jobs triggered

## Troubleshooting

### No Streams Starting

**Problem**: Listener shows 0 active streams

**Solution**:
1. Check if listeners exist: `db.listeners.find()`
2. Check if listeners are active: `db.listeners.find({ isActive: true })`
3. Check workspace databases exist: `show databases`
4. Check listener logs for errors

### Streams Not Detecting Changes

**Problem**: Webhook creates notification but nothing happens

**Solution**:
1. Check listener is watching the collection: Look for `🎧 Starting listener:` in logs
2. Check filter matches: `db.batchnotifications.findOne({ processed: false })`
3. Check job is registered in batcher: `Successfully registered job: processVertexBatchNotification`
4. Check Agenda jobs: `db.jobs.find({ name: "processVertexBatchNotification" })`

### Multiple Instances Fighting

**Problem**: Logs show locks being stolen

**Solution**:
- This is normal failover behavior
- Check heartbeat is working: `db.listeners.find({}, { "lockInfo.lastHeartbeat": 1 })`
- If heartbeat stops updating, instance is crashed/stuck
- Other instances will take over after 30-second timeout

## Future Enhancements

### GraphQL Mutations (To Be Implemented)

```graphql
mutation CreateListener {
  createListener(
    collection: "batches"
    filter: { status: "received" }
    operationType: [INSERT, UPDATE]
    jobName: "processBatchResults"
    isActive: true
    metadata: { description: "Process batches" }
  ) {
    id
    collection
    jobName
    isActive
  }
}

mutation UpdateListener {
  updateListener(
    id: "listener_id"
    isActive: false
  ) {
    id
    isActive
  }
}

mutation DeleteListener {
  deleteListener(id: "listener_id") {
    success
  }
}
```

### Admin UI

Build a UI for managing listeners:
- List all listeners
- Create/edit/delete listeners
- Enable/disable listeners
- View active streams per listener
- Monitor lock status

## Rollback Plan

If issues arise, rollback to static config:

1. In `listener/index.js`, change:
   ```javascript
   const ListenerManager = require('./src/listener-manager-dynamic');
   ```
   to:
   ```javascript
   const ListenerManager = require('./src/listener-manager');
   ```

2. Redeploy

The old static configuration will be used until the database approach is fixed.

## Summary

The dynamic listener architecture provides:

✅ **Zero-Downtime Updates**: Add/modify/delete listeners without restart
✅ **Consistent Architecture**: Matches outrun-core pattern
✅ **High Availability**: Distributed locking with automatic failover
✅ **Flexibility**: Runtime configuration changes
✅ **Scalability**: Multiple listener instances supported
✅ **Observability**: Change stream events logged

This brings airank-core in line with outrun-core's proven architecture!

# AI Rank Listener Service

The Listener Service is a critical component of the AI Rank platform that monitors MongoDB collections for changes and triggers jobs based on those changes. It uses MongoDB Change Streams to provide real-time processing of data modifications.

## Architecture Overview

The service implements a distributed locking mechanism to ensure high availability and fault tolerance across multiple instances. Each listener instance:
- Generates a unique instance ID
- Acquires locks for specific listeners
- Maintains heartbeats to indicate active status
- Automatically recovers and redistributes work if an instance fails

A key architectural constraint is that each change stream can only be managed by a single listener instance at a time. This design:
- Prevents duplicate processing of documents
- Ensures consistent ordering of operations
- Creates potential throughput limitations for high-volume collections
- May require future horizontal scaling through collection sharding for high-load scenarios

## Core Components

### Change Stream Management
- Maintains active change streams for each collection being monitored
- Uses MongoDB's Change Stream API to watch for document modifications
- Supports filtering based on operation types (insert, update, delete)

### Lock Management
- Uses a distributed locking mechanism with 30-second timeouts
- Implements heartbeat updates every 10 seconds
- Automatically releases locks on service shutdown
- Handles failover by detecting stale locks

### Document Processing
- Tracks document processing status using metadata
- Prevents duplicate processing through document-level locking
- Creates Agenda jobs for processing changes
- Maintains processing history and error states

### Self-Recovery Behavior
- Automatically detects and reprocesses failed or incomplete documents on startup
- Implements a polling mechanism to find documents with null or error status
- Maintains processing history to prevent duplicate processing during recovery
- Handles interrupted jobs from previous instance crashes
- Resumes processing from the last known good state
- Implements backoff strategies for repeated failures

## Key Features

### High Availability
- Multiple instances can run simultaneously
- Automatic work distribution across instances
- Graceful failover handling
- Lock-based work coordination

### Error Handling
- Automatic recovery from change stream errors
- Retries on connection issues
- Error tracking at document level
- Failed document reprocessing capability

### Polling Mechanisms
- Polls for incomplete documents every 30 seconds
- Checks for available listeners every 15 seconds
- Maintains active heartbeats every 10 seconds

## Technical Details

### Document Metadata Structure
```javascript
{
  metadata: {
    listener: {
      status: string,         // null, 'complete'
      lastRun: Date,         // Last processing attempt
      listenerId: string,    // ID of processing listener
      jobId: string,         // Created Agenda job ID
      error: string,         // Error message if failed
      lastError: Date        // Timestamp of last error
    }
  }
}
```

### Listener Lock Structure
```javascript
{
  lockInfo: {
    instanceId: string,     // Unique ID of instance holding lock
    lastHeartbeat: Date     // Last heartbeat timestamp
  }
}
```

## Configuration

The service requires the following environment variables:
- `MONGODB_URI`: MongoDB connection string
- `MONGODB_PARAMS`: Additional MongoDB connection parameters

## Startup Process

1. Connects to MongoDB
2. Generates unique instance ID
3. Starts Agenda job processor
4. Loads active listeners
5. Establishes change streams
6. Begins polling and heartbeat intervals

## Shutdown Process

The service handles graceful shutdown by:
1. Clearing all intervals
2. Closing active change streams
3. Releasing all locks
4. Stopping Agenda
5. Disconnecting from MongoDB

## Error Recovery

The service implements multiple recovery mechanisms:
- Automatic change stream reconnection
- Stale lock detection and recovery
- Failed document reprocessing
- Instance failure detection

## Best Practices

When working with the Listener Service:
1. Monitor lock acquisition patterns
2. Track document processing states
3. Watch for error patterns in processing
4. Monitor heartbeat consistency
5. Check for stale locks regularly

## Debugging

Common debugging approaches:
1. Check listener lock status
2. Review document metadata
3. Monitor change stream health
4. Verify job creation in Agenda
5. Inspect instance heartbeats

## Performance Considerations

The service is designed with several performance optimizations:
- Concurrent processing limits
- Efficient lock management
- Batched heartbeat updates
- Controlled polling intervals 

### Scaling Considerations
- Each change stream is managed by a single instance to prevent duplicate processing
- High-volume collections may experience bottlenecks due to single-instance stream management
- Consider sharding collections or implementing custom partitioning for high-throughput scenarios
- Monitor stream processing latency to identify potential bottlenecks
- Balance between consistency guarantees and throughput requirements 
# Outrun Batcher Service

The Batcher Service is a core component of the Outrun platform that handles scheduled data ingestion from various external APIs. It uses Agenda for job scheduling and management, with built-in support for rate limiting, error handling, and job history tracking.

## Architecture Overview

The service implements a job-based architecture where:
- Each job type is defined in a separate module
- Jobs are scheduled and managed by Agenda
- Redis handles rate limiting across distributed instances
- MongoDB stores job history and ingested data
- Each job maintains its own state and error handling

Key architectural features:
- Concurrent job processing with configurable limits
- Distributed rate limiting using Redis
- Automatic job recovery and error handling
- Support for backfill and incremental data ingestion
- Stream-based data processing pipeline

## Core Components

### Job Scheduler (Agenda)
- Manages job queues and scheduling
- Handles concurrent job execution
- Provides job locking and persistence
- Configurable concurrency and lock limits
- Automatic job recovery on failures

### Rate Limiting
- Redis-based distributed rate limiting
- Provider-specific rate limit configurations
- Automatic backoff and retry mechanisms
- Separate limiters for different API endpoints
- Real-time rate limit monitoring

### Data Processing Pipeline
- Stream-based record processing
- Two-phase commit for data consistency
- Support for backfill operations
- Incremental updates based on modification time
- Error tracking and recovery mechanisms

### Job History Tracking
- Detailed execution metrics
- Error logging and categorization
- Performance statistics collection
- Data ingestion volume tracking
- API call counting and monitoring

## Supported Providers

### Google Search Console
- Daily search analytics data
- Multi-site support
- Dimension-based data aggregation
- Automatic token refresh
- Rate limit compliance

### HubSpot
- CRM object synchronization
- Custom object support
- Event tracking
- Incremental updates
- Complex property management

## Technical Details

### Job Configuration Structure
```javascript
{
  "jobs": {
    "jobName": {
      "provider": "providerName",
      "path": "./src/path/to/job"
    }
  }
}
```

### Job History Schema
```javascript
{
  status: String,
  sourceId: String,
  startTime: Date,
  endTime: Date,
  errors: [Object],
  data: Object,
  jobId: String,
  name: String,
  runtimeMilliseconds: Number,
  ingressBytes: Number,
  apiCalls: Number
}
```

### Rate Limit Configuration
```javascript
{
  namespace: "provider:endpoint:",
  interval: milliseconds,
  maxInInterval: requestCount
}
```

## Configuration

The service requires the following environment variables:
- `MONGODB_URI`: MongoDB connection string
- `MONGODB_PARAMS`: Additional MongoDB parameters
- `REDIS_URL`: Redis connection string

## Startup Process

1. Loads job configurations
2. Establishes database connections
3. Initializes rate limiters
4. Registers job definitions
5. Starts Agenda scheduler
6. Begins processing queued jobs

## Shutdown Process

The service handles graceful shutdown by:
1. Stopping new job processing
2. Completing in-progress jobs
3. Saving job states
4. Closing database connections
5. Releasing Redis resources

## Error Recovery

Multiple recovery mechanisms are implemented:
- Automatic job retries
- Failed job tracking
- Stale job detection
- Token refresh handling
- Rate limit recovery

## Best Practices

When working with the Batcher Service:
1. Monitor job execution times
2. Track rate limit usage
3. Review error patterns
4. Monitor data volumes
5. Check token validity
6. Verify data consistency

## Debugging

Common debugging approaches:
1. Check job history
2. Review rate limit logs
3. Monitor API responses
4. Verify data ingestion
5. Track token status

## Performance Considerations

The service is optimized for:
- Efficient API usage
- Minimal database operations
- Controlled memory usage
- Rate limit compliance
- Resource sharing

### Scaling Considerations
- Jobs are processed concurrently
- Rate limits are shared across instances
- Database connections are pooled
- Redis handles distributed state
- Consider provider API limits when scaling 
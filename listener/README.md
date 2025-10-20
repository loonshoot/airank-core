# AIRank Listener Service

MongoDB change stream listener that monitors workspace databases for batch processing events and triggers jobs accordingly.

## Overview

This service watches all workspace databases for changes to the `batches` collection. When a batch job completes and its status changes to `received`, the listener automatically triggers a `processBatchResults` job to analyze and store the results.

## Architecture

- **Change Streams**: MongoDB change streams monitor collections in real-time
- **Multi-Workspace**: Single listener instance monitors all workspace databases
- **Job Scheduling**: Uses Agenda to schedule processing jobs
- **Heartbeat**: Regular health checks to monitor service status

## Configuration

Configuration is managed in `src/config.js`:

```javascript
{
  collection: 'batches',
  filter: {
    status: 'received',
    isProcessed: false
  },
  operationType: ['insert', 'update'],
  jobName: 'processBatchResults'
}
```

## Running the Service

### Development
```bash
cd listener
npm install
npm run dev
```

### Production
```bash
cd listener
npm install
npm start
```

### With PM2
```bash
pm2 start listener/index.js --name airank-listener
pm2 save
```

## Environment Variables

Required environment variables (from parent `.env`):

- `MONGODB_URI` - MongoDB connection string
- `MONGODB_PARAMS` - MongoDB connection parameters
- `HOSTNAME` - Optional hostname for instance identification

## How It Works

1. **Initialization**: Connects to MongoDB and initializes Agenda
2. **Discovery**: Scans for all databases starting with `workspace_`
3. **Listening**: Creates change streams for each workspace's `batches` collection
4. **Detection**: Monitors for documents with `status: 'received'` and `isProcessed: false`
5. **Triggering**: Schedules `processBatchResults` job via Agenda when matched
6. **Heartbeat**: Logs status every 30 seconds

## Monitoring

The service logs:
- Active change stream count
- Uptime
- Job scheduling events
- Errors and warnings

Example heartbeat output:
```
💓 Heartbeat: 5 active streams, uptime: 3600s
```

## Error Handling

- **Change Stream Errors**: Logged and stream is removed from active list
- **Job Scheduling Errors**: Logged but service continues
- **Uncaught Exceptions**: Service shuts down gracefully
- **Shutdown Signals**: SIGINT/SIGTERM handled gracefully

## Scaling

To run multiple instances:
1. Each instance gets a unique `instanceId`
2. MongoDB change streams work across multiple consumers
3. Agenda handles job deduplication

## Dependencies

- `mongodb` - MongoDB driver with change streams support
- `mongoose` - MongoDB object modeling
- `agenda` - Job scheduling
- `dotenv` - Environment configuration

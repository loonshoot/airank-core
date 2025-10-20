require('dotenv').config({ path: '../.env' });

const config = {
  mongodb: {
    uri: process.env.MONGODB_URI,
    params: process.env.MONGODB_PARAMS || '',
    agendaDatabase: 'airank',
    agendaCollection: 'jobs'
  },
  listener: {
    heartbeatInterval: 30000, // 30 seconds
    lockTimeout: 60000, // 1 minute
    instanceId: `listener-${process.env.HOSTNAME || 'default'}-${Date.now()}`
  },
  rules: [
    {
      collection: 'batches',
      filter: {
        status: 'received',
        isProcessed: false
      },
      operationType: ['insert', 'update'],
      jobName: 'processBatchResults',
      metadata: {
        description: 'Process batch results when they are received'
      }
    }
  ]
};

module.exports = config;

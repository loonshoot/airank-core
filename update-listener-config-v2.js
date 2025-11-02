const { MongoClient } = require('mongodb');

async function updateListenerConfig() {
  const uri = process.env.PROD_MONGO_URI;
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('Connected to MongoDB\n');

    const db = client.db('airank');
    const listeners = db.collection('listeners');

    console.log('Updating batchnotifications listener configuration...');

    const result = await listeners.updateOne(
      {
        collection: 'batchnotifications',
        jobName: 'processVertexBatchNotification'
      },
      {
        $set: {
          operationType: ['insert', 'update'],
          updatedAt: new Date()
        }
      }
    );

    console.log('Listener updated:', result.modifiedCount > 0 ? 'YES' : 'NO');

    const listener = await listeners.findOne({
      collection: 'batchnotifications',
      jobName: 'processVertexBatchNotification'
    });

    console.log('\nUpdated listener:');
    console.log('  Collection:', listener.collection);
    console.log('  Job:', listener.jobName);
    console.log('  Operations:', listener.operationType);
    console.log('  Active:', listener.isActive);

    await client.close();

  } catch (error) {
    console.error('Error:', error.message);
    await client.close();
    process.exit(1);
  }
}

updateListenerConfig();

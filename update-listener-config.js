const mongoose = require('mongoose');

async function updateListenerConfig() {
  try {
    const mongoUri = process.env.PROD_MONGO_URI;
    
    if (!mongoUri) {
      throw new Error('PROD_MONGO_URI environment variable is required');
    }

    console.log('🔌 Connecting to production database...');
    await mongoose.connect(mongoUri);
    console.log('✓ Connected\n');

    const db = mongoose.connection.db;
    const airankDb = db.admin().listDatabases().then(result => {
      const airankDatabase = result.databases.find(d => d.name === 'airank');
      return db.client.db('airank');
    });

    const listeners = db.collection('listeners');

    // Update the batchnotifications listener to include 'update' operation
    console.log('📝 Updating batchnotifications listener configuration...');
    
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

    if (result.matchedCount === 0) {
      console.log('⚠️  No listener found to update');
    } else if (result.modifiedCount === 0) {
      console.log('ℹ️  Listener already has correct configuration');
    } else {
      console.log('✅ Listener configuration updated successfully');
    }

    // Show the updated listener
    const listener = await listeners.findOne({
      collection: 'batchnotifications',
      jobName: 'processVertexBatchNotification'
    });

    console.log('\nUpdated listener:');
    console.log(JSON.stringify(listener, null, 2));

    await mongoose.connection.close();
    console.log('\n✓ Disconnected');

  } catch (error) {
    console.error('💥 Error:', error.message);
    process.exit(1);
  }
}

updateListenerConfig();

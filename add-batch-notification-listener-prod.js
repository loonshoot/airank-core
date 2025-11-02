/**
 * Quick script to add batchnotifications listener to production
 * Run this against production MongoDB to enable the listener without code changes
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

async function addListener() {
  // Use production MongoDB URI
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const params = process.env.MONGODB_PARAMS || 'authSource=admin&directConnection=true';

  const client = new MongoClient(`${mongoUri}?${params}`);

  try {
    await client.connect();
    console.log('✓ Connected to MongoDB');

    const db = client.db('airank');
    const listeners = db.collection('listeners');

    // Check if listener already exists
    const existing = await listeners.findOne({
      collection: 'batchnotifications',
      jobName: 'processVertexBatchNotification'
    });

    if (existing) {
      console.log('✓ Listener already exists:', existing._id);
      console.log('  Ensuring it is active...');
      await listeners.updateOne(
        { _id: existing._id },
        {
          $set: {
            isActive: true,
            updatedAt: new Date()
          }
        }
      );
      console.log('✓ Listener activated');
    } else {
      // Create new listener
      const listener = {
        collection: 'batchnotifications',
        filter: {
          processed: false
        },
        operationType: ['insert'],
        jobName: 'processVertexBatchNotification',
        isActive: true,
        metadata: {
          description: 'Process Vertex AI batch completion notifications from GCS'
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await listeners.insertOne(listener);
      console.log('✓ Created listener:', result.insertedId);
    }

    console.log('');
    console.log('✅ Listener ready!');
    console.log('');
    console.log('⚠️  IMPORTANT: This requires the listener service to be updated');
    console.log('   to read from the database instead of static config.');
    console.log('');
    console.log('   For now, restart the listener container to pick up the');
    console.log('   static config change that was already deployed.');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
  }
}

addListener();

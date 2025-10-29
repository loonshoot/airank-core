const mongoose = require('mongoose');
const { Listener } = require('./listener/src/listener-model');
require('dotenv').config();

/**
 * Migrate static listener config to dynamic database configuration
 * This script creates the initial listener documents in the database
 */
async function migrateListeners() {
  console.log('🔄 Creating initial listener configurations in database...');
  console.log('');

  try {
    // Connect to airank database
    const mongoUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;

    // Add timeout for connection
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 5000
    });
    console.log('✓ Connected to airank database');

    // Check existing listeners
    const existingListeners = await Listener.find({});
    console.log(`Found ${existingListeners.length} existing listeners`);

    if (existingListeners.length > 0) {
      console.log('');
      console.log('Existing listeners:');
      existingListeners.forEach(l => {
        console.log(`  - ${l.collection} → ${l.jobName} (${l.isActive ? 'active' : 'inactive'})`);
      });
      console.log('');
    }

    // Define listeners to create (from static config)
    const listenersToCreate = [
      {
        collection: 'batches',
        filter: {
          status: 'received',
          isProcessed: false
        },
        operationType: ['insert', 'update'],
        jobName: 'processBatchResults',
        isActive: true,
        metadata: {
          description: 'Process batch results when they are received'
        }
      },
      {
        collection: 'batchnotifications',
        filter: {
          processed: false
        },
        operationType: ['insert'],
        jobName: 'processVertexBatchNotification',
        isActive: true,
        metadata: {
          description: 'Process Vertex AI batch completion notifications from GCS'
        }
      }
    ];

    console.log('Creating/updating listeners...');
    console.log('');

    for (const listenerConfig of listenersToCreate) {
      // Check if listener already exists
      const existing = await Listener.findOne({
        collection: listenerConfig.collection,
        jobName: listenerConfig.jobName
      });

      if (existing) {
        // Update existing
        await Listener.updateOne(
          { _id: existing._id },
          {
            $set: {
              filter: listenerConfig.filter,
              operationType: listenerConfig.operationType,
              isActive: listenerConfig.isActive,
              metadata: listenerConfig.metadata,
              updatedAt: new Date()
            }
          }
        );
        console.log(`✓ Updated: ${listenerConfig.collection} → ${listenerConfig.jobName}`);
      } else {
        // Create new
        const listener = new Listener(listenerConfig);
        await listener.save();
        console.log(`✓ Created: ${listenerConfig.collection} → ${listenerConfig.jobName}`);
      }
    }

    console.log('');
    console.log('✅ Migration complete!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Deploy updated listener service');
    console.log('2. Listener will automatically start watching these collections');
    console.log('3. No restart needed to add/modify listeners in the future');
    console.log('');

    await mongoose.disconnect();
    process.exit(0);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrateListeners();

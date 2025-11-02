const mongoose = require('mongoose');

/**
 * Trigger existing batch notifications by updating them
 * This will cause an UPDATE event that the listener will detect
 */

const PROD_MONGO_URI = process.env.PROD_MONGO_URI || 'mongodb://admin:JFuwryV9Y8JzutLAKxti@100.123.101.37:27017/?authSource=admin&directConnection=true';
const WORKSPACE_ID = '69006a2aced7e5f70bbaaac5';

async function triggerNotifications() {
  console.log('🔔 Triggering Existing Batch Notifications');
  console.log('='.repeat(60));
  console.log('');

  try {
    // Connect to workspace database
    const baseUri = PROD_MONGO_URI.split('?')[0].replace(/\/[^\/]*$/, '');
    const params = PROD_MONGO_URI.split('?')[1] || '';
    const workspaceUri = `${baseUri}/workspace_${WORKSPACE_ID}?${params}`;

    await mongoose.connect(workspaceUri);
    const db = mongoose.connection.db;

    console.log('✓ Connected to production database');
    console.log('');

    // Find unprocessed notifications
    const notifications = await db.collection('batchnotifications')
      .find({ processed: false })
      .toArray();

    console.log(`Found ${notifications.length} unprocessed notifications`);
    console.log('');

    if (notifications.length === 0) {
      console.log('No notifications to trigger');
      await mongoose.disconnect();
      return;
    }

    // Display notifications
    console.log('Notifications to trigger:');
    notifications.forEach((n, i) => {
      console.log(`  ${i + 1}. ${n.fileName?.split('/').pop()}`);
      console.log(`     Received: ${n.receivedAt}`);
      console.log(`     GCS URI: ${n.gcsUri}`);
    });
    console.log('');

    // Update all unprocessed notifications to trigger UPDATE events
    console.log('Triggering notifications (updating documents)...');
    const result = await db.collection('batchnotifications').updateMany(
      { processed: false },
      {
        $set: {
          triggeredAt: new Date(),
          // This update will cause an UPDATE event in the change stream
          // The listener will detect it and trigger the job
        }
      }
    );

    console.log(`✓ Updated ${result.modifiedCount} notifications`);
    console.log('');
    console.log('The listener should now detect these UPDATE events and trigger jobs!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Wait 10-30 seconds for listener to detect changes');
    console.log('2. Check batcher logs: docker logs airank-core-batcher --tail 50');
    console.log('3. Run check-production-readonly.js again to verify processing');
    console.log('');

    await mongoose.disconnect();
    console.log('='.repeat(60));
    console.log('✅ Trigger complete');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

triggerNotifications();

const mongoose = require('mongoose');

async function fixOrphanedNotifications() {
  await mongoose.connect(process.env.PROD_MONGO_URI);

  const workspaceId = '690f7b6056f9ee90ea8cdbe2';
  const workspaceDb = mongoose.connection.useDb(`workspace_${workspaceId}`);

  console.log('🔧 Fixing Orphaned Vertex Notifications');
  console.log('Workspace ID:', workspaceId);
  console.log('Time:', new Date().toISOString());
  console.log('=' .repeat(80));

  // Find notifications with undefined provider
  const orphanedNotifications = await workspaceDb.collection('batchnotifications').find({
    $or: [
      { provider: { $exists: false } },
      { provider: null },
      { provider: undefined },
      { provider: '' }
    ],
    processed: false
  }).toArray();

  console.log('\n📨 Found', orphanedNotifications.length, 'orphaned notifications');

  if (orphanedNotifications.length === 0) {
    console.log('✅ No orphaned notifications to fix');
    await mongoose.connection.close();
    return;
  }

  // Update each notification to set provider: 'vertex'
  for (const notif of orphanedNotifications) {
    console.log('\n  Fixing notification:', notif._id);
    console.log('  GCS File:', notif.fileName);
    console.log('  Received:', notif.receivedAt);

    await workspaceDb.collection('batchnotifications').updateOne(
      { _id: notif._id },
      { $set: { provider: 'vertex' } }
    );

    console.log('  ✅ Updated provider to "vertex"');
  }

  console.log('\n\n✅ All orphaned notifications have been fixed');
  console.log('📋 Total updated:', orphanedNotifications.length);
  console.log('\n💡 These notifications will now be picked up by processVertexBatchNotification');

  await mongoose.connection.close();
}

fixOrphanedNotifications().catch(console.error);

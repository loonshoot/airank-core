const mongoose = require('mongoose');

async function monitorBatch() {
  try {
    const workspaceId = '69006a2aced7e5f70bbaaac5';
    const batchDocId = '6902ac56e0020895cb60c531';

    const mongoUri = process.env.PROD_MONGO_URI;
    const client = await mongoose.connect(mongoUri);
    const adminDb = client.connection.db;
    const workspaceDb = adminDb.client.db(`workspace_${workspaceId}`);

    console.log('📊 Monitoring Batch Status\n');

    // Check batch document
    const batch = await workspaceDb.collection('batches').findOne({
      _id: new mongoose.Types.ObjectId(batchDocId)
    });

    if (batch) {
      console.log('Batch Document:');
      console.log('  ID:', batch._id);
      console.log('  Status:', batch.status);
      console.log('  Provider:', batch.provider);
      console.log('  Model:', batch.model);
      console.log('  Batch ID:', batch.batchId);
      console.log('  Output GCS:', batch.outputGcsPrefix);
      console.log('  Created:', batch.createdAt);
      console.log('  Updated:', batch.updatedAt);
    } else {
      console.log('  No batch found');
    }

    // Check for notifications
    const notifications = await workspaceDb.collection('batchnotifications').find({}).sort({ receivedAt: -1 }).limit(3).toArray();
    console.log('\nRecent Notifications:', notifications.length);
    notifications.forEach((n, i) => {
      console.log(`  ${i + 1}. ${n.fileName}`);
      console.log(`     Processed: ${n.processed}`);
      console.log(`     Received: ${n.receivedAt}`);
    });

    await mongoose.connection.close();

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

monitorBatch();

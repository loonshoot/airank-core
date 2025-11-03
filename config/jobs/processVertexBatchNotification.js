const mongoose = require('mongoose');
const { downloadVertexBatchResults } = require('../../graphql/mutations/helpers/batch/vertex');

/**
 * Process Vertex AI batch notification from GCS
 * This job is triggered by the listener service when a batchnotification document is created
 * It downloads the batch results from GCS and updates the batch status to 'received'
 * This will then trigger the processBatchResults job to handle sentiment analysis
 */
module.exports = async function processVertexBatchNotification(job, done) {
  const { workspaceId, documentId, document } = job.attrs.data;

  if (!workspaceId) {
    return done(new Error('workspaceId is required'));
  }

  if (!documentId) {
    return done(new Error('documentId is required'));
  }

  let workspaceConnection = null;

  try {
    console.log(`🔄 Processing Vertex AI batch notification for workspace ${workspaceId}`);
    console.log(`📦 Provider: ${document.provider || 'unknown'}`);
    console.log(`📦 GCS URI: ${document.gcsUri}`);

    // Defensive check: Only process Vertex AI notifications
    if (document.provider !== 'vertex') {
      console.log(`⚠️  Skipping non-Vertex notification (provider: ${document.provider})`);
      return done();
    }

    // Verify we have GCS URI
    if (!document.gcsUri) {
      console.log(`⚠️  Missing gcsUri for Vertex notification`);
      return done(new Error('gcsUri is required for Vertex batch notifications'));
    }

    // Connect to workspace-specific database
    const mongoUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
    workspaceConnection = mongoose.createConnection(mongoUri, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 5,
    });

    await new Promise((resolve, reject) => {
      workspaceConnection.once('connected', () => {
        console.log('✓ Connected to workspace database');
        resolve();
      });
      workspaceConnection.once('error', (error) => {
        console.error('❌ Workspace database connection error:', error);
        reject(error);
      });
      setTimeout(() => reject(new Error('Workspace database connection timeout')), 30000);
    });

    const workspaceDb = workspaceConnection.db;

    // Find the batch document by GCS output prefix
    const gcsPrefix = `gs://${document.bucket}/${document.fileName.split('/').slice(0, -1).join('/')}/`;

    let batch = await workspaceDb.collection('batches').findOne({
      outputGcsPrefix: gcsPrefix,
      status: { $in: ['submitted', 'processing'] }
    });

    if (!batch) {
      // Try to find by checking if the prefix matches
      const batches = await workspaceDb.collection('batches').find({
        status: { $in: ['submitted', 'processing'] }
      }).toArray();

      for (const b of batches) {
        if (b.outputGcsPrefix && gcsPrefix.startsWith(b.outputGcsPrefix)) {
          batch = b;
          break;
        }
      }

      if (!batch) {
        console.log(`⚠️  No matching batch found for ${gcsPrefix}`);
        // Mark notification as processed even though no batch found
        await workspaceDb.collection('batchnotifications').updateOne(
          { _id: new mongoose.Types.ObjectId(documentId) },
          { $set: { processed: true, processedAt: new Date() } }
        );
        return done();
      }
    }

    console.log(`✓ Found batch: ${batch.batchId} (${batch.provider})`);

    // Download and process results for Vertex AI batches
    if (batch.provider === 'vertex') {
      await downloadVertexBatchResults(batch.outputGcsPrefix, workspaceDb, batch.batchId);
      console.log(`✅ Vertex batch results downloaded and stored for ${batch.batchId}`);
      console.log(`📋 Batch status updated to 'received' - processBatchResults job will be triggered automatically`);
    } else {
      console.log(`⚠️  Batch provider ${batch.provider} not handled by this job`);
    }

    // Mark notification as processed
    await workspaceDb.collection('batchnotifications').updateOne(
      { _id: new mongoose.Types.ObjectId(documentId) },
      {
        $set: {
          processed: true,
          processedAt: new Date(),
          batchId: batch.batchId
        }
      }
    );

    console.log(`✅ Notification processed successfully`);

    // Close workspace connection
    if (workspaceConnection) {
      await workspaceConnection.close();
      console.log('🔌 Workspace database connection closed');
    }

    done();

  } catch (error) {
    console.error('💥 Vertex batch notification processing failed:', error);

    if (workspaceConnection) {
      await workspaceConnection.close();
    }

    done(error);
  }
};

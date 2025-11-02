const mongoose = require('mongoose');
const { downloadOpenAIBatchResults } = require('../../graphql/mutations/helpers/batch/openai');

module.exports = async function processOpenAIBatchNotification(job, done) {
  const { workspaceId, documentId, document } = job.attrs.data;

  try {
    console.log(`🔄 Processing OpenAI batch notification for workspace ${workspaceId}`);

    const mongoUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
    const workspaceConn = mongoose.createConnection(mongoUri);
    await workspaceConn.asPromise();
    const workspaceDb = workspaceConn.db;

    // Find the batch document by batchId
    const batchId = document.batchId;

    let batch = await workspaceDb.collection('batches').findOne({
      batchId: batchId,
      provider: 'openai',
      status: { $in: ['submitted', 'processing', 'validating', 'in_progress'] }
    });

    if (!batch) {
      console.log(`⚠️  No matching OpenAI batch found for ${batchId}`);

      // Mark notification as processed even though we couldn't find the batch
      await workspaceDb.collection('batchnotifications').updateOne(
        { _id: new mongoose.Types.ObjectId(documentId) },
        {
          $set: {
            processed: true,
            processedAt: new Date(),
            error: 'Batch document not found'
          }
        }
      );

      await workspaceConn.close();
      return done();
    }

    console.log(`📦 Found batch: ${batch.batchId}`);

    // Download results from OpenAI
    if (document.outputFileId) {
      console.log(`⬇️  Downloading results from file: ${document.outputFileId}`);
      await downloadOpenAIBatchResults(document.outputFileId, workspaceDb, batchId);
      console.log(`✅ OpenAI batch results downloaded and stored for ${batchId}`);
    } else {
      console.log(`⚠️  No output file ID in notification`);
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

    await workspaceConn.close();
    done();
  } catch (error) {
    console.error('💥 OpenAI batch notification processing failed:', error);
    done(error);
  }
};

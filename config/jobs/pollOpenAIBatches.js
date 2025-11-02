const mongoose = require('mongoose');
const OpenAI = require('openai');

/**
 * Polls OpenAI for batch status and creates notifications when batches complete
 * This job should run every 5-10 minutes to check for completed batches
 */
module.exports = async function pollOpenAIBatches(job, done) {
  try {
    console.log('🔍 Polling OpenAI batches for completion status...');

    if (!process.env.OPENAI_API_KEY) {
      console.error('⚠️  OPENAI_API_KEY not configured, skipping poll');
      return done();
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    // Connect to airank database to get all workspaces
    const airankUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
    const airankConn = mongoose.createConnection(airankUri);
    await airankConn.asPromise();
    const airankDb = airankConn.db;

    const workspaces = await airankDb.collection('workspaces').find({}).toArray();
    console.log(`Checking ${workspaces.length} workspace(s) for pending OpenAI batches...`);

    let totalChecked = 0;
    let totalCompleted = 0;

    // Check each workspace for pending OpenAI batches
    for (const workspace of workspaces) {
      const workspaceId = workspace._id.toString();

      try {
        const workspaceUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
        const workspaceConn = mongoose.createConnection(workspaceUri);
        await workspaceConn.asPromise();
        const workspaceDb = workspaceConn.db;

        // Find all pending OpenAI batches (submitted or in progress)
        const pendingBatches = await workspaceDb.collection('batches').find({
          provider: 'openai',
          status: { $in: ['submitted', 'validating', 'in_progress', 'finalizing'] }
        }).toArray();

        if (pendingBatches.length === 0) {
          await workspaceConn.close();
          continue;
        }

        console.log(`  Workspace ${workspace.name}: ${pendingBatches.length} pending batch(es)`);

        // Check each pending batch
        for (const batch of pendingBatches) {
          totalChecked++;

          try {
            // Check batch status from OpenAI
            const apiBatch = await openai.batches.retrieve(batch.batchId);

            console.log(`    Batch ${batch.batchId}: ${apiBatch.status}`);

            // Update batch status in database
            await workspaceDb.collection('batches').updateOne(
              { _id: batch._id },
              {
                $set: {
                  status: apiBatch.status,
                  updatedAt: new Date()
                }
              }
            );

            // If completed, create a notification for the listener to pick up
            if (apiBatch.status === 'completed') {
              totalCompleted++;

              // Check if notification already exists
              const existingNotification = await workspaceDb.collection('batchnotifications').findOne({
                provider: 'openai',
                batchId: batch.batchId
              });

              if (!existingNotification) {
                const notification = {
                  provider: 'openai',
                  batchId: batch.batchId,
                  status: apiBatch.status,
                  outputFileId: apiBatch.output_file_id,
                  errorFileId: apiBatch.error_file_id,
                  workspaceId: workspaceId,
                  receivedAt: new Date(),
                  processed: false,
                  createdBy: 'pollOpenAIBatches'
                };

                await workspaceDb.collection('batchnotifications').insertOne(notification);
                console.log(`      ✅ Created notification for completed batch ${batch.batchId}`);
              } else {
                console.log(`      ℹ️  Notification already exists for ${batch.batchId}`);
              }
            } else if (apiBatch.status === 'failed' || apiBatch.status === 'expired' || apiBatch.status === 'cancelled') {
              console.log(`      ⚠️  Batch ${batch.batchId} ended with status: ${apiBatch.status}`);

              // Update batch to final status
              await workspaceDb.collection('batches').updateOne(
                { _id: batch._id },
                {
                  $set: {
                    status: apiBatch.status,
                    completedAt: new Date(),
                    errorInfo: apiBatch.errors
                  }
                }
              );
            }

          } catch (error) {
            if (error.status === 404) {
              console.log(`      ⚠️  Batch ${batch.batchId} not found in OpenAI (may have expired)`);

              // Mark as failed
              await workspaceDb.collection('batches').updateOne(
                { _id: batch._id },
                {
                  $set: {
                    status: 'not_found',
                    completedAt: new Date(),
                    errorInfo: { message: 'Batch not found in OpenAI API' }
                  }
                }
              );
            } else {
              console.error(`      ❌ Error checking batch ${batch.batchId}:`, error.message);
            }
          }
        }

        await workspaceConn.close();

      } catch (error) {
        console.error(`  ⚠️  Error processing workspace ${workspaceId}:`, error.message);
      }
    }

    await airankConn.close();

    console.log(`✅ Polling complete: ${totalChecked} batches checked, ${totalCompleted} completed`);
    done();

  } catch (error) {
    console.error('💥 Error polling OpenAI batches:', error);
    done(error);
  }
};

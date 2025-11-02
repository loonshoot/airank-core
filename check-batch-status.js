const mongoose = require('mongoose');

async function checkBatchStatus() {
  try {
    const mongoUri = process.env.PROD_MONGO_URI;
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to production database\n');

    const airankDb = mongoose.connection.client.db('airank');

    // Get all workspaces
    const workspaces = await airankDb.collection('workspaces').find({}).toArray();
    console.log(`Checking ${workspaces.length} workspaces...\n`);
    console.log('='.repeat(100));

    let totalOpenAI = { submitted: 0, completed: 0, failed: 0, processing: 0 };
    let totalVertex = { submitted: 0, completed: 0, failed: 0, processing: 0 };
    let totalNotifications = { received: 0, processed: 0, unprocessed: 0 };
    let totalJobs = { scheduledJobs: 0, completedJobs: 0, failedJobs: 0 };

    for (const workspace of workspaces) {
      const workspaceDb = mongoose.connection.client.db(`workspace_${workspace._id}`);

      try {
        // Check OpenAI batches
        const openAIBatches = await workspaceDb.collection('batches').find({
          provider: 'openai'
        }).toArray();

        const vertexBatches = await workspaceDb.collection('batches').find({
          provider: 'vertex'
        }).toArray();

        // Check notifications
        const notifications = await workspaceDb.collection('batchnotifications').find({}).toArray();

        if (openAIBatches.length > 0 || vertexBatches.length > 0 || notifications.length > 0) {
          console.log(`\n📊 ${workspace.name} (${workspace._id})`);
          console.log('-'.repeat(100));

          // OpenAI Batch Details
          if (openAIBatches.length > 0) {
            console.log(`\n  🤖 OpenAI Batches: ${openAIBatches.length}`);
            openAIBatches.forEach((batch, i) => {
              console.log(`\n    ${i + 1}. Batch ID: ${batch.batchId}`);
              console.log(`       Status: ${batch.status}`);
              console.log(`       Submitted: ${batch.submittedAt}`);
              console.log(`       Completed: ${batch.completedAt || 'N/A'}`);
              console.log(`       Requests: ${batch.requestCount}`);
              console.log(`       Results: ${batch.results?.length || 0}`);
              console.log(`       Is Processed: ${batch.isProcessed}`);
              console.log(`       Input File: ${batch.inputFileId}`);
              console.log(`       Output File: ${batch.outputFileId || 'N/A'}`);

              // Count status
              if (batch.status === 'submitted') totalOpenAI.submitted++;
              else if (batch.status === 'received' || batch.status === 'completed') totalOpenAI.completed++;
              else if (batch.status === 'failed') totalOpenAI.failed++;
              else totalOpenAI.processing++;
            });
          }

          // Vertex AI Batch Details
          if (vertexBatches.length > 0) {
            console.log(`\n  🌐 Vertex AI Batches: ${vertexBatches.length}`);
            vertexBatches.forEach((batch, i) => {
              console.log(`\n    ${i + 1}. Batch ID: ${batch.batchId}`);
              console.log(`       Status: ${batch.status}`);
              console.log(`       Submitted: ${batch.submittedAt}`);
              console.log(`       Completed: ${batch.completedAt || 'N/A'}`);
              console.log(`       Requests: ${batch.requestCount}`);
              console.log(`       Results: ${batch.results?.length || 0}`);
              console.log(`       Is Processed: ${batch.isProcessed}`);
              console.log(`       Output GCS: ${batch.outputGcsPrefix || 'N/A'}`);

              // Count status
              if (batch.status === 'submitted') totalVertex.submitted++;
              else if (batch.status === 'received' || batch.status === 'completed') totalVertex.completed++;
              else if (batch.status === 'failed') totalVertex.failed++;
              else totalVertex.processing++;
            });
          }

          // Notifications
          if (notifications.length > 0) {
            console.log(`\n  📨 Batch Notifications: ${notifications.length}`);
            const processed = notifications.filter(n => n.processed).length;
            const unprocessed = notifications.filter(n => !n.processed).length;
            console.log(`       Processed: ${processed}`);
            console.log(`       Unprocessed: ${unprocessed}`);

            totalNotifications.received += notifications.length;
            totalNotifications.processed += processed;
            totalNotifications.unprocessed += unprocessed;

            // Show unprocessed details
            const unprocessedNotifs = notifications.filter(n => !n.processed);
            if (unprocessedNotifs.length > 0) {
              console.log(`\n       Unprocessed notifications:`);
              unprocessedNotifs.forEach((n, i) => {
                console.log(`       ${i + 1}. ${n.fileName} (received: ${n.receivedAt})`);
              });
            }
          }
        }

      } catch (err) {
        // Workspace database might not exist
      }
    }

    // Check Agenda Jobs
    console.log('\n' + '='.repeat(100));
    console.log('\n⚙️  Agenda Jobs Analysis');
    console.log('-'.repeat(100));

    const batchJobs = await airankDb.collection('agendaJobs').find({
      name: { $in: ['processBatchResults', 'processVertexBatchNotification', 'promptModelTester'] }
    }).toArray();

    console.log(`\nTotal batch-related jobs: ${batchJobs.length}`);

    const jobsByName = {};
    batchJobs.forEach(job => {
      if (!jobsByName[job.name]) {
        jobsByName[job.name] = { total: 0, completed: 0, failed: 0, pending: 0 };
      }
      jobsByName[job.name].total++;

      if (job.lastFinishedAt) {
        if (job.failedAt && job.failedAt > job.lastFinishedAt) {
          jobsByName[job.name].failed++;
        } else {
          jobsByName[job.name].completed++;
        }
      } else {
        jobsByName[job.name].pending++;
      }
    });

    Object.keys(jobsByName).forEach(name => {
      const stats = jobsByName[name];
      console.log(`\n  ${name}:`);
      console.log(`    Total: ${stats.total}`);
      console.log(`    Completed: ${stats.completed}`);
      console.log(`    Failed: ${stats.failed}`);
      console.log(`    Pending: ${stats.pending}`);
    });

    // Show recent failed jobs
    const recentFailedJobs = batchJobs.filter(j => j.failedAt).sort((a, b) => b.failedAt - a.failedAt).slice(0, 5);
    if (recentFailedJobs.length > 0) {
      console.log(`\n  Recent Failed Jobs:`);
      recentFailedJobs.forEach((job, i) => {
        console.log(`\n    ${i + 1}. ${job.name}`);
        console.log(`       Failed: ${job.failedAt}`);
        console.log(`       Reason: ${job.failReason}`);
        console.log(`       Workspace: ${job.data?.workspaceId}`);
      });
    }

    // Summary
    console.log('\n' + '='.repeat(100));
    console.log('\n📊 OVERALL SUMMARY');
    console.log('-'.repeat(100));

    console.log('\n🤖 OpenAI Batches:');
    console.log(`   Submitted: ${totalOpenAI.submitted}`);
    console.log(`   Completed: ${totalOpenAI.completed}`);
    console.log(`   Processing: ${totalOpenAI.processing}`);
    console.log(`   Failed: ${totalOpenAI.failed}`);

    console.log('\n🌐 Vertex AI Batches:');
    console.log(`   Submitted: ${totalVertex.submitted}`);
    console.log(`   Completed: ${totalVertex.completed}`);
    console.log(`   Processing: ${totalVertex.processing}`);
    console.log(`   Failed: ${totalVertex.failed}`);

    console.log('\n📨 Notifications:');
    console.log(`   Received: ${totalNotifications.received}`);
    console.log(`   Processed: ${totalNotifications.processed}`);
    console.log(`   Unprocessed: ${totalNotifications.unprocessed}`);

    console.log('\n' + '='.repeat(100));

    // Assessment
    console.log('\n🔍 BATCH PROCESSING ASSESSMENT:\n');

    if (totalOpenAI.submitted > 0 && totalOpenAI.completed === 0) {
      console.log('⚠️  OpenAI: Batches submitted but NONE completed - CHECK OPENAI API');
    } else if (totalOpenAI.completed > 0) {
      console.log('✅ OpenAI: Batches completing successfully');
    } else {
      console.log('ℹ️  OpenAI: No batches found');
    }

    if (totalVertex.submitted > 0 && totalVertex.completed === 0) {
      console.log('⚠️  Vertex AI: Batches submitted but NONE completed - CHECK VERTEX API');
    } else if (totalVertex.completed > 0) {
      console.log('✅ Vertex AI: Batches completing successfully');
    } else {
      console.log('ℹ️  Vertex AI: No batches found');
    }

    if (totalNotifications.unprocessed > 0) {
      console.log(`⚠️  Notifications: ${totalNotifications.unprocessed} unprocessed - CHECK LISTENER`);
    } else if (totalNotifications.processed > 0) {
      console.log('✅ Notifications: Processing successfully');
    } else {
      console.log('ℹ️  Notifications: No notifications found');
    }

    console.log('\n' + '='.repeat(100) + '\n');

    await mongoose.connection.close();

  } catch (error) {
    console.error('💥 Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

checkBatchStatus();

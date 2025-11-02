#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  const workspaceId = process.argv[2] || '690089a0df6b55271c136dee';

  console.log('🔍 Listing all batches for workspace:', workspaceId);
  console.log();

  const workspaceDbUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  const workspaceDb = mongoose.createConnection(workspaceDbUri);
  await workspaceDb.asPromise();

  const batches = await workspaceDb.collection('batches').find({}).sort({ submittedAt: -1 }).limit(10).toArray();

  console.log(`Found ${batches.length} total batches:\n`);

  for (const batch of batches) {
    console.log(`Batch ID: ${batch.batchId}`);
    console.log(`  Provider: ${batch.provider}`);
    console.log(`  Status: ${batch.status}`);
    console.log(`  Processed: ${batch.isProcessed}`);
    console.log(`  Model: ${batch.modelId}`);
    console.log(`  Requests: ${batch.requestCount}`);
    console.log(`  Submitted: ${batch.submittedAt}`);
    if (batch.completedAt) {
      console.log(`  Completed: ${batch.completedAt}`);
    }
    console.log();
  }

  await workspaceDb.close();
}

main().catch(console.error);

#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  const workspaceId = process.argv[2] || '69006a2aced7e5f70bbaaac5';

  const workspaceDbUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  const workspaceDb = mongoose.createConnection(workspaceDbUri);
  await workspaceDb.asPromise();

  const batch = await workspaceDb.collection('batches')
    .find({ status: 'received', isProcessed: false })
    .sort({ submittedAt: -1 })
    .limit(1)
    .toArray();

  if (batch.length > 0) {
    console.log(batch[0]._id.toString());
  }

  await workspaceDb.close();
}

main().catch(console.error);

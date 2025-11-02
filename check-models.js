#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  const workspaceId = process.argv[2] || '69006a2aced7e5f70bbaaac5';

  const workspaceDbUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  const workspaceDb = mongoose.createConnection(workspaceDbUri);
  await workspaceDb.asPromise();

  const models = await workspaceDb.collection('models').find({}).toArray();

  console.log(`\nModels in workspace ${workspaceId}:\n`);

  models.forEach(m => {
    console.log(`${m.isEnabled ? '✅' : '❌'} ${m.name} (${m.modelId})`);
    console.log(`   Provider: ${m.provider}`);
    console.log(`   Batch-capable: ${m.modelId.includes('gemini') || m.modelId.includes('claude') ? 'Yes (Vertex)' : 'Yes (OpenAI)'}`);
    console.log();
  });

  await workspaceDb.close();
}

main().catch(console.error);

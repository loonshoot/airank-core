#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');

async function main() {
  const workspaceId = process.argv[2] || '69006a2aced7e5f70bbaaac5';

  console.log('🔧 Enabling Gemini 2.5 Flash model');
  console.log('Workspace ID:', workspaceId);
  console.log();

  const workspaceDbUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  const workspaceDb = mongoose.createConnection(workspaceDbUri);
  await workspaceDb.asPromise();

  // Check if model already exists
  const existing = await workspaceDb.collection('models').findOne({ modelId: 'gemini-2.5-flash' });

  if (existing) {
    console.log('✅ Gemini 2.5 Flash already exists');
    if (!existing.isEnabled) {
      await workspaceDb.collection('models').updateOne(
        { _id: existing._id },
        { $set: { isEnabled: true, updatedAt: new Date() } }
      );
      console.log('✅ Enabled existing model');
    }
  } else {
    console.log('➕ Creating new Gemini 2.5 Flash model');
    await workspaceDb.collection('models').insertOne({
      _id: new ObjectId(),
      name: 'Gemini 2.5 Flash',
      provider: 'google',
      modelId: 'gemini-2.5-flash',
      isEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    console.log('✅ Model created and enabled');
  }

  await workspaceDb.close();

  console.log('\n💡 Now run:');
  console.log(`   node create-test-batch.js ${workspaceId}`);
  console.log('   This will create a Vertex AI batch!');
}

main().catch(console.error);

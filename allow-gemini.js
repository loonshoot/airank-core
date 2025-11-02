#!/usr/bin/env node

require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  const workspaceId = process.argv[2] || '69006a2aced7e5f70bbaaac5';

  console.log('🔧 Adding Gemini to allowed models');
  console.log('Workspace ID:', workspaceId);
  console.log();

  // Connect to airank database
  const airankUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
  const airankDb = mongoose.createConnection(airankUri);
  await airankDb.asPromise();

  // Find workspace - try multiple approaches
  const { ObjectId } = require('mongodb');

  let workspace = await airankDb.collection('workspaces').findOne({ _id: new ObjectId(workspaceId) });

  // If not found, try string comparison
  if (!workspace) {
    const allWorkspaces = await airankDb.collection('workspaces').find({}).toArray();
    workspace = allWorkspaces.find(w => w._id.toString() === workspaceId);
  }

  if (!workspace) {
    console.error('❌ Workspace not found');
    console.log('Checking all workspaces...');
    const allWorkspaces = await airankDb.collection('workspaces').find({}).toArray();
    console.log('Available workspaces:', allWorkspaces.map(w => w._id.toString()));
    await airankDb.close();
    return;
  }

  console.log('✅ Found workspace:', workspace.name);

  if (!workspace.billingProfileId) {
    console.error('❌ No billing profile attached to workspace');
    await airankDb.close();
    return;
  }

  // Update billing profile to include Gemini
  const result = await airankDb.collection('billingprofiles').updateOne(
    { _id: workspace.billingProfileId },
    {
      $addToSet: {
        allowedModels: 'gemini-2.5-flash'
      },
      $set: {
        updatedAt: new Date()
      }
    }
  );

  if (result.modifiedCount > 0) {
    console.log('✅ Added gemini-2.5-flash to allowed models');
  } else {
    console.log('ℹ️  Model may already be allowed');
  }

  // Show current allowed models
  const billingProfile = await airankDb.collection('billingprofiles').findOne({ _id: workspace.billingProfileId });
  console.log('\n📋 Current allowed models:');
  (billingProfile.allowedModels || []).forEach(m => console.log(`   - ${m}`));

  await airankDb.close();

  console.log('\n💡 Now run:');
  console.log(`   node create-test-batch.js ${workspaceId}`);
}

main().catch(console.error);

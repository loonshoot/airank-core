const mongoose = require('mongoose');

async function checkBatchId() {
  try {
    const mongoUri = process.env.PROD_MONGO_URI;
    await mongoose.connect(mongoUri);
    
    const workspaceDb = mongoose.connection.client.db('workspace_6902c7819b9572e1e703390f');
    
    const batch = await workspaceDb.collection('batches').findOne({
      provider: 'openai'
    }, { sort: { submittedAt: -1 } });
    
    console.log('Batch document:');
    console.log(JSON.stringify(batch, null, 2));
    
    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkBatchId();

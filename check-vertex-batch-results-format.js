const mongoose = require('mongoose');

async function checkVertexBatchResultsFormat() {
  await mongoose.connect(process.env.PROD_MONGO_URI);

  const workspaceId = '690f7b6056f9ee90ea8cdbe2';
  const workspaceDb = mongoose.connection.useDb(`workspace_${workspaceId}`);

  console.log('🔍 Checking Vertex Batch Results Format');
  console.log('Workspace ID:', workspaceId);
  console.log('=' .repeat(80));

  // Get a Vertex batch with results
  const batch = await workspaceDb.collection('batches').findOne({
    provider: 'vertex',
    'results.0': { $exists: true } // Has at least one result
  });

  if (!batch) {
    console.log('❌ No Vertex batches with results found');
    await mongoose.connection.close();
    return;
  }

  console.log('\n📦 Batch:', batch.batchId);
  console.log('Status:', batch.status);
  console.log('Results Count:', batch.results.length);

  if (batch.results.length > 0) {
    console.log('\n📄 First Result (raw JSON):');
    console.log(JSON.stringify(batch.results[0], null, 2));

    console.log('\n\n🔍 Analyzing structure:');
    const result = batch.results[0];

    console.log('\nTop-level keys:', Object.keys(result));

    if (result.response) {
      console.log('\nresult.response keys:', Object.keys(result.response));

      if (result.response.body) {
        console.log('\nresult.response.body keys:', Object.keys(result.response.body));
        console.log('\nresult.response.body:', JSON.stringify(result.response.body, null, 2).substring(0, 500));
      }
    }

    if (result.prediction) {
      console.log('\n⚠️  Found "prediction" key (Vertex AI format)');
      console.log('result.prediction:', JSON.stringify(result.prediction, null, 2).substring(0, 500));
    }

    if (result.candidates) {
      console.log('\n⚠️  Found "candidates" at top level');
      console.log('result.candidates:', JSON.stringify(result.candidates, null, 2).substring(0, 500));
    }
  }

  await mongoose.connection.close();
}

checkVertexBatchResultsFormat().catch(console.error);

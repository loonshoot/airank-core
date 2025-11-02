const mongoose = require('mongoose');

async function checkAllBatches() {
  const mongoUri = process.env.PROD_MONGO_URI;
  await mongoose.connect(mongoUri);

  const airankDb = mongoose.connection.client.db('airank');
  const workspaces = await airankDb.collection('workspaces').find({}).toArray();

  console.log('Checking batches across', workspaces.length, 'workspaces\n');
  console.log('='.repeat(80));

  let totalOpenAI = 0;
  let totalVertex = 0;

  for (const ws of workspaces) {
    const wsDb = mongoose.connection.client.db(`workspace_${ws._id}`);

    try {
      const openai = await wsDb.collection('batches').find({ provider: 'openai' }).toArray();
      const vertex = await wsDb.collection('batches').find({ provider: 'vertex' }).toArray();

      if (openai.length > 0 || vertex.length > 0) {
        console.log(`\n${ws.name}:`);
        if (openai.length > 0) {
          console.log(`  OpenAI batches: ${openai.length}`);
          totalOpenAI += openai.length;
          openai.forEach(b => {
            const resultCount = b.results ? b.results.length : 0;
            console.log(`    - ${b.batchId}: ${b.status} (${b.requestCount} requests, ${resultCount} results)`);
            console.log(`      Submitted: ${b.submittedAt}`);
            console.log(`      Completed: ${b.completedAt || 'N/A'}`);
            console.log(`      Processed: ${b.isProcessed}`);
          });
        }
        if (vertex.length > 0) {
          console.log(`  Vertex batches: ${vertex.length}`);
          totalVertex += vertex.length;
          vertex.forEach(b => {
            const resultCount = b.results ? b.results.length : 0;
            console.log(`    - ${b.batchId}: ${b.status} (${b.requestCount} requests, ${resultCount} results)`);
            console.log(`      Submitted: ${b.submittedAt}`);
            console.log(`      Completed: ${b.completedAt || 'N/A'}`);
            console.log(`      Processed: ${b.isProcessed}`);
          });
        }
      }
    } catch (err) {
      // Skip non-existent workspace DBs
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`\nTotal OpenAI batches: ${totalOpenAI}`);
  console.log(`Total Vertex batches: ${totalVertex}`);
  console.log('');

  await mongoose.connection.close();
}

checkAllBatches();

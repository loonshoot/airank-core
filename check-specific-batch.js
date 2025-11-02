const OpenAI = require('openai');

async function checkBatch() {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  const batchId = 'batch_6902c7e702088190b9a2f790bd9eab9f';

  try {
    console.log('Checking batch:', batchId);
    const batch = await openai.batches.retrieve(batchId);
    console.log('\n✅ Batch found!');
    console.log(JSON.stringify(batch, null, 2));
  } catch (error) {
    console.log('\n❌ Error:', error.message);

    // Try listing recent batches
    console.log('\nListing recent batches instead...');
    try {
      const batches = await openai.batches.list({ limit: 10 });
      console.log(`\nFound ${batches.data.length} recent batches:`);
      batches.data.forEach((b, i) => {
        console.log(`${i + 1}. ${b.id} - ${b.status} (created: ${new Date(b.created_at * 1000).toISOString()})`);
      });
    } catch (listError) {
      console.log('Error listing batches:', listError.message);
    }
  }
}

checkBatch();

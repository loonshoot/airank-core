const OpenAI = require('openai');

async function checkBatch() {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  const batchId = 'batch_6902c7e702088190b9a2f790bd9eab9f';

  console.log('Checking old batch:', batchId);

  try {
    const batch = await openai.batches.retrieve(batchId);
    console.log('✅ Batch exists!');
    console.log('Status:', batch.status);
    console.log('Full response:', JSON.stringify(batch, null, 2));
  } catch (error) {
    console.log('❌ Error:', error.message);
  }
}

checkBatch().catch(console.error);

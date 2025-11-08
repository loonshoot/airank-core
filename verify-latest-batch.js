const OpenAI = require('openai');

async function verifyBatch() {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  const batchId = 'batch_690f84b93d948190b7c626deddf9b638';

  console.log('🔍 Verifying batch:', batchId);
  console.log('Time:', new Date().toISOString());

  try {
    const batch = await openai.batches.retrieve(batchId);
    console.log('✅ BATCH EXISTS IN OPENAI!');
    console.log('Status:', batch.status);
    console.log('Created:', new Date(batch.created_at * 1000).toISOString());
    console.log('Request counts:', batch.request_counts);
    console.log('\nFull response:', JSON.stringify(batch, null, 2));
  } catch (error) {
    console.log('❌ Error:', error.message);
    if (error.status === 404) {
      console.log('Batch does not exist in OpenAI');
    }
  }
}

verifyBatch().catch(console.error);

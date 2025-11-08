const OpenAI = require('openai');

async function verifyBatch() {
  const openai = new OpenAI({
    apiKey: process.env.PROD_OPENAI_KEY
  });

  const batchId = 'batch_690f84b93d948190b7c626deddf9b638';

  console.log('🔍 Verifying batch with PRODUCTION API key');
  console.log('Batch ID:', batchId);
  console.log('Time:', new Date().toISOString());
  console.log('=' .repeat(80));

  try {
    const batch = await openai.batches.retrieve(batchId);
    console.log('\n✅ BATCH EXISTS IN OPENAI!');
    console.log('Status:', batch.status);
    console.log('Created:', new Date(batch.created_at * 1000).toISOString());
    console.log('Request counts:', batch.request_counts);
    console.log('\nFull response:', JSON.stringify(batch, null, 2));
  } catch (error) {
    console.log('\n❌ Error:', error.message);
    if (error.status === 404) {
      console.log('⚠️  Batch does not exist in OpenAI');
    }
  }

  // Also list recent batches
  console.log('\n\n📋 Listing recent batches:');
  try {
    const list = await openai.batches.list({ limit: 10 });
    console.log('Total batches found:', list.data.length);

    list.data.forEach((b, idx) => {
      console.log(`\n${idx + 1}. ${b.id}`);
      console.log(`   Status: ${b.status}`);
      console.log(`   Created: ${new Date(b.created_at * 1000).toISOString()}`);
      console.log(`   Requests: ${b.request_counts.total} (${b.request_counts.completed} completed)`);
    });
  } catch (error) {
    console.log('❌ Cannot list batches:', error.message);
  }
}

verifyBatch().catch(console.error);

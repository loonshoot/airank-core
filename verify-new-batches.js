const OpenAI = require('openai');

async function verifyNewBatches() {
  const openai = new OpenAI({
    apiKey: process.env.PROD_OPENAI_KEY
  });

  const batchIds = [
    'batch_690f86d5708c81908743e7d5392bd039', // gpt-4o-mini
    'batch_690f86d64c3c81908f5ffe4f349b057b'  // gpt-4o
  ];

  console.log('🔍 Verifying newly created batches');
  console.log('Time:', new Date().toISOString());
  console.log('=' .repeat(80));

  for (const batchId of batchIds) {
    console.log('\n📦 Batch ID:', batchId);
    
    try {
      const batch = await openai.batches.retrieve(batchId);
      console.log('   ✅ Status:', batch.status);
      console.log('   Created:', new Date(batch.created_at * 1000).toISOString());
      console.log('   Request counts:', batch.request_counts);
      
      if (batch.errors) {
        console.log('   ❌ Errors:', JSON.stringify(batch.errors, null, 2));
      } else {
        console.log('   ✅ No errors');
      }
      
      if (batch.in_progress_at) {
        console.log('   In progress since:', new Date(batch.in_progress_at * 1000).toISOString());
      }
      
    } catch (error) {
      console.log('   ❌ Error:', error.message);
    }
  }
}

verifyNewBatches().catch(console.error);

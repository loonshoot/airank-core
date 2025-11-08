const OpenAI = require('openai');

async function testBatchCreation() {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  console.log('🧪 Testing OpenAI Batch Creation');
  console.log('Time:', new Date().toISOString());
  console.log('=' .repeat(80));

  // Create a simple test request
  const jsonlContent = JSON.stringify({
    custom_id: "test-request-1",
    method: "POST",
    url: "/v1/chat/completions",
    body: {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Say 'test'" }],
      max_tokens: 10
    }
  });

  console.log('\n📝 JSONL Content:');
  console.log(jsonlContent);

  try {
    // Step 1: Upload file
    console.log('\n📤 Step 1: Uploading file...');
    const buffer = Buffer.from(jsonlContent, 'utf-8');
    const file = await openai.files.create({
      file: new File([buffer], 'test-batch.jsonl', { type: 'application/jsonl' }),
      purpose: 'batch'
    });
    console.log('   ✅ File uploaded');
    console.log('   File ID:', file.id);
    console.log('   File object:', JSON.stringify(file, null, 2));

    // Step 2: Create batch
    console.log('\n🔨 Step 2: Creating batch...');
    const batch = await openai.batches.create({
      input_file_id: file.id,
      endpoint: '/v1/chat/completions',
      completion_window: '24h',
      metadata: {
        test: 'true'
      }
    });
    console.log('   ✅ Batch created');
    console.log('   Batch ID:', batch.id);
    console.log('   Batch Status:', batch.status);
    console.log('   Batch object:', JSON.stringify(batch, null, 2));

    // Step 3: Verify batch exists
    console.log('\n🔍 Step 3: Verifying batch exists...');
    const retrieved = await openai.batches.retrieve(batch.id);
    console.log('   ✅ Batch verified');
    console.log('   Retrieved Status:', retrieved.status);

    console.log('\n✅ TEST PASSED: Batch creation works correctly');
    console.log('   Real batch ID format:', batch.id);

  } catch (error) {
    console.error('\n❌ TEST FAILED');
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }
    console.error('Stack:', error.stack);
  }
}

testBatchCreation().catch(console.error);

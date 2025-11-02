const OpenAI = require('openai');
const mongoose = require('mongoose');

async function testOpenAIWithDifferentKeys() {
  console.log('Testing OpenAI batch submission with different scenarios...\n');

  // Test 1: Valid API key
  console.log('1. Testing with valid API key...');
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const buffer = Buffer.from(JSON.stringify({
      custom_id: "test-1",
      method: "POST",
      url: "/v1/chat/completions",
      body: { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], max_tokens: 10 }
    }), 'utf-8');
    
    const file = await openai.files.create({
      file: new File([buffer], 'test.jsonl', { type: 'application/jsonl' }),
      purpose: 'batch'
    });
    console.log('   File created:', file.id);

    const batch = await openai.batches.create({
      input_file_id: file.id,
      endpoint: '/v1/chat/completions',
      completion_window: '24h'
    });

    console.log('   ✅ Batch created:', batch.id);
    console.log('   Type of batch.id:', typeof batch.id);
    console.log('   Batch object keys:', Object.keys(batch));
  } catch (error) {
    console.log('   ❌ Error:', error.message);
  }

  // Test 2: Invalid API key
  console.log('\n2. Testing with invalid API key...');
  try {
    const openai = new OpenAI({ apiKey: 'sk-invalid-test-key' });
    
    const buffer = Buffer.from(JSON.stringify({
      custom_id: "test-2",
      method: "POST",
      url: "/v1/chat/completions",
      body: { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], max_tokens: 10 }
    }), 'utf-8');
    
    const file = await openai.files.create({
      file: new File([buffer], 'test.jsonl', { type: 'application/jsonl' }),
      purpose: 'batch'
    });
    console.log('   File created:', file.id);

    const batch = await openai.batches.create({
      input_file_id: file.id,
      endpoint: '/v1/chat/completions',
      completion_window: '24h'
    });

    console.log('   Batch response:', batch);
    console.log('   Batch ID:', batch.id);
  } catch (error) {
    console.log('   ❌ Expected error:', error.message);
    console.log('   Error has .id?:', error.id);
  }

  // Test 3: Check the actual stored batch
  console.log('\n3. Checking production batch document...');
  const mongoUri = process.env.PROD_MONGO_URI;
  await mongoose.connect(mongoUri);
  
  const workspaceDb = mongoose.connection.client.db('workspace_6902c7819b9572e1e703390f');
  const batch = await workspaceDb.collection('batches').findOne({
    batchId: 'batch_6902c7e702088190b9a2f790bd9eab9f'
  });
  
  console.log('   Batch document _id:', batch._id);
  console.log('   Batch document batchId:', batch.batchId);
  console.log('   Note: batchId starts with:', batch.batchId.substring(0, 15));
  console.log('   Note: _id (hex):', batch._id.toString());
  
  await mongoose.connection.close();
}

testOpenAIWithDifferentKeys().catch(console.error);

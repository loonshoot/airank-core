const OpenAI = require('openai');

async function testOpenAIBatchSubmission() {
  console.log('🧪 Testing OpenAI Batch API Submission');
  console.log('=' .repeat(80));

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  try {
    // Create a simple test batch with one request
    const testRequest = {
      custom_id: "test-request-1",
      method: "POST",
      url: "/v1/chat/completions",
      body: {
        model: "gpt-4o-mini-2024-07-18",
        messages: [
          { role: "user", content: "Say 'test successful'" }
        ],
        max_tokens: 10
      }
    };

    const jsonlContent = JSON.stringify(testRequest);

    console.log('\n📝 Test Request:');
    console.log(JSON.stringify(testRequest, null, 2));

    // Step 1: Upload file
    console.log('\n📤 Uploading test file to OpenAI...');
    const buffer = Buffer.from(jsonlContent, 'utf-8');
    const file = await openai.files.create({
      file: new File([buffer], 'test-batch.jsonl', { type: 'application/jsonl' }),
      purpose: 'batch'
    });

    console.log('✅ File uploaded successfully');
    console.log('File ID:', file.id);
    console.log('File object:', JSON.stringify(file, null, 2));

    // Step 2: Create batch
    console.log('\n🚀 Creating batch job...');
    const batch = await openai.batches.create({
      input_file_id: file.id,
      endpoint: '/v1/chat/completions',
      completion_window: '24h',
      metadata: {
        test: 'true'
      }
    });

    console.log('✅ Batch created successfully');
    console.log('\n📦 Batch Response:');
    console.log(JSON.stringify(batch, null, 2));

    console.log('\n🔍 Key Fields:');
    console.log('Batch ID:', batch.id);
    console.log('Batch ID Type:', typeof batch.id);
    console.log('Batch ID Length:', batch.id.length);
    console.log('Status:', batch.status);
    console.log('Input File ID:', batch.input_file_id);

    // Validate batch ID format
    const batchIdPattern = /^batch_[a-zA-Z0-9_-]{20,}$/;
    const isValid = batchIdPattern.test(batch.id);

    console.log('\n✓ Batch ID Format Validation:');
    console.log('Pattern test:', isValid ? 'PASS' : 'FAIL');
    console.log('Expected format: batch_<alphanumeric>');
    console.log('Actual format:', batch.id);

    // Clean up: Cancel the batch to avoid charges
    console.log('\n🧹 Cancelling test batch...');
    try {
      await openai.batches.cancel(batch.id);
      console.log('✅ Test batch cancelled');
    } catch (cancelError) {
      console.log('⚠️  Could not cancel batch (might already be processing):', cancelError.message);
    }

  } catch (error) {
    console.error('\n❌ Error during test:');
    console.error('Message:', error.message);
    if (error.response) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }
    if (error.stack) {
      console.error('\nStack trace:', error.stack);
    }
  }
}

testOpenAIBatchSubmission().catch(console.error);

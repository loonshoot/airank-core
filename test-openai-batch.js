const OpenAI = require('openai');

async function testBatchSubmission() {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  console.log('Testing OpenAI batch submission...\n');

  const jsonlContent = JSON.stringify({
    custom_id: "test-request-1",
    method: "POST",
    url: "/v1/chat/completions",
    body: {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Say hello!" }],
      max_tokens: 10
    }
  });

  try {
    // Upload file
    const buffer = Buffer.from(jsonlContent, 'utf-8');
    console.log('Uploading file...');
    const file = await openai.files.create({
      file: new File([buffer], 'test-batch.jsonl', { type: 'application/jsonl' }),
      purpose: 'batch'
    });
    console.log('✓ File uploaded:', file.id);

    // Create batch
    console.log('\nCreating batch...');
    const batch = await openai.batches.create({
      input_file_id: file.id,
      endpoint: '/v1/chat/completions',
      completion_window: '24h'
    });

    console.log('✓ Batch created successfully!');
    console.log('Batch ID:', batch.id);
    console.log('Status:', batch.status);
    console.log('\nFull response:');
    console.log(JSON.stringify(batch, null, 2));

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

testBatchSubmission();

const OpenAI = require('openai');

async function testError() {
  const openai = new OpenAI({
    apiKey: 'sk-invalid-key-test'  // Invalid key
  });

  try {
    const batch = await openai.batches.create({
      input_file_id: 'file-invalid',
      endpoint: '/v1/chat/completions',
      completion_window: '24h'
    });
    
    console.log('Batch:', batch);
    console.log('Batch ID:', batch.id);
  } catch (error) {
    console.log('Error caught:', error.message);
    console.log('Error type:', error.constructor.name);
    console.log('Has response:', !!error.response);
  }
}

testError();

const OpenAI = require('openai');

async function checkAPIKey() {
  console.log('🔑 Checking OpenAI API Key Configuration');
  
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    console.log('❌ No API key found');
    return;
  }
  
  console.log('API Key prefix:', apiKey.substring(0, 7) + '...');
  console.log('API Key length:', apiKey.length);
  
  const openai = new OpenAI({ apiKey });
  
  // Test 1: List models (basic API access)
  try {
    const models = await openai.models.list();
    console.log('✅ Can list models:', models.data.length, 'models found');
  } catch (error) {
    console.log('❌ Cannot list models:', error.message);
  }
  
  // Test 2: List batches
  try {
    const batches = await openai.batches.list({ limit: 5 });
    console.log('✅ Can list batches:', batches.data.length, 'batches found');
    
    if (batches.data.length > 0) {
      console.log('\nMost recent batch:');
      const latest = batches.data[0];
      console.log('  ID:', latest.id);
      console.log('  Created:', new Date(latest.created_at * 1000).toISOString());
      console.log('  Status:', latest.status);
    }
  } catch (error) {
    console.log('❌ Cannot list batches:', error.message);
  }
  
  // Test 3: Check organization
  try {
    // Try to get account info via a simple API call
    const files = await openai.files.list({ limit: 1 });
    console.log('✅ Can access files API');
  } catch (error) {
    console.log('❌ Cannot access files:', error.message);
  }
}

checkAPIKey().catch(console.error);

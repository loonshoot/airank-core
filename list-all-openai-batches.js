const OpenAI = require('openai');

async function listAllBatches() {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  console.log('📋 Listing ALL OpenAI Batches');
  console.log('Time:', new Date().toISOString());
  console.log('=' .repeat(80));

  try {
    // List all batches with a high limit to see everything
    const list = await openai.batches.list({ limit: 100 });

    console.log('\n✅ Retrieved batch list');
    console.log('Total batches found:', list.data.length);
    console.log('Has more:', list.has_more);

    if (list.data.length === 0) {
      console.log('\n⚠️  NO BATCHES FOUND IN OPENAI');
      console.log('This means no batches have ever been successfully created in this OpenAI account.');
    } else {
      console.log('\n📦 Batches:');
      list.data.forEach((batch, idx) => {
        console.log(`\n${idx + 1}. Batch ID: ${batch.id}`);
        console.log(`   Status: ${batch.status}`);
        console.log(`   Endpoint: ${batch.endpoint}`);
        console.log(`   Created: ${new Date(batch.created_at * 1000).toISOString()}`);
        console.log(`   Input File: ${batch.input_file_id}`);
        console.log(`   Output File: ${batch.output_file_id || 'N/A'}`);
        console.log(`   Request Counts:`, batch.request_counts);

        if (batch.metadata) {
          console.log(`   Metadata:`, batch.metadata);
        }

        if (batch.completed_at) {
          console.log(`   Completed: ${new Date(batch.completed_at * 1000).toISOString()}`);
        }

        if (batch.failed_at) {
          console.log(`   Failed: ${new Date(batch.failed_at * 1000).toISOString()}`);
        }
      });
    }

    // Also list uploaded files to see if those exist
    console.log('\n\n📁 Listing Uploaded Files (for batch purpose):');
    const files = await openai.files.list({ purpose: 'batch' });
    console.log('Total batch files found:', files.data.length);

    if (files.data.length > 0) {
      console.log('\nFiles:');
      files.data.slice(0, 10).forEach((file, idx) => {
        console.log(`\n${idx + 1}. File ID: ${file.id}`);
        console.log(`   Filename: ${file.filename}`);
        console.log(`   Created: ${new Date(file.created_at * 1000).toISOString()}`);
        console.log(`   Bytes: ${file.bytes}`);
        console.log(`   Status: ${file.status}`);
      });
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

listAllBatches().catch(console.error);

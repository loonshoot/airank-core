const OpenAI = require('openai');

async function checkOpenAIBatches() {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  // Recent batch IDs from the logs
  const batchIds = [
    'batch_690f7e6f1c208190a9e4300eea79f21e', // Most recent (submitted 5 min ago)
    'batch_690f7ccc985c8190812dcd0aacb199e7', // Previous test
    'batch_690f7cbc87b08190895d6c8d77d4f916', // Earlier test
  ];

  console.log('🔍 Checking OpenAI Batch Status via API');
  console.log('Time:', new Date().toISOString());
  console.log('=' .repeat(80));

  for (const batchId of batchIds) {
    console.log('\n📦 Batch ID:', batchId);

    try {
      const batch = await openai.batches.retrieve(batchId);

      console.log('   ✅ Status:', batch.status);
      console.log('   Request Counts:');
      console.log('      Total:', batch.request_counts?.total || 0);
      console.log('      Completed:', batch.request_counts?.completed || 0);
      console.log('      Failed:', batch.request_counts?.failed || 0);

      console.log('   Timing:');
      console.log('      Created:', new Date(batch.created_at * 1000).toISOString());

      if (batch.in_progress_at) {
        console.log('      In Progress:', new Date(batch.in_progress_at * 1000).toISOString());
      }

      if (batch.completed_at) {
        console.log('      Completed:', new Date(batch.completed_at * 1000).toISOString());
        const duration = batch.completed_at - batch.created_at;
        console.log('      Duration:', Math.floor(duration / 60), 'minutes', duration % 60, 'seconds');
      }

      if (batch.failed_at) {
        console.log('      Failed:', new Date(batch.failed_at * 1000).toISOString());
      }

      console.log('   Files:');
      console.log('      Input:', batch.input_file_id);
      console.log('      Output:', batch.output_file_id || 'N/A');
      console.log('      Error:', batch.error_file_id || 'N/A');

      if (batch.errors && batch.errors.data && batch.errors.data.length > 0) {
        console.log('   ❌ Errors:');
        batch.errors.data.forEach((error, i) => {
          console.log('      ' + (i + 1) + '.', error.message);
        });
      }

    } catch (error) {
      console.log('   ❌ Error:', error.message);
      if (error.status === 404) {
        console.log('      Batch does not exist in OpenAI (orphaned)');
      }
      if (error.response) {
        console.log('      Response:', error.response.data);
      }
    }
  }

  console.log('\n' + '=' .repeat(80));
  console.log('✅ Check complete');
}

checkOpenAIBatches().catch(console.error);

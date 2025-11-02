// Manually test the pollOpenAIBatches job
const pollJob = require('./config/jobs/pollOpenAIBatches');

const mockJob = {
  attrs: {
    data: {}
  }
};

console.log('🧪 Testing pollOpenAIBatches job...\n');

pollJob(mockJob, (error) => {
  if (error) {
    console.error('\n❌ Job failed:', error);
    process.exit(1);
  } else {
    console.log('\n✅ Job completed successfully!');
    process.exit(0);
  }
});

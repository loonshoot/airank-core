/**
 * test-salesforce-webhook.js
 * 
 * Utility to test Salesforce webhook events by sending sample data to the API
 */

require('dotenv').config();
const axios = require('axios');
const redis = require('redis');

// Key for retrieving the URL from Redis
const NGROK_URL_KEY = 'outrun:dev:ngrok:url';

// Sample Salesforce CDC event (Change Data Capture)
const sampleCDCEvent = {
  events: [
    {
      replayId: Date.now().toString(),
      channelName: '/event/AccountChangeEvent',
      source: 'outrun_' + (process.argv[2] || 'source123') + '_' + (process.argv[3] || 'workspace123'),
      data: {
        schema: '6sTsYQrfRt7Z4eEy/qX8iw',
        payload: {
          Id: 'a01B000001XyzABC',
          Name: 'Sample Account Updated',
          Industry: 'Technology',
          Phone: '555-1234',
          Website: 'https://example.com',
          LastModifiedDate: new Date().toISOString(),
          ChangeEventHeader: {
            entityName: 'Account',
            changeType: 'UPDATE',
            recordIds: ['001xx000003DGXyAAO'],
            commitNumber: 12345678,
            commitUser: '005xx000001X8UTAA0',
            commitTimestamp: Date.now(),
            diffFields: ['Name', 'Industry']
          }
        }
      }
    }
  ]
};

async function getWebhookUrl() {
  // First check environment variable from start-dev.js
  if (process.env.NGROK_URL) {
    console.log('📝 Using NGROK_URL from environment:', process.env.NGROK_URL);
    return process.env.NGROK_URL;
  }
  
  // Then try Redis
  if (process.env.REDIS_URL) {
    try {
      const redisClient = redis.createClient({ url: process.env.REDIS_URL });
      await redisClient.connect();
      
      const url = await redisClient.get(NGROK_URL_KEY);
      await redisClient.quit();
      
      if (url) {
        console.log('📝 Using URL from Redis:', url);
        return url;
      }
    } catch (error) {
      console.warn('⚠️ Redis error:', error.message);
    }
  }

  // If both fail, use APP_URL environment variable
  if (process.env.APP_URL) {
    console.log('📝 Using URL from APP_URL:', process.env.APP_URL);
    return process.env.APP_URL;
  }

  // Last resort fallback
  console.log('⚠️ No URL found in environment or Redis, using localhost:3001');
  return 'http://localhost:3001';
}

async function sendWebhookTest() {
  try {
    // Get the webhook URL from Redis or environment
    const baseUrl = await getWebhookUrl();
    const webhookUrl = `${baseUrl}/api/v1/webhook/salesforce`;

    console.log(`\n🚀 Sending test Salesforce webhook event to: ${webhookUrl}`);
    
    // If this is localhost, warn the user
    if (baseUrl.includes('localhost')) {
      console.log('\n⚠️ Using localhost URL - external webhooks won\'t be able to reach this endpoint!');
      console.log('Add NGROK_AUTHTOKEN to your .env file to enable external webhook testing.\n');
    }
    
    // Send the webhook
    const response = await axios.post(webhookUrl, sampleCDCEvent, {
      headers: {
        'Content-Type': 'application/json',
        'X-Salesforce-Source': 'outrun_test'
      }
    });
    
    console.log('\n✅ Webhook test sent successfully!');
    console.log(`Status: ${response.status}`);
    console.log('Response:', JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.error('\n❌ Error sending webhook test:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    } else if (error.code === 'ECONNREFUSED') {
      console.error('\n❌ Connection refused - make sure your API Gateway is running!');
      console.error('Start the API Gateway with: npm run dev');
    }
  }
}

// Run the test
sendWebhookTest();

// Usage instructions
console.log('\nUsage:');
console.log('  node scripts/test-salesforce-webhook.js [sourceId] [workspaceId]');
console.log('Example:');
console.log('  node scripts/test-salesforce-webhook.js source123 workspace123\n'); 
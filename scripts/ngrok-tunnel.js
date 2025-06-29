/**
 * ngrok-tunnel.js
 * 
 * Creates a public tunnel to the local API gateway for webhook testing
 * Stores the URL in Redis for other services to access
 */

require('dotenv').config();
const ngrok = require('ngrok');
const redis = require('redis');

// API Gateway port - should match what's in api-gateway
const API_PORT = process.env.API_GATEWAY_PORT || 4001;

// Redis setup - exit if not available
if (!process.env.REDIS_URL) {
  console.error('\n❌ REDIS_URL environment variable is required!');
  console.error('Add to .env file: REDIS_URL=redis://localhost:6379');
  process.exit(1);
}

// Redis client
const redisClient = redis.createClient({ url: process.env.REDIS_URL });

// Key for storing the URL in Redis
const NGROK_URL_KEY = 'airank:dev:ngrok:url';

async function main() {
  try {
    // Connect to Redis
    await redisClient.connect();
    console.log('✅ Connected to Redis');

    // Check for auth token
    if (!process.env.NGROK_AUTHTOKEN) {
      console.error('\n❌ NGROK_AUTHTOKEN is required but not found in .env file!');
      console.error('=======================================================');
      console.error('1. Sign up at https://dashboard.ngrok.com/signup');
      console.error('2. Get your token at https://dashboard.ngrok.com/get-started/your-authtoken');
      console.error('3. Add to your .env file: NGROK_AUTHTOKEN=your_token_here');
      console.error('4. Restart the dev environment');
      console.error('=======================================================');
      
      // Store a fallback URL in Redis
      const fallbackUrl = process.env.APP_URL || 'http://localhost:4001';
      await redisClient.set(NGROK_URL_KEY, fallbackUrl, { EX: 8 * 60 * 60 });
      console.log(`Using fallback URL: ${fallbackUrl}`);
      
      await redisClient.quit();
      process.exit(1);
    }

    // Start ngrok with auth token
    console.log(`🚀 Starting ngrok tunnel to localhost:${API_PORT}...`);
    
    const url = await ngrok.connect({
      addr: API_PORT,
      authtoken: process.env.NGROK_AUTHTOKEN,
      region: 'us',
      onStatusChange: status => {
        console.log(`🔔 Ngrok status changed: ${status}`);
      },
      onLogEvent: log => {
        if (log.includes('error') || log.includes('warn')) {
          console.log(`⚠️ Ngrok log: ${log}`);
        }
      }
    });

    console.log(`\n=================================================`);
    console.log(`🎉 Ngrok tunnel established!`);
    console.log(`🌐 Public URL: ${url}`);
    console.log(`=================================================\n`);

    // Store URL in Redis (with 8 hour expiry)
    await redisClient.set(NGROK_URL_KEY, url, { EX: 8 * 60 * 60 });
    console.log(`✅ URL stored in Redis at key: ${NGROK_URL_KEY}`);

    // Print webhook URLs for various services
    console.log(`\n=================================================`);
    console.log(`📌 Webhook URLs for services:`);
    console.log(`Salesforce: ${url}/api/v1/webhook/salesforce`);
    console.log(`Hubspot:    ${url}/api/v1/webhook/hubspot`);
    console.log(`Generic:    ${url}/api/v1/webhook/generic`);
    console.log(`=================================================\n`);

    // Keep the process alive
    console.log('🔄 Tunnel will remain active while dev environment is running...');
    
    // Handle process termination
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    
  } catch (error) {
    console.error('❌ Error starting ngrok:', error);
    await cleanup();
    process.exit(1);
  }
}

async function cleanup() {
  console.log('\n🛑 Shutting down ngrok tunnel...');
  try {
    await ngrok.kill();
    console.log('✅ Ngrok tunnel closed');
    
    // Remove URL from Redis
    if (redisClient.isReady) {
      await redisClient.del(NGROK_URL_KEY);
      await redisClient.quit();
      console.log('✅ Cleaned up Redis');
    }
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
  }
}

// Start the tunnel
main().catch(console.error); 
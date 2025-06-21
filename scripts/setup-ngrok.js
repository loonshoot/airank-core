/**
 * setup-ngrok.js
 * 
 * Script to help set up ngrok and environment variables
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { exec } = require('child_process');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const envFilePath = path.join(__dirname, '..', '.env');
const envExamplePath = path.join(__dirname, '..', '.env.example');

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function main() {
  console.log('\n=================================================');
  console.log('🚀 AI Rank Ngrok Setup Assistant');
  console.log('=================================================\n');

  console.log('This script will help you set up ngrok for webhook testing.\n');

  // Check if ngrok is installed globally
  try {
    console.log('Checking if ngrok is installed...');
    await execCommand('npx ngrok --version');
    console.log('✅ ngrok is installed\n');
  } catch (error) {
    console.log('❌ ngrok not found globally, checking local installation...');
    
    try {
      await execCommand('npx ngrok --version');
      console.log('✅ ngrok is installed via npx\n');
    } catch (error) {
      console.log('❌ ngrok is not installed. Installing...');
      try {
        await execCommand('npm install -g ngrok');
        console.log('✅ ngrok installed globally\n');
      } catch (error) {
        console.error('❌ Failed to install ngrok. Please install it manually:');
        console.error('npm install -g ngrok');
        process.exit(1);
      }
    }
  }

  // Check if .env file exists
  const envExists = fs.existsSync(envFilePath);
  let env = {};

  if (envExists) {
    console.log('Found existing .env file, loading settings...');
    const envContent = fs.readFileSync(envFilePath, 'utf8');
    env = parseEnvFile(envContent);
  } else {
    console.log('No .env file found, creating a new one...');
  }

  // Get ngrok auth token
  const authToken = env.NGROK_AUTHTOKEN || await askQuestion(
    'Enter your ngrok auth token (from https://dashboard.ngrok.com/get-started/your-authtoken): '
  );

  if (!authToken) {
    console.log('\n❌ Auth token is required. Please sign up at https://dashboard.ngrok.com/signup');
    console.log('Then get your token at https://dashboard.ngrok.com/get-started/your-authtoken');
    process.exit(1);
  }

  // Get Redis URL
  const redisUrl = env.REDIS_URL || await askQuestion(
    'Enter Redis URL (default: redis://localhost:6379): '
  ) || 'redis://localhost:6379';

  // Get API Gateway port
  const apiPort = env.API_GATEWAY_PORT || await askQuestion(
    'Enter API Gateway port (default: 3001): '
  ) || '3001';

  // Get App URL
  const appUrl = env.APP_URL || await askQuestion(
    'Enter App URL (default: http://localhost:3001): '
  ) || 'http://localhost:3001';

  // Create .env content
  const envContent = [
    '# Ngrok configuration',
    `NGROK_AUTHTOKEN=${authToken}`,
    '',
    '# Redis configuration',
    `REDIS_URL=${redisUrl}`,
    '',
    '# API Gateway configuration',
    `API_GATEWAY_PORT=${apiPort}`,
    `APP_URL=${appUrl}`,
    '',
    '# Keep existing values',
    ...Object.entries(env)
      .filter(([key]) => !['NGROK_AUTHTOKEN', 'REDIS_URL', 'API_GATEWAY_PORT', 'APP_URL'].includes(key))
      .map(([key, value]) => `${key}=${value}`),
  ].join('\n');

  // Write to .env file
  fs.writeFileSync(envFilePath, envContent);
  console.log('\n✅ .env file updated with ngrok settings');

  // Also create example file if it doesn't exist
  if (!fs.existsSync(envExamplePath)) {
    const exampleContent = [
      '# Ngrok configuration',
      'NGROK_AUTHTOKEN=your_ngrok_authtoken_here',
      '',
      '# Redis configuration',
      'REDIS_URL=redis://localhost:6379',
      '',
      '# API Gateway configuration',
      'API_GATEWAY_PORT=3001',
      'APP_URL=http://localhost:3001',
      '',
      '# MongoDB configuration',
      'MONGODB_URI=mongodb://localhost:27017',
      'MONGODB_PARAMS=retryWrites=true&w=majority',
      '',
      '# Salesforce configuration',
      'SALESFORCE_CLIENT_ID=your_client_id_here',
      'SALESFORCE_CLIENT_SECRET=your_client_secret_here',
      'CRYPTO_SECRET=32_character_hex_string_for_encryption',
    ].join('\n');
    
    fs.writeFileSync(envExamplePath, exampleContent);
    console.log('✅ .env.example file created');
  }

  console.log('\n=================================================');
  console.log('🎉 Setup complete!');
  console.log('=================================================');
  console.log('\nYou can now run the development environment with:');
  console.log('npm run dev');
  console.log('\nOr just start ngrok with:');
  console.log('npm run ngrok');
  console.log('=================================================\n');

  rl.close();
}

function parseEnvFile(content) {
  const env = {};
  const lines = content.split('\n');
  
  for (const line of lines) {
    // Skip comments and empty lines
    if (line.startsWith('#') || !line.trim()) continue;
    
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      env[key.trim()] = value.trim();
    }
  }
  
  return env;
}

function execCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

main().catch(error => {
  console.error('Error:', error);
  rl.close();
  process.exit(1);
}); 
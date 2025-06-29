/**
 * start-dev.js
 * 
 * Start development environment with ngrok support
 * - Starts ngrok
 * - Starts all other services with the ngrok URL as environment variable
 */

require('dotenv').config();
const { spawn, exec } = require('child_process');
const ngrok = require('ngrok');
const path = require('path');

// API Gateway port
const API_PORT = process.env.API_GATEWAY_PORT || 4001;

// Colors for console output
const colors = {
  ngrok: '\x1b[37m',    // white
  api: '\x1b[36m',      // cyan
  batcher: '\x1b[32m',  // green
  graphql: '\x1b[33m',  // yellow
  listener: '\x1b[34m', // blue
  stream: '\x1b[35m',   // magenta
  reset: '\x1b[0m'      // reset
};

// Track child processes to kill on exit
const childProcesses = [];

// Handle shutdown
function cleanup() {
  console.log('\nShutting down all services...');
  
  // Kill ngrok if it's running
  try {
    ngrok.kill();
    console.log('Ngrok tunnel closed');
  } catch (error) {
    console.error('Error shutting down ngrok:', error.message);
  }
  
  // Kill all child processes
  childProcesses.forEach(process => {
    try {
      process.kill();
    } catch (err) {
      // Ignore errors when killing processes
    }
  });
  
  process.exit(0);
}

// Set up process handlers
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Helper to create a prefixed logger
function createLogger(serviceName) {
  const color = colors[serviceName] || colors.reset;
  return (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        console.log(`${color}[${serviceName}]${colors.reset} ${line}`);
      }
    });
  };
}

// Start a service with environment variables
function startService(name, command, args, env = {}) {
  console.log(`Starting ${name}...`);
  
  const options = {
    env: { ...process.env, ...env },
    shell: true
  };
  
  const proc = spawn(command, args, options);
  childProcesses.push(proc);
  
  const logger = createLogger(name);
  proc.stdout.on('data', logger);
  proc.stderr.on('data', logger);
  
  proc.on('error', (error) => {
    console.error(`${colors[name]}[${name}]${colors.reset} Failed to start: ${error.message}`);
  });
  
  proc.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`${colors[name]}[${name}]${colors.reset} exited with code ${code}`);
    }
  });
  
  return proc;
}

async function main() {
  console.log('\n=================================================');
  console.log('🚀 Starting AI Rank Development Environment');
  console.log('=================================================\n');
  
  // Set up ngrok URL if available
  let ngrokUrl = null;
  if (process.env.NGROK_AUTHTOKEN) {
    try {
      console.log(`${colors.ngrok}[ngrok]${colors.reset} Starting tunnel to localhost:${API_PORT}...`);
      
      ngrokUrl = await ngrok.connect({
        addr: API_PORT,
        authtoken: process.env.NGROK_AUTHTOKEN,
        region: 'us'
      });
      
      console.log(`${colors.ngrok}[ngrok]${colors.reset} Tunnel established at: ${ngrokUrl}`);
      console.log(`${colors.ngrok}[ngrok]${colors.reset} Webhook URLs:`);
      console.log(`${colors.ngrok}[ngrok]${colors.reset} Salesforce: ${ngrokUrl}/api/v1/webhook/salesforce`);
      console.log(`${colors.ngrok}[ngrok]${colors.reset} Hubspot: ${ngrokUrl}/api/v1/webhook/hubspot`);
    } catch (error) {
      console.error(`${colors.ngrok}[ngrok]${colors.reset} Error starting tunnel: ${error.message}`);
      console.log(`${colors.ngrok}[ngrok]${colors.reset} Continuing without ngrok - external webhooks won't work`);
    }
  } else {
    console.log(`${colors.ngrok}[ngrok]${colors.reset} NGROK_AUTHTOKEN not found in .env, skipping tunnel setup`);
    console.log(`${colors.ngrok}[ngrok]${colors.reset} Add NGROK_AUTHTOKEN to enable external webhook testing`);
  }
  
  // Environment to pass to all services
  const serviceEnv = {};
  if (ngrokUrl) {
    serviceEnv.NGROK_URL = ngrokUrl;
  }
  
  // Start services
  startService('api', 'cd', ['api-gateway', '&&', 'npm', 'run', 'dev'], serviceEnv);
  startService('batcher', 'cd', ['batcher', '&&', 'npm', 'run', 'dev'], serviceEnv);
  startService('graphql', 'cd', ['graphql', '&&', 'npm', 'run', 'dev'], serviceEnv);
  startService('listener', 'cd', ['listener', '&&', 'npm', 'run', 'dev'], serviceEnv);
  startService('stream', 'cd', ['stream', '&&', 'npm', 'run', 'dev'], serviceEnv);
  
  console.log('\n=================================================');
  console.log('✅ All services started');
  console.log('=================================================\n');
}

// Start everything
main().catch(error => {
  console.error('Error in start-dev script:', error);
  cleanup();
}); 
#!/usr/bin/env node

const { setupGCPCredentials } = require('../config/gcp-credentials');
const ListenerManager = require('./src/listener-manager');

// Setup GCP credentials from environment variable (for Dokploy/Docker)
setupGCPCredentials();

async function main() {
  console.log('🚀 Starting AIRank Listener Service...');

  const manager = new ListenerManager();

  // Handle shutdown signals
  const shutdown = async (signal) => {
    console.log(`\n📡 Received ${signal}, shutting down gracefully...`);
    await manager.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught exception:', error);
    shutdown('uncaughtException').then(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled rejection at:', promise, 'reason:', reason);
    shutdown('unhandledRejection').then(() => process.exit(1));
  });

  try {
    // Initialize and start listeners
    await manager.initialize();
    await manager.startListeners();

    console.log('✅ AIRank Listener Service is running');
    console.log('📡 Monitoring workspace databases for batch completion events');
    console.log('🔴 Press Ctrl+C to stop\n');

  } catch (error) {
    console.error('💥 Failed to start listener service:', error);
    await manager.shutdown();
    process.exit(1);
  }
}

// Start the service
main();

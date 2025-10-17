#!/usr/bin/env node

/**
 * MongoDB Cleanup Script
 * 
 * This script removes specified collections from MongoDB databases
 * for development and testing purposes.
 * 
 * CAUTION: This is a DESTRUCTIVE operation and will permanently delete data!
 */

const { MongoClient } = require('mongodb');
const readline = require('readline');

// Database connection configurations
const WORKSPACE_DB = 'workspace_6824f4a47c8028d89b6ff8d6';
const OUTRUN_DB = 'airank';
const MONGO_URI = 'mongodb://localhost:27017';

// Collections to be dropped
const SPECIFIC_COLLECTIONS = ['sources', 'logs', 'jobHistory', 'jobhistories', 'people', 'relationships', 'organizations', 'facts', 'searchanalytics', 'destinations'];

// Create readline interface for user confirmation
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Initialize counters
let droppedCount = 0;
let sourceCollectionsCount = 0;

/**
 * Drop a specific collection with error handling
 */
async function dropCollection(db, collectionName) {
  try {
    const collections = await db.listCollections().toArray();
    const collectionExists = collections.some(col => col.name === collectionName);
    
    if (collectionExists) {
      console.log(`Dropping collection: ${collectionName}`);
      await db.dropCollection(collectionName);
      droppedCount++;
      return true;
    } else {
      console.log(`Collection ${collectionName} doesn't exist - skipping`);
      return false;
    }
  } catch (error) {
    console.error(`Error dropping collection ${collectionName}:`, error.message);
    return false;
  }
}

/**
 * Main cleanup function
 */
async function cleanup() {
  let client;
  
  try {
    // Connect to MongoDB
    client = new MongoClient(MONGO_URI);
    await client.connect();
    console.log('Connected to MongoDB');
    
    // Get workspace database
    const workspaceDb = client.db(WORKSPACE_DB);
    console.log(`Connected to database: ${WORKSPACE_DB}`);
    
    // Get all collections
    const collections = await workspaceDb.listCollections().toArray();
    console.log(`Found ${collections.length} collections in the database`);
    
    // Drop specific collections
    console.log('\n--- Dropping specific collections ---');
    for (const collName of SPECIFIC_COLLECTIONS) {
      await dropCollection(workspaceDb, collName);
    }
    
    // Drop all collections that start with "source_"
    console.log('\n--- Dropping source_* collections ---');
    for (const collection of collections) {
      if (collection.name.startsWith('source_')) {
        const dropped = await dropCollection(workspaceDb, collection.name);
        if (dropped) sourceCollectionsCount++;
      }
    }
    
    // Switch to airank database and clear shared collections
    console.log('\n--- Switching to airank database to clear shared collections ---');
    const airankDb = client.db(OUTRUN_DB);
    console.log(`Connected to database: ${OUTRUN_DB}`);

    // Clear jobs collection
    await dropCollection(airankDb, 'jobs');
    // Clear listener collection
    await dropCollection(airankDb, 'listeners');

    // Clear billing-related collections
    console.log('\n--- Clearing billing-related collections ---');
    await dropCollection(airankDb, 'billingprofiles');
    await dropCollection(airankDb, 'billingprofilemembers');

    // Clear workspace-related collections
    console.log('\n--- Clearing workspace-related collections ---');
    await dropCollection(airankDb, 'workspaces');
    await dropCollection(airankDb, 'members'); 
    
    // Summary
    console.log('\n--- Summary ---');
    console.log(`Total collections dropped: ${droppedCount}`);
    console.log(`Source collections dropped: ${sourceCollectionsCount}`);
    console.log(`Other collections dropped: ${droppedCount - sourceCollectionsCount}`);
    console.log('\nOperation completed successfully.');
    
  } catch (error) {
    console.error('Error during cleanup:', error);
  } finally {
    if (client) {
      await client.close();
      console.log('MongoDB connection closed');
    }
    process.exit(0);
  }
}

// Ask for confirmation before proceeding
console.log('=== MongoDB Cleanup Script ===');
console.log('WARNING: This will permanently delete data from your MongoDB databases!');
console.log(`Database targets: ${WORKSPACE_DB} and ${OUTRUN_DB}`);
console.log(`Collections to remove from ${WORKSPACE_DB}: ${SPECIFIC_COLLECTIONS.join(', ')}, and all source_* collections`);
console.log(`Collections to remove from ${OUTRUN_DB}: jobs, listeners, billingprofiles, billingprofilemembers, workspaces, members`);
console.log('');

rl.question('Are you sure you want to continue? (y/n): ', (answer) => {
  rl.close();
  
  if (answer.toLowerCase() === 'y') {
    console.log('Starting cleanup process...');
    cleanup();
  } else {
    console.log('Operation cancelled.');
    process.exit(0);
  }
}); 
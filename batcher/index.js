// /batcher/src/index.js

const Agenda = require('agenda');
const fs = require('fs').promises;
const path = require('path');
const config = require('@airank/config');
require('dotenv').config(); // Load environment variables from .env
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const crypto = require('crypto');
const axios = require('axios'); 
const redis = require('redis'); // Import redis

// Create Redis client
const redisClient = redis.createClient({
    url: process.env.REDIS_URL // Use your Redis connection string here
});
redisClient.connect();

redisClient.on('error', (err) => {
  console.error('Redis connection error:', err);
});

redisClient.on('connect', () => {
  console.log('Connected to Redis!');
});

const mongoUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;

// Create Agenda instance
const agenda = new Agenda({ db: { address: mongoUri, collection: 'jobs' }, lockLimit: 5 });

// Configure lockLimit and maxConcurrency
agenda.lockLimit(5);
agenda.maxConcurrency(5);

// Function to recursively discover jobs
async function discoverJobs(directory) {
  const jobs = {};
  
  // console.log(`Starting job discovery in directory: ${directory}`);
  
  async function scanDirectory(dir) {
    try {
      // console.log(`Scanning directory: ${dir}`);
      
      // Read all items in directory
      const items = await fs.readdir(dir, { withFileTypes: true });
      // console.log(`Found ${items.length} items in ${dir}`);
      
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        
        if (item.isDirectory()) {
          // Recursively scan subdirectories
          await scanDirectory(fullPath);
        } else if (item.isFile() && item.name.endsWith('.js')) {
          // Any .js file is a potential job
          const jobName = path.basename(item.name, '.js');
          
          jobs[jobName] = {
            path: fullPath,
            config: {} // Default empty config
          };
          
          // console.log(`Found job file at ${fullPath}, registering as ${jobName}`);
          
          // Try to find a matching config JSON file with the same base name
          try {
            const configPath = path.join(path.dirname(fullPath), `${jobName}.json`);
            await fs.access(configPath);
            const configContent = await fs.readFile(configPath, 'utf8');
            jobs[jobName].config = JSON.parse(configContent);
            // console.log(`Loaded config for job ${jobName}`);
          } catch (configError) {
            // Config file is optional
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dir}:`, error);
    }
  }
  
  await scanDirectory(directory);
  // console.log(`Completed job discovery in ${directory}, found ${Object.keys(jobs).length} jobs`);
  return jobs;
}

// Initialize jobs
async function initializeJobs() {
  try {
    // Only scan the dedicated jobs directory
    const jobsPath = path.join(__dirname, 'config', 'jobs');

    console.log('Discovering jobs in jobs directory:', jobsPath);

    let allJobs = {};
    if (await pathExists(jobsPath)) {
      allJobs = await discoverJobs(jobsPath);
      console.log(`Discovered ${Object.keys(allJobs).length} dedicated jobs`);
    } else {
      console.warn(`Jobs path does not exist: ${jobsPath}`);
    }
    
    console.log(`Total jobs to register: ${Object.keys(allJobs).length}`);
    
    // Register each discovered job with Agenda
    for (const [jobName, jobInfo] of Object.entries(allJobs)) {
      try {
        const jobModule = require(jobInfo.path);
        
        agenda.define(jobName, { concurrency: 1, lockLifetime: 600000 }, async (job, done) => {
          try {
            // Make Redis client available to job without storing in attrs
            job.redisClient = redisClient;
            // Make agenda instance available to job
            job.agenda = agenda;
            
            // Handle both module formats:
            // 1. module.exports = function(job, done) {...}
            // 2. module.exports = { job: function(job, done) {...} }
            if (typeof jobModule === 'function') {
              await jobModule(job, done);
            } else if (typeof jobModule.job === 'function') {
              await jobModule.job(job, done);
            } else {
              throw new Error(`Job module ${jobName} does not export a valid job function`);
            }
          } catch (error) {
            console.error(`Error in ${jobName}:`, error);
            job.fail(error);
            done(error);
          }
        });
        
        console.log(`Successfully registered job: ${jobName}`);
      } catch (error) {
        console.error(`Error loading and registering job ${jobName}:`, error);
      }
    }
    
    // Start agenda once all jobs are registered
    await agenda.start();
    console.log('Batcher Ready');
    
  } catch (error) {
    console.error('Error initializing jobs:', error);
    process.exit(1);
  }
}

// Helper function to check if a path exists
async function pathExists(path) {
  try {
    await fs.access(path);
    return true;
  } catch (error) {
    return false;
  }
}

// Handle agenda events
agenda.on('ready', () => {
  initializeJobs().catch(error => {
    console.error('Failed to initialize jobs:', error);
    process.exit(1);
  });
});

agenda.on('error', (error) => {
  console.error('Agenda encountered an error:', error);
}); 
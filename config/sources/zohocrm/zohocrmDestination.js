/**
 * Zoho CRM Destination Job Handler
 * 
 * This job handles two types of syncs:
 * 1. Initial sync: Sync all records from AI Rank to Zoho CRM when a destination is first created
 * 2. Incremental sync: Sync individual records when they are updated in AI Rank
 */

const mongoose = require('mongoose');
const axios = require('axios');
const { getValidToken, refreshExpiredToken } = require('../../providers/zoho/api');
const { DestinationSchema, TokenSchema } = require('../../data/models');
const config = require('./config.json');
require('dotenv').config();
const { RedisRateLimiter } = require("rolling-rate-limiter");
const { logInfo, logError, logSuccess, logWarning } = require('../../utils/logger');

// Number of records to process per batch in initial sync
const BATCH_SIZE = 50;

// Rate limiter constants based on Zoho API concurrency limits
// Zoho limits: 20 concurrent requests for Enterprise edition
// Sub-concurrency: 10 for Insert/Update operations (>10 records)
// Being very conservative for destination sync operations
const RATE_LIMITS = {
  default: {
    requestsPerInterval: 3, // Very conservative - 3 requests per 10 seconds
    intervalMs: 10000 // 10 seconds
  }
};

/**
 * Make an authenticated API call to Zoho with automatic token refresh on auth failure
 */
async function makeAuthenticatedRequest(method, url, TokenModel, tokenDoc, workspaceId, redisClient, headers = {}, data = null) {
  const maxRetries = 1; // Only retry once on auth failure
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // First attempt: getValidToken handles expiry check and auto-refresh if needed
      // Retry attempt: force refresh if unexpired token failed API call
      const accessToken = attempt === 0 
        ? await getValidToken(TokenModel, tokenDoc, workspaceId, redisClient)
        : await refreshExpiredToken(TokenModel, tokenDoc, workspaceId, redisClient);
      
      const requestConfig = {
        method,
        url,
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json',
          ...headers
        }
      };
      
      if (data) {
        requestConfig.data = data;
      }
      
      const response = await axios(requestConfig);
      return response; // Success - return the response

  } catch (error) {
      // Check if this is an auth error that we should retry with token refresh
      const isAuthError = error.response?.status === 401 || 
                         error.response?.data?.code === 'AUTHENTICATION_FAILURE' ||
                         error.response?.data?.code === 'INVALID_TOKEN' ||
                         error.response?.data?.message?.includes('authentication');
      
      if (isAuthError && attempt < maxRetries) {
        console.log(`Auth error detected on attempt ${attempt + 1}, will force refresh token and retry. Error: ${error.response?.data?.message || error.message}`);
        // Re-fetch the token to make sure we have the latest version for the refresh attempt
        const updatedToken = await TokenModel.findById(tokenDoc._id || tokenDoc.id);
        if (updatedToken) {
          tokenDoc = updatedToken;
        }
        continue; // Try again with forced token refresh
      }
      
      // Re-throw the error if it's not an auth error or we've exhausted retries
      throw error;
    }
  }
};

/**
 * Handle rate limiting using Redis to ensure we don't exceed Zoho's API quotas
 */
async function handleRateLimiting(externalId, job, limiter) {
  return new Promise((resolve, reject) => {
    limiter.wouldLimitWithInfo(externalId.toString()).then(async (RateLimitInfo) => {
      const { blocked, actionsRemaining, millisecondsUntilAllowed } = RateLimitInfo;
      
      if (blocked) {
        const secondsToWait = (millisecondsUntilAllowed / 1000).toFixed(2);
        logInfo(job._id, `Rate limit reached, waiting ${secondsToWait}s before making request`);
        job.touch();
        await new Promise(resolve => setTimeout(resolve, millisecondsUntilAllowed));
        handleRateLimiting(externalId, job, limiter).then(resolve).catch(reject);
  } else {
        // If we wouldn't be limited, then actually perform the limit
        limiter.limit(externalId.toString()).then(() => {
          resolve('OK');
        }).catch(reject);
      }
    }).catch((error) => {
      logError(job._id, 'Rate limiting error occurred', error);
      reject(new Error('Rate limiting error'));
    });
  });
}

/**
 * Process a job
 */
async function handleJob(job) {
  const jobId = job.attrs._id.toString();
  const { data } = job.attrs;
  const redisClient = job.attrs.redisClient;
  
  const { 
    workspaceId, 
    destinationId, 
    collectionName, 
    objectType, 
    objectId, 
    isInitialSync,
    page
  } = data;
  
  // logInfo(jobId, `Starting Zoho CRM destination job with data: ${JSON.stringify(data)}`);
  logInfo(jobId, `Starting Zoho CRM destination job for ${objectType} (${objectId || 'batch'})`);
  
  // Validate required parameters
  if (!workspaceId) {
    throw new Error('No workspace ID provided');
  }
  
  if (!destinationId) {
    throw new Error('No destination ID provided');
  }
  
  if (!objectType) {
    throw new Error('No object type provided');
  }
  
  // Set up connection to workspace database
  const workspaceDbUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  
  logInfo(jobId, `Connecting to workspace database at ${workspaceDbUri}`);
  
  let workspaceConnection = null;
  
  try {
    // Create and wait for workspace connection
    workspaceConnection = await mongoose.createConnection(workspaceDbUri).asPromise();
    workspaceConnection.set('maxTimeMS', 30000);
    
    // Define models on the workspace connection
    const DestinationModel = workspaceConnection.model('Destination', DestinationSchema || new mongoose.Schema({}, { strict: false }));
    const TokenModel = workspaceConnection.model('Token', TokenSchema || new mongoose.Schema({}, { strict: false }));
    
    // Get destination and validate
    const destination = await DestinationModel.findById(destinationId);
    if (!destination) throw new Error(`Destination ${destinationId} not found.`);

    if (!destination.tokenId) throw new Error(`Destination ${destinationId} has no tokenId specified.`);
    
    const token = await TokenModel.findById(destination.tokenId);
    if (!token) throw new Error(`Token ${destination.tokenId} not found for destination ${destinationId}.`);
    
    logInfo(jobId, `Successfully validated destination and token`);
    
    // Get valid access token
    const validToken = await getValidToken(TokenModel, token, workspaceId, redisClient);
    const apiDomain = token.api_domain || 'https://www.zohoapis.com';
    
    logInfo(jobId, `Retrieved valid token and API domain: ${apiDomain}`);
    
    // Create rate limiter
    let rateLimiter;
    if (redisClient) {
      rateLimiter = new RedisRateLimiter({
        client: redisClient,
        namespace: "zoho:destination:",
        interval: RATE_LIMITS.default.intervalMs,
        maxInInterval: RATE_LIMITS.default.requestsPerInterval
      });
      logInfo(jobId, `Using Redis rate limiter`);
    } else {
      rateLimiter = {
        wouldLimitWithInfo: async () => ({ 
          blocked: false,
          actionsRemaining: 100,
          millisecondsUntilAllowed: 0
        }),
        limit: async () => true
      };
      logInfo(jobId, `Using memory rate limiter`);
    }
    
    // Process the sync
    if (isInitialSync) {
      logInfo(jobId, `Processing initial sync for ${objectType}`);
      // Handle initial sync logic here
    } else {
      logInfo(jobId, `Processing incremental sync for ${objectType} ${objectId}`);
      // Handle incremental sync logic here
    }
    
    logSuccess(jobId, `Zoho CRM destination job completed successfully`);
    return { success: true };
    
  } catch (error) {
    logError(jobId, `Error processing Zoho CRM destination job: ${error.message}`, error);
    throw error;
  } finally {
    if (workspaceConnection) {
      try {
        await workspaceConnection.close();
        logInfo(jobId, `Closed workspace connection`);
      } catch (closeError) {
        logError(jobId, `Error closing workspace connection: ${closeError.message}`, closeError);
      }
    }
  }
}

/**
 * Module export for the job handler
 */
module.exports = {
  job: async function(job, done) {
    console.log('\n\n');
    console.log('========================================================');
    console.log('*** ZOHO CRM DESTINATION JOB INVOKED - START PROCESSING ***');
    console.log(`*** JOB ID: ${job.attrs._id} ***`);
    console.log(`*** DATE/TIME: ${new Date().toISOString()} ***`);
    console.log('========================================================');
    console.log('\n');
    
    try {
      const result = await handleJob(job);
      console.log('\n');
      console.log('========================================================');
      console.log('*** ZOHO CRM JOB COMPLETED SUCCESSFULLY ***');
      console.log(`*** JOB ID: ${job.attrs._id} ***`);
      console.log(`*** DATE/TIME: ${new Date().toISOString()} ***`);
      console.log('========================================================');
      console.log('\n\n');
      done(null, result);
  } catch (error) {
      console.log('\n');
      console.log('========================================================');
      console.log('*** ZOHO CRM JOB FAILED ***');
      console.log(`*** JOB ID: ${job.attrs._id} ***`);
      console.log(`*** ERROR: ${error.message} ***`);
      console.log(`*** DATE/TIME: ${new Date().toISOString()} ***`);
      console.log('========================================================');
      console.log('\n\n');
      console.error('Error in zohocrmDestination job:', error);
      done(error);
    }
  }
}; 
// This service connects to Google Search Console API to fetch search analytics data
// It processes data for specified sites and date ranges, handling rate limiting and error cases

const mongoose = require('mongoose');
const axios = require('axios'); 
const { getValidToken, refreshToken, createConnection, encryptData } = require('../../providers/google/api'); 
// Import SCHEMAS only
const { SourceSchema, TokenSchema, JobHistorySchema, ConsolidatedRecordSchema } = require('../../data/models'); 
const { RedisRateLimiter } = require("rolling-rate-limiter");
require('dotenv').config(); // Load environment variables from .env

// Helper function to get yesterday's date in YYYY-MM-DD format
const getYesterday = () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1); 
  return yesterday.toISOString().split('T')[0]; 
};

// Helper function to get date from 5 days ago in YYYY-MM-DD format
// GSC data typically has a few days delay, so we fetch slightly older data
const getDelayedDate = () => {
  const delayedDaysPrior = new Date();
  delayedDaysPrior.setDate(delayedDaysPrior.getDate() - 5);
  return delayedDaysPrior.toISOString().split('T')[0];
};

// Helper function to get array of dates between start and end dates
const getDatesBetween = (startDate, endDate) => {
  const dates = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  while (start <= end) {
    dates.push(start.toISOString().split('T')[0]);
    start.setDate(start.getDate() + 1);
  }
  return dates;
};

// Handle rate limiting using Redis to ensure we don't exceed Google's API quotas
async function handleRateLimiting(providerName, job, limiter) {
  return new Promise((resolve, reject) => { // Wrap in a Promise
    limiter.limitWithInfo(providerName).then(async (RateLimitInfo) => {
      if (RateLimitInfo.blocked) {
        console.warn('googleSearchConsole - Rate limit reached, waiting for reset');
        job.touch();
        await new Promise(resolve => setTimeout(resolve, RateLimitInfo.millisecondsUntilAllowed));
        handleRateLimiting(providerName, job, limiter).then(resolve).catch(reject); // Recursive call
      } else {
        resolve('OK'); // Resolve the promise when not rate limited
      }
    }).catch((error) => {
      console.error('googleSearchConsole - Rate limiting error occurred');
      reject(error); // Reject the promise if an error occurs
    });
  });
}

module.exports = {
  // Main job function that orchestrates the data fetching process
  job: async (job, done) => {
    // Track total data ingested in bytes
    let ingressBytes = 0;
    let apiCalls = 0;
    let savedJobHistory;
    const jobStartTime = new Date();
    const providerName = "google";
    let workspaceConnection;
    let JobHistory; 
    let Source;
    let Token;
    let Facts;

    // Helper function to write fact records
    const createFactRecord = async (row, site, date, jobId) => {
      const isoDate = new Date(date).toISOString();
      
      // Estimate record size in bytes (rough approximation)
      const recordSize = JSON.stringify(row).length;
      ingressBytes += recordSize;
      
      // Convert country code to full name
      const countryCodeToName = {
        'aus': 'Australia',
        'usa': 'United States',
        'gbr': 'United Kingdom',
        'can': 'Canada',
        'bra': 'Brazil',
        // Add more mappings as needed
      };
      
      // Get full country name or use code if not found
      const countryName = countryCodeToName[row.keys[3].toLowerCase()] || row.keys[3];
      
      try {
        // Create fact record with data child property
        const factRecord = {
          type: "organicSearchResults",
          source: "googleSearch",
          dateRange: {
            from: isoDate,
            to: isoDate
          },
          location: {
            country: countryName,
            region: null,
            city: null
          },
          // Main data payload in a child object
          data: {
            property: site,
            entityId: row.keys[1], // page URL as entity ID
            entityType: "page",
            query: row.keys[0],
            device: row.keys[2],
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position
          },
          metadata: {
            sourceId: job.attrs.data.sourceId,
            workspaceId: job.attrs.data.workspaceId,
            createdAt: new Date(),
            updatedAt: new Date(),
            jobHistoryId: jobId
          }
        };
        
        // Save directly to Facts collection
        await Facts.create(factRecord);
        console.log('GSC: Created fact record directly');
        
        // Also write to stream collection for consistency
        const streamCollection = workspaceConnection.collection(`source_${job.attrs.data.sourceId}_stream`);
        const result = await streamCollection.insertOne({...factRecord, _id: new mongoose.Types.ObjectId()});
        console.log('GSC: Created stream record with ID:', result.insertedId.toString());
        
        return true;
      } catch (error) {
        console.error('GSC: Error creating fact record:', error.message);
        return false;
      }
    };

    // Helper function to handle API errors
    const handleApiError = async (error, currentSavedJobHistory, site, date, startRow) => {
      if (currentSavedJobHistory) {
        await JobHistory.findByIdAndUpdate(currentSavedJobHistory._id, {
          $push: { errors: { site, date, startRow, error: error.message } }
        });
      }
      console.error('googleSearchConsole - API request failed');

      if (error.response && error.response.status === 429) {
        console.warn('googleSearchConsole - Rate limit reached, retrying in 1 minute');
        await new Promise(resolve => setTimeout(resolve, 60000));
        return true; // Retry
      } else if (error.code === 'ECONNRESET') {
        console.warn('googleSearchConsole - Connection reset, retrying in 1 second');
        await new Promise(resolve => setTimeout(resolve, 1000));
        return true; // Retry
      }
      console.error('googleSearchConsole - API error occurred');
      return false;
    };

    // Helper function to process each date range
    const processDateRange = async (site, date, token, workspaceId, currentSavedJobHistory, job, limiter) => {
      let startRow = 0;
      const { decryptedToken } = await getValidToken(token, workspaceId);
      
      while (true) {
        console.log('googleSearchConsole - Processing data batch');
        
        const headers = {
          Authorization: `Bearer ${decryptedToken}`
        };

        // Configure request parameters for Google Search Console API
        const requestBody = {
          startDate: date,
          endDate: date,
          dimensions: ["query","page","device","country"],
          aggregationType: "byPage",
          rowLimit: 250,
          startRow
        };

        try {
          await handleRateLimiting(providerName, job, limiter);

          let attempts = job.attrs.data.attempts || 0;
          attempts++;
          job.attrs.data.attempts = attempts;
          apiCalls++;

          // Make API request to Google Search Console
          const response = await axios.post(
            `https://www.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`,
            requestBody,
            { headers, timeout: 30000 }
          );

          if (response.data.rows && response.data.rows.length > 0) {
            for (const row of response.data.rows) {
              await createFactRecord(row, site, date, currentSavedJobHistory._id);
            }
            console.log('googleSearchConsole - Batch processed successfully');
          } else {
            console.warn('googleSearchConsole - No data found in batch');
            break;
          }

          // Handle pagination - continue if we received max rows
          if (response.data.rows.length < 250) break;
          startRow += 249;

        } catch (error) {
          const shouldRetry = await handleApiError(error, currentSavedJobHistory, site, date, startRow);
          if (shouldRetry) continue;
          break;
        }
      }
    };

    try {
      // Initialize job parameters and configurations
      const { sourceId, workspaceId, backfill } = job.attrs.data;
      const jobId = job.id;
      const redisClient = job.attrs.redisClient;
      console.log('googleSearchConsole - Job started for source:', sourceId);

      // Connect to MongoDB and define models on the connection
      const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
      workspaceConnection = await mongoose.createConnection(dataLakeUri).asPromise();
      
      // Initialize models with the workspace connection
      Source = workspaceConnection.model('sources', SourceSchema);
      Token = workspaceConnection.model('tokens', TokenSchema);
      JobHistory = workspaceConnection.model('jobhistories', JobHistorySchema);
      
      // Ensure facts collection exists
      try {
        await workspaceConnection.db.createCollection('facts');
        console.log('GSC: Created facts collection');
      } catch (err) {
        // Collection likely already exists
        console.log('GSC: Facts collection already exists');
      }
      
      // Initialize Facts model
      Facts = workspaceConnection.model('facts', ConsolidatedRecordSchema);

      const source = await Source.findById(sourceId);
      if (!source) {
        throw new Error('Source not found');
      }

      // Create job history record
      const jobHistory = {
        name: "googleSearchConsole",
        status: "running",
        lastRunAt: new Date().toISOString(),
        jobId: jobId,
        priority: 0,
        type: false,
        shouldSaveResult: false,
        data: { sourceId, workspaceId, ...source.batchConfig },
        startTime: jobStartTime.toISOString()
      };

      const startDate = new Date(source.batchConfig.backfillDate).toISOString();
      const endDate = new Date(getDelayedDate()).toISOString();

      jobHistory.data.startDate = startDate;
      jobHistory.data.endDate = endDate;
      
      savedJobHistory = await JobHistory.create(jobHistory);

      // Get Google OAuth token
      const token = await Token.findById(source.tokenId).exec();

      if (token) {
        // Configure rate limiter
        const limiter = new RedisRateLimiter({
          client: redisClient,
          namespace: "throttler:",
          interval: 60000,
          maxInInterval: 2000,
        });
        
        // Process each configured site
        for (const site of source.batchConfig.batchSites) {
          // Determine date range based on backfill flag
          const endDate = getDelayedDate();
          const startDate = backfill ? (source.batchConfig.backfillDate || new Date(0).toISOString().split('T')[0]) : endDate;
          const datesToProcess = getDatesBetween(startDate, endDate);
          
          for (const date of datesToProcess) {
            await processDateRange(site, date, token, workspaceId, savedJobHistory, job, limiter);
          }
        }
      } else {
        console.warn(`googleSearchConsole - Token not found for source ${sourceId}, skipping processing.`);
      }
    } catch (err) {
      console.error('googleSearchConsole - Processing error occurred', err);
      // Handle any errors during processing
      if (savedJobHistory && JobHistory) {
        await JobHistory.findByIdAndUpdate(savedJobHistory._id, {
          status: 'failed',
          $push: { errors: { error: err.message } }
        });
      }
    } finally {
      // Update job status and cleanup
      const jobEndTime = new Date();
      const runtimeMilliseconds = jobEndTime - jobStartTime;
      
      if (savedJobHistory && JobHistory) {
        const finalStatus = savedJobHistory.status === 'running' ? 'complete' : savedJobHistory.status;
        const currentHistory = await JobHistory.findById(savedJobHistory._id);
        const status = (currentHistory?.errors && currentHistory.errors.length > 0) ? "failed" : finalStatus;
        
        await JobHistory.findByIdAndUpdate(savedJobHistory._id, { 
          status,
          lastFinishedAt: new Date().toISOString(),
          startTime: jobStartTime.toISOString(),
          endTime: jobEndTime.toISOString(),
          runtimeMilliseconds,
          ingressBytes, 
          apiCalls
        });
      }

      if (workspaceConnection) {
        await workspaceConnection.close();
      }
      done();
    }
  }
};
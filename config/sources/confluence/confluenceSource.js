// This service connects to Confluence API to fetch a copy of all content
// It processes data for specified spaces and time ranges, handling rate limiting and error cases

const mongoose = require('mongoose');
const axios = require('axios'); 
const { getValidToken, refreshToken, createConnection } = require('../../providers/atlassian/api'); 
const { SourceSchema, TokenSchema, JobHistorySchema } = require('../../data/models'); // Import schemas
const { RedisRateLimiter } = require("rolling-rate-limiter");
require('dotenv').config(); // Load environment variables from .env

// Define rate limiter constants at the top of the file
const RATE_LIMITS = {
  search: {
    requestsPerInterval: 3,
    intervalMs: 1000 // 1 second
  },
  default: {
    requestsPerInterval: 50,
    intervalMs: 10000 // 10 seconds
  }
};

// Handle rate limiting using Redis to ensure we don't exceed API quotas
async function handleRateLimiting(externalId, job, limiter) {
  return new Promise((resolve, reject) => {
    limiter.wouldLimitWithInfo(externalId.toString()).then(async (RateLimitInfo) => {
      const { blocked, actionsRemaining, millisecondsUntilAllowed } = RateLimitInfo;
      
      if (blocked) {
        const secondsToWait = (millisecondsUntilAllowed / 1000).toFixed(2);
        console.warn('confluence - Rate limit reached, waiting for reset');
        job.touch();
        await new Promise(resolve => setTimeout(resolve, millisecondsUntilAllowed));
        handleRateLimiting(externalId, job, limiter).then(resolve).catch(reject);
      } else {
        // If we wouldn't be limited, then actually perform the limit
        limiter.limit(externalId.toString()).then(() => {
          resolve('OK');
        }).catch(reject);
      }
    }).catch(() => {
      console.error('confluence - Rate limiting error occurred');
      reject(new Error('Rate limiting error'));
    });
  });
}

// Content types we're interested in
const CONTENT_TYPES = [
  "page",
  "blogpost"
];

// Error handling handler
const handleApiError = async (error, savedJobHistory, objectType, JobHistoryModel) => {
  if (savedJobHistory) {
    try {
      const errorMessage = error.response?.data?.message || error.message;
      const statusCode = error.response?.status;
      const logMessage = statusCode ? 
        `API error for ${objectType}: [${statusCode}] ${errorMessage}` :
        `Error processing ${objectType}: ${errorMessage}`;

      console.error(`confluence - ${logMessage}`);
      
      await JobHistoryModel.findByIdAndUpdate(savedJobHistory._id, {
        $push: { errors: { objectType, error: logMessage } }
      });
    } catch (historyError) {
      console.error('confluence - Failed to update job history:', historyError.message);
    }
  }
  return false;
};

// Fetch comments for a specific content
async function fetchComments(contentId, accessToken, cloudId, job, externalId, limiter) {
  let comments = [];
  let start = 0;
  let limit = 25; // Confluence API max is 25
  let hasMore = true;

  try {
    while (hasMore) {
      job.touch(); // Keep the job alive

      await handleRateLimiting(externalId, job, limiter);
      
      // Using the comments API with depth=all to get all child comments 
      const response = await axios.get(
        `https://api.atlassian.com/ex/confluence/${cloudId}/rest/api/content/${contentId}/child/comment`, 
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json'
          },
          params: {
            start: start,
            limit: limit,
            expand: 'body.view,version,children.comment',
            depth: 'all' // Try to get all levels of comments
          }
        }
      );

      if (response.data.results && response.data.results.length > 0) {
        // Process comments and add them to our array
        const processedComments = response.data.results.map(comment => {
          // Create a standardized format for the comment
          return {
            id: comment.id,
            content: comment.body?.view?.value || '',
            author: comment.version?.by?.displayName || 'Unknown',
            authorEmail: comment.version?.by?.email || '',
            createdAt: comment.version?.when || new Date().toISOString(),
            children: processChildComments(comment.children?.comment?.results || [])
          };
        });

        comments = [...comments, ...processedComments];
        
        // Prepare for the next batch
        start += response.data.results.length;
        
        // Check if there are more results
        hasMore = response.data.size > 0 && response.data._links && response.data._links.next;
      } else {
        hasMore = false;
      }
    }
    
    return comments;
  } catch (error) {
    console.error(`confluence - Error fetching comments for content ${contentId}:`, error.message);
    if (error.response?.data) {
      console.error('Confluence API Error:', error.response.data);
    }
    return []; // Return empty array in case of error
  }
}

// Helper function to process child comments recursively
function processChildComments(childComments) {
  if (!childComments || childComments.length === 0) {
    return [];
  }
  
  return childComments.map(comment => {
    return {
      id: comment.id,
      content: comment.body?.view?.value || '',
      author: comment.version?.by?.displayName || 'Unknown',
      authorEmail: comment.version?.by?.email || '',
      createdAt: comment.version?.when || new Date().toISOString(),
      children: processChildComments(comment.children?.comment?.results || [])
    };
  });
}

// Main function to download content from Confluence
async function downloadContent(contentType, sourceId, TokenModel, token, workspaceId, cloudId, externalId, job, limiter, savedJobHistory, JobHistoryModel, workspaceConnection) {
  const records = [];
  let transformedRecords = []; // Define transformedRecords at the function level
  let start = 0;
  const BATCH_SIZE = 100;
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 1000;

  try {
    console.log(`confluence - Starting download for content type: ${contentType}`);
    
    // Check for unfinished jobs using the passed-in model
    const unfinishedJob = await JobHistoryModel.findOne({
      sourceId,
      name: 'confluence',
      _id: { $ne: job._id },
      endTime: { $exists: false },
      status: { $ne: 'skipped' }
    }).sort({ createdAt: -1 });

    if (unfinishedJob) {
      console.log('confluence - Found unfinished job, skipping');
      await JobHistoryModel.findByIdAndUpdate(savedJobHistory._id, {
          status: 'skipped',
          endTime: new Date()
      });
      return [];
    }

    const accessToken = await getValidToken(TokenModel, token, workspaceId);
    
    let startTime;
    const currentJobStartTime = savedJobHistory.startTime;

    if (job.attrs.data.backfill) {
      startTime = new Date(0).toISOString();
    } else {
      // Use the passed-in JobHistoryModel for the query
      const lastJob = await JobHistoryModel.findOne({ 
        sourceId,
        status: 'complete',
        name: 'confluence',
        skipped: { $ne: true }
      }).sort({ startTime: -1 });

      startTime = lastJob ? 
        new Date(new Date(lastJob.startTime).getTime() + 1).toISOString() :
        new Date(Date.now() - 60 * 60 * 1000).toISOString();
    }

    console.log(`confluence - Fetching content of type ${contentType} from ${startTime} to ${currentJobStartTime}`);
    
    let hasMore = true;
    let limit = 25; // Confluence API max is 25

    // Create a CQL query to filter by last modified date
    const cqlFilter = job.attrs.data.backfill ? 
      `type=${contentType}` : 
      `type=${contentType} AND lastmodified >= "${startTime}" AND lastmodified <= "${currentJobStartTime.toISOString()}"`;

    while (hasMore) {
      job.touch(); // Keep the job alive

      try {
        await handleRateLimiting(externalId, job, limiter);
        
        // Call Confluence's content search API
        const response = await axios.get(
          `https://api.atlassian.com/ex/confluence/${cloudId}/rest/api/content/search`, 
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Accept': 'application/json'
            },
            params: {
              cql: cqlFilter,
              start: start,
              limit: limit,
              expand: 'space,body.view,version,history,ancestors'
            }
          }
        );

        if (response.data.results && response.data.results.length > 0) {
          // Process each content item individually to attach its comments
          for (const record of response.data.results) {
            job.touch(); // Keep the job alive
            
            // Fetch comments for this content item
            const comments = await fetchComments(
              record.id, 
              accessToken,
              cloudId,
              job,
              externalId,
              limiter
            );
            
            // Create a transformed record with comments included
            const transformedRecord = {
              record: {
                ...record,
                comments: comments // Add comments array to the record
              },
              metadata: {
                sourceId: sourceId,
                objectType: contentType,
                sourceType: 'confluence',
                createdAt: new Date(),
                updatedAt: new Date(),
                jobHistoryId: savedJobHistory._id
              }
            };
            
            transformedRecords.push(transformedRecord);
          }
          
          // Process in batches for database insertion
          for (let i = 0; i < transformedRecords.length; i += BATCH_SIZE) {
            const batch = transformedRecords.slice(i, i + BATCH_SIZE);
            let retries = 0;
            let success = false;

            while (!success && retries < MAX_RETRIES) {
              try {
                // Use workspaceConnection explicitly
                const collection = workspaceConnection.collection(`source_${sourceId}_stream`);
                await collection.insertMany(batch, { 
                  ordered: false,
                  writeConcern: { w: 1 },
                  maxTimeMS: 30000
                });
                success = true;
              } catch (error) {
                retries++;
                if (retries === MAX_RETRIES) {
                  throw error;
                }
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
              }
            }
          }
          
          records.push(...transformedRecords);
          
          // Prepare for the next batch
          start += response.data.results.length;
          
          // Check if there are more results
          hasMore = response.data.size > 0 && start < response.data._links.next;
          
          console.log(`confluence - Downloaded ${records.length} ${contentType} records so far`);
        } else {
          hasMore = false;
        }
      } catch (error) {
        // Handle specific API errors
        if (error.response?.status === 400) {
          console.log(`confluence - API error: ${error.response.data?.message || 'Bad request'}`);
          hasMore = false;
        } else if (error.response?.status === 403) {
          console.log(`confluence - Access denied: ${error.response.data?.message || 'Forbidden'}`);
          hasMore = false;
        } else {
          throw error;
        }
      }
    }
    
    console.log(`confluence - Successfully downloaded ${records.length} ${contentType} records`);
    return records;
  } catch (error) {
    console.error(`confluence - Error downloading ${contentType}:`, error.message);
    if (error.response?.data) {
      console.error('Confluence API Error:', error.response.data);
    }
    throw error;
  }
}

// Function to get all spaces
async function getSpaces(sourceId, TokenModel, token, workspaceId, cloudId, externalId, job, limiter) {
  try {
    console.log(`confluence - Getting list of spaces`);
    
    const accessToken = await getValidToken(TokenModel, token, workspaceId);
    
    await handleRateLimiting(externalId, job, limiter);
    
    // Call Confluence's spaces API
    const response = await axios.get(
      `https://api.atlassian.com/ex/confluence/${cloudId}/rest/api/space`, 
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        },
        params: {
          limit: 100 // Increase as needed
        }
      }
    );
    
    return response.data.results || [];
  } catch (error) {
    console.error('confluence - Error getting spaces:', error.message);
    if (error.response?.data) {
      console.error('Confluence API Error:', error.response.data);
    }
    return [];
  }
}

// Function to process space-content relationships
async function processSpaceRelationships(spaces, sourceId, workspaceConnection, JobHistoryModel, savedJobHistory) {
  try {
    console.log(`confluence - Processing space relationships`);
    
    const streamCollection = workspaceConnection.collection(`source_${sourceId}_stream`);
    
    // Get all content records
    const contentCursor = await streamCollection.find({
      'metadata.objectType': { $in: CONTENT_TYPES },
      'metadata.sourceType': 'confluence'
    });
    
    let count = 0;
    
    // Process each content item
    while (await contentCursor.hasNext()) {
      const content = await contentCursor.next();
      const spaceKey = content.record?.space?.key;
      const contentId = content.record?.id;
      
      if (spaceKey && contentId) {
        const space = spaces.find(s => s.key === spaceKey);
        
        if (space) {
          // Create relationship record
          const relationshipId = `content_${contentId}_space_${spaceKey}`;
          
          const relationshipRecord = {
            record: {
              id: relationshipId,
              source: {
                id: contentId,
                type: 'document',
                externalId: contentId
              },
              target: {
                id: space.id,
                type: 'space',
                externalId: space.id
              },
              relationshipType: 'belongsTo',
              attributes: {
                spaceKey: spaceKey,
                spaceType: space.type
              }
            },
            metadata: {
              sourceId: sourceId,
              objectType: 'relationship',
              relationshipType: 'documentSpaceRelationship',
              sourceEntityType: content.metadata.objectType,
              targetEntityType: 'space',
              sourceType: 'confluence',
              createdAt: new Date(),
              updatedAt: new Date(),
              jobHistoryId: savedJobHistory._id
            }
          };
          
          // Store relationship in the stream collection
          await streamCollection.updateOne(
            { 
              'record.id': relationshipRecord.record.id,
              'metadata.objectType': 'relationship'
            },
            { $set: relationshipRecord },
            { upsert: true }
          );
          
          count++;
          
          if (count % 100 === 0) {
            console.log(`confluence - Processed ${count} space relationships so far`);
          }
        }
      }
    }
    
    console.log(`confluence - Completed processing ${count} space relationships`);
    return count;
  } catch (error) {
    console.error('confluence - Error processing space relationships:', error.message);
    return 0;
  }
}

module.exports = {
  job: async (job, done) => {
    // Initialize job parameters and configurations
    const { sourceId, workspaceId, backfill } = job.attrs.data;
    const redisClient = job.attrs.redisClient;

    // Check if redisClient is defined
    if (!redisClient) {
      console.error('Redis client is not defined');
      done(new Error('Redis client is not defined'));
      return;
    }

    // Connect to MongoDB and initialize job
    const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
    const workspaceConnection = await mongoose.createConnection(dataLakeUri).asPromise();
    workspaceConnection.set('maxTimeMS', 30000); // Set global timeout to 30 seconds

    // Define models explicitly on the workspace connection USING IMPORTED SCHEMAS
    const Source = workspaceConnection.model('Source', SourceSchema);
    const Token = workspaceConnection.model('Token', TokenSchema);
    const JobHistory = workspaceConnection.model('JobHistory', JobHistorySchema);

    // Find the source before starting the main job
    console.log(`confluence - Attempting to find Source ${sourceId} in workspace db...`);
    const source = await Source.findOne({ _id: sourceId }).exec();
    if (!source) {
        console.error(`confluence - Source ${sourceId} not found in workspace DB. Aborting job.`);
        await workspaceConnection.close();
        done(new Error(`Source with ID ${sourceId} not found`));
        return;
    }
    console.log(`confluence - Source ${sourceId} found successfully.`);

    // Extract batch config parameters
    const batchConfig = source.batchConfig || {};
    // Get the cloudId from batch config
    let cloudId = batchConfig.cloudId;

    if (!cloudId) {
      console.error('Cloud ID not found in batch config');
      await workspaceConnection.close();
      done(new Error('Cloud ID not found in batch config'));
      return;
    }

    console.log(`confluence - Using Cloud ID: ${cloudId}`);

    let ingressBytes = 0;
    let apiCalls = 0;
    let savedJobHistory;
    const jobStartTime = new Date();

    try {
      console.log('confluence - Job started for source:', sourceId);

      savedJobHistory = await JobHistory.create({
        jobId: job.id,
        sourceId: source._id,
        status: 'in_progress',
        startTime: jobStartTime.toISOString(),
        name: 'confluence'
      });

      // Create two separate rate limiters
      const defaultLimiter = new RedisRateLimiter({
        client: redisClient,
        namespace: "confluence:default:",
        interval: RATE_LIMITS.default.intervalMs,
        maxInInterval: RATE_LIMITS.default.requestsPerInterval
      });

      const searchLimiter = new RedisRateLimiter({
        client: redisClient,
        namespace: "confluence:search:",
        interval: RATE_LIMITS.search.intervalMs,
        maxInInterval: RATE_LIMITS.search.requestsPerInterval
      });

      const token = await Token.findById(source.tokenId).exec();
      console.log('confluence - Token found:', token ? 'Yes' : 'No');
      if (!token) {
        throw new Error(`Token with ID ${source.tokenId} not found`);
      }

      const tokenData = token.toObject ? token.toObject() : token;
      if (!tokenData.externalId) {
        throw new Error('External ID not found in token');
      }

      console.log('confluence - Step 1: Getting all spaces');
      const spaces = await getSpaces(sourceId, Token, token, workspaceId, cloudId, tokenData.externalId, job, defaultLimiter);
      console.log(`confluence - Found ${spaces.length} spaces`);

      console.log('confluence - Step 2: Downloading content with comments for each content type');
      for (const contentType of CONTENT_TYPES) {
        try {
          console.log(`confluence - Processing content type: ${contentType}`);
          await downloadContent(
            contentType,
            source._id,
            Token,
            token,
            workspaceId,
            cloudId,
            tokenData.externalId,
            job,
            searchLimiter,
            savedJobHistory,
            JobHistory,
            workspaceConnection
          );
          console.log(`confluence - Completed content type: ${contentType}`);
        } catch (error) {
          await handleApiError(error, savedJobHistory, contentType, JobHistory);
          console.error(`confluence - Error processing content type ${contentType}:`, error.message);
        }
      }

      console.log('confluence - Step 3: Processing space relationships');
      const relationshipCount = await processSpaceRelationships(
        spaces, 
        source._id,
        workspaceConnection,
        JobHistory,
        savedJobHistory
      );
      console.log(`confluence - Processed ${relationshipCount} space relationships`);

    } catch (err) {
      // Handle errors
      await handleApiError(err, savedJobHistory, 'Overall Job', JobHistory);
      const errorMessage = err.response?.data?.message || err.message;
      const statusCode = err.response?.status;
      const logMessage = statusCode ? 
        `Job error: [${statusCode}] ${errorMessage}` :
        `Job error: ${errorMessage}`;

      console.error(`confluence - ${logMessage}`);
    } finally {
      const jobEndTime = new Date();
      const runtimeMilliseconds = jobEndTime - jobStartTime;

      if (savedJobHistory && JobHistory) {
        try {
          const finalStatus = savedJobHistory.status === 'skipped' ? 'skipped' : 
                              (savedJobHistory.errors && savedJobHistory.errors.length > 0 ? "failed" : "complete");
          await JobHistory.findByIdAndUpdate(savedJobHistory._id, { 
            status: finalStatus,
            lastFinishedAt: new Date().toISOString(),
            startTime: jobStartTime.toISOString(),
            endTime: jobEndTime.toISOString(),
            runtimeMilliseconds
          });
        } catch (historyError) {
          console.error('Failed to update job history in finally block:', historyError.message);
        }
      }

      console.log('Job completed for source ID:', sourceId);
      await workspaceConnection.close();
      done();
    }
  }
}; 
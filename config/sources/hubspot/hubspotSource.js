// This service connects to Hubspot API to fetch fetch a copy of all the crm data
// It processes data for specified sites and date ranges, handling rate limiting and error cases
// https://developers.hubspot.com/beta-docs/guides/api/crm/using-object-apis
// https://developers.hubspot.com/beta-docs/guides/api/crm/objects/custom-objects#properties
// https://developers.hubspot.com/beta-docs/guides/api/crm/objects/schemas#get-%2Fcrm-object-schemas%2Fv3%2Fschemas

const mongoose = require('mongoose');
const axios = require('axios'); 
const { getValidToken, refreshToken, createConnection, encryptData } = require('../../providers/hubspot/api'); 
const { SourceSchema, TokenSchema, JobHistorySchema } = require('../../data/models'); // Import schemas
const { RedisRateLimiter } = require("rolling-rate-limiter");
require('dotenv').config(); // Load environment variables from .env

// Update rate limiter constants at the top of the file
const RATE_LIMITS = {
  search: {
    requestsPerInterval: 5,
    intervalMs: 1000 // 1 second
  },
  default: {
    requestsPerInterval: 110,
    intervalMs: 10000 // 10 seconds
  }
};

// Handle rate limiting using Redis to ensure we don't exceed Hubspots's API quotas
async function handleRateLimiting(externalId, job, limiter) {
  return new Promise((resolve, reject) => {
    limiter.wouldLimitWithInfo(externalId.toString()).then(async (RateLimitInfo) => {
      const { blocked, actionsRemaining, millisecondsUntilAllowed } = RateLimitInfo;
      
      if (blocked) {
        const secondsToWait = (millisecondsUntilAllowed / 1000).toFixed(2);
        console.warn('hubspot - Rate limit reached, waiting for reset');
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
      console.error('hubspot - Rate limiting error occurred');
      reject(new Error('Rate limiting error'));
    });
  });
}

// Standard object types in preferred order
const STANDARD_OBJECTS = [
  { id: '0-1', name: 'contacts' },
  { id: '0-2', name: 'companies' },
  { id: '0-3', name: 'deals' },
  { id: '0-5', name: 'tickets' },
  { id: '0-421', name: 'appointments' },
  { id: '0-48', name: 'calls' },
  { id: '0-18', name: 'communications' },
  { id: '0-410', name: 'courses' },
  { id: '0-49', name: 'emails' },
  { id: '0-136', name: 'leads' },
  { id: '0-8', name: 'line_items' },
  { id: '0-420', name: 'listings' },
  { id: '0-54', name: 'marketing_events' },
  { id: '0-47', name: 'meetings' },
  { id: '0-46', name: 'notes' },
  { id: '0-116', name: 'postal_mail' },
  { id: '0-7', name: 'products' },
  { id: '0-14', name: 'quotes' },
  { id: '0-162', name: 'services' },
  { id: '0-69', name: 'subscriptions' },
  { id: '0-27', name: 'tasks' },
  { id: '0-115', name: 'users' }
];

// Step 1: Discover Custom Objects
async function discoverCustomObjects(TokenModel, token, workspaceId, job, limiter) {
  try {
    const accessToken = await getValidToken(TokenModel, token, workspaceId);
    const tokenData = token.toObject ? token.toObject() : token;
    const externalId = tokenData.externalId;
    
    if (!externalId) {
      throw new Error('External ID not found in token');
    }
    
    await handleRateLimiting(externalId, job, limiter);
    
    const response = await axios.get(
      'https://api.hubapi.com/crm-object-schemas/v3/schemas',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    
    return response.data.results
      .filter(schema => !schema.archived)
      .map(schema => ({
        id: schema.objectTypeId,
        name: schema.name,
        isCustom: true
      }));
  } catch (error) {
    console.error('Error discovering custom objects:', error);
    return [];
  }
}

// Step 2: Create Object Download List
const excludedObjects = [
  'marketing_events',  // Not supported by the search endpoint
];

function createObjectDownloadList(standardObjects, customObjects) {
  const allObjects = [...standardObjects, ...customObjects];
  return allObjects.filter(obj => !excludedObjects.includes(obj.name));
}

// Add new function to fetch properties for an object type
async function fetchObjectProperties(objectType, TokenModel, token, workspaceId, externalId, job, limiter) {
  try {
    const accessToken = await getValidToken(TokenModel, token, workspaceId);
    
    await handleRateLimiting(externalId, job, limiter);
    
    // Skip known problematic object types
    if (objectType.name === 'appointments') {
      return ['name'];
    }
    
    // Save original console.error
    const originalConsoleError = console.error;
    
    // Temporarily override console.error to filter out specific errors
    console.error = function(message, error) {
      if (message && message.includes('Error fetching properties for') && 
          error && error.response && error.response.status === 400) {
        // Don't log these specific errors
        return;
      }
      // Call original with all arguments
      return originalConsoleError.apply(console, arguments);
    };
    
    try {
      const response = await axios.get(
        `https://api.hubapi.com/crm/v3/properties/${objectType.name}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      
      // Restore original console.error
      console.error = originalConsoleError;
      
      return response.data.results.map(property => property.name);
    } catch (error) {
      // Restore original console.error
      console.error = originalConsoleError;
      
      // Silently handle 400 errors
      if (error.response?.status === 400) {
        return ['name'];
      }
      
      // Log other errors
      console.error(`Error fetching properties for ${objectType.name}:`, error);
      if (error.response?.data) {
        console.error('HubSpot API Error:', error.response.data);
      }
      return ['name'];
    }
  } catch (error) {
    return ['name'];
  }
}

const handleApiError = async (error, savedJobHistory, objectType, JobHistoryModel) => {
  if (savedJobHistory) {
    try {
      const errorMessage = error.response?.data?.message || error.message;
      const statusCode = error.response?.status;
      const logMessage = statusCode ? 
        `API error for ${objectType}: [${statusCode}] ${errorMessage}` :
        `Error processing ${objectType}: ${errorMessage}`;

      console.error(`hubspot - ${logMessage}`);
      
      await JobHistoryModel.findByIdAndUpdate(savedJobHistory._id, {
        $push: { errors: { objectType, error: logMessage } }
      });
    } catch (historyError) {
      console.error('hubspot - Failed to update job history:', historyError.message);
    }
  }
  return false;
};

// Step 3: Download Records for Each Object
async function downloadObjectRecords(objectType, sourceId, TokenModel, token, workspaceId, externalId, job, limiter, savedJobHistory, JobHistoryModel, workspaceConnection) {
  const records = [];
  let transformedRecords = []; // Define transformedRecords at the function level
  let after = null;
  const BATCH_SIZE = 100;
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 1000;

  try {
    console.log('hubspot - Starting object download');
    
    // Check for unfinished jobs using the passed-in model
    const unfinishedJob = await JobHistoryModel.findOne({
      sourceId,
      name: 'hubspot',
      _id: { $ne: job._id },
      endTime: { $exists: false },
      status: { $ne: 'skipped' }
    }).sort({ createdAt: -1 });

    if (unfinishedJob) {
      console.log('hubspot - Found unfinished job, skipping');
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
        name: 'hubspot',
        skipped: { $ne: true }
      }).sort({ startTime: -1 });

      startTime = lastJob ? 
        new Date(new Date(lastJob.startTime).getTime() + 1).toISOString() :
        new Date(Date.now() - 60 * 60 * 1000).toISOString();
    }

    console.log('hubspot - Fetching properties for object type:', objectType.name);
    
    // Save original console.error before any calls
    const originalConsoleError = console.error;
    
    // Temporarily override console.error to filter out specific errors
    console.error = function(message, error) {
      if ((typeof message === 'string' && 
          (message.includes('Request failed with status code 400') ||
           message.includes('Unable to infer object type'))) ||
          (error && error.response && error.response.status === 400)) {
        // Don't log these specific errors
        return;
      }
      // Call original with all arguments
      return originalConsoleError.apply(console, arguments);
    };
    
    try {
      const properties = await fetchObjectProperties(objectType, TokenModel, token, workspaceId, externalId, job, limiter);
      console.log(`hubspot - Processing ${objectType.name} with ${properties.length} properties`);
      
      do {
        try {
          await handleRateLimiting(externalId, job, limiter);
          
          const startTimeMs = new Date(startTime).getTime();
          const endTimeMs = new Date(currentJobStartTime).getTime();
          
          const searchRequest = {
            filterGroups: job.attrs.data.backfill ? [] : [
              {
                filters: [
                  {
                    propertyName: "lastmodifieddate",
                    operator: "BETWEEN",
                    value: startTimeMs.toString(),
                    highValue: endTimeMs.toString()
                  }
                ]
              }
            ],
            limit: 100,
            after,
            properties,
            sorts: [
              {
                propertyName: "lastmodifieddate",
                direction: "ASCENDING"
              }
            ]
          };

          console.log('hubspot - Executing search request');
          
          try {
            const response = await axios.post(
              `https://api.hubapi.com/crm/v3/objects/${objectType.name}/search`,
              searchRequest,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  'Content-Type': 'application/json'
                }
              }
            );

            if (response.data.results && response.data.results.length > 0) {
              const batchTransformedRecords = response.data.results.map(record => {
                const cleanProperties = Object.fromEntries(
                  Object.entries(record.properties || {}).filter(([_, value]) => value !== null)
                );
                
                return {
                  record: {
                    ...record,
                    properties: cleanProperties
                  },
                  metadata: {
                    sourceId: sourceId,
                    objectType: objectType.name,
                    sourceType: 'hubspot',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    jobHistoryId: savedJobHistory._id
                  }
                };
              });

              // Add batch to overall transformedRecords for later use
              transformedRecords = [...transformedRecords, ...batchTransformedRecords];

              for (let i = 0; i < batchTransformedRecords.length; i += BATCH_SIZE) {
                const batch = batchTransformedRecords.slice(i, i + BATCH_SIZE);
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
              
              records.push(...batchTransformedRecords);
              after = response.data.paging?.next?.after;
            } else {
              after = null;
            }
          } catch (error) {
            if (error.response?.status === 400) {
              // Simplify skip message to be less verbose and more consistent
              console.log(`hubspot - Skipping object type ${objectType.name} - not accessible`);
              return [];
            }
            throw error;
          }
        } catch (error) {
          if (error.response?.status === 400) {
            // Simplify skip message to be less verbose and more consistent
            console.log(`hubspot - Skipping object type ${objectType.name} - not accessible`);
            return [];
          }
          throw error;
        }
      } while (after);
      
      // Restore original console.error when done with this object type
      console.error = originalConsoleError;
      
      // For certain entity types, check for removed relationships when an entity is updated
      if (objectType.name === 'contacts' || objectType.name === 'companies' || objectType.name === 'deals') {
        for (let i = 0; i < transformedRecords.length; i++) {
          const record = transformedRecords[i];
          // Check if record has lastModifiedDate property - only process updated records
          const lastModifiedDate = record.record?.properties?.lastmodifieddate;
          
          if (lastModifiedDate) {
            await processEntityRelationships(
              record,
              objectType.name,
              sourceId,
              externalId,
              TokenModel,
              token,
              workspaceId,
              job,
              limiter,
              workspaceConnection.collection(`source_${sourceId}_stream`),
              workspaceConnection.collection(`source_${sourceId}_consolidated`)
            );
          }
        }
      }
      
      return records;
    } catch (error) {
      // Restore original console.error
      console.error = originalConsoleError;
      
      if (error.response?.status === 400) {
        // Simplify skip message to be less verbose and more consistent
        console.log(`hubspot - Skipping object type ${objectType.name} - not accessible`);
        return [];
      }
      throw error;
    }
  } catch (error) {
    if (error.response?.status === 400) {
      // Simplify skip message to be less verbose and more consistent
      console.log(`hubspot - Skipping object type ${objectType.name} - not accessible`);
      return [];
    }
    // Only log non-400 errors
    if (!error.response || error.response.status !== 400) {
      console.error('hubspot - Object download failed', error);
    }
    throw error;
  }
}

// Add new function to fetch event types
async function getEventTypes(TokenModel, token, workspaceId, job, limiter) {
  try {
    const accessToken = await getValidToken(TokenModel, token, workspaceId);
    const tokenData = token.toObject ? token.toObject() : token;
    const externalId = tokenData.externalId;
    
    await handleRateLimiting(externalId, job, limiter);
    
    const response = await axios.get(
      'https://api.hubapi.com/events/v3/events/event-types',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    
    return response.data.results || [];
  } catch (error) {
    console.error('Error fetching event types:', error);
    return [];
  }
}

// Add new function to download events
async function downloadEvents(eventType, sourceId, TokenModel, token, workspaceId, externalId, job, limiter, savedJobHistory, JobHistoryModel, workspaceConnection) {
  const records = [];
  let transformedRecords = []; // Define transformedRecords at the function level
  let after = null;

  try {
    console.log(`hubspot - Starting event download for type ${eventType}`);
    
    // Rest of code remains the same
    const accessToken = await getValidToken(TokenModel, token, workspaceId);
    
    let startTime;
    const currentJobStartTime = savedJobHistory.startTime;

    if (job.attrs.data.backfill) {
      startTime = new Date(0).toISOString();
    } else {
      // Use JobHistoryModel passed as argument
      const lastJob = await JobHistoryModel.findOne({ 
        sourceId,
        status: 'complete',
        name: 'hubspot',
        skipped: { $ne: true }
      }).sort({ startTime: -1 });

      startTime = lastJob ? 
        new Date(new Date(lastJob.startTime).getTime() + 1).toISOString() :
        new Date(Date.now() - 60 * 60 * 1000).toISOString();
    }
    
    do {
      await handleRateLimiting(externalId, job, limiter);
      
      const response = await axios.get(
        'https://api.hubapi.com/events/v3/events/',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          params: {
            eventType: eventType,
            after,
            limit: 100,
            startTime: startTime,
            endTime: currentJobStartTime,
            sort: ['occurredAt']
          }
        }
      );

      if (response.data.results && response.data.results.length > 0) {
        const batchTransformedRecords = response.data.results.map(record => ({
          record,
          metadata: {
            sourceId: sourceId,
            objectType: 'event',
            eventType: eventType,
            createdAt: new Date(),
            updatedAt: new Date(),
            jobHistoryId: savedJobHistory._id
          }
        }));

        // Add to overall transformedRecords array
        transformedRecords = [...transformedRecords, ...batchTransformedRecords];

        // Use workspaceConnection explicitly
        const collection = workspaceConnection.collection(`source_${sourceId}_stream`);
        await collection.insertMany(batchTransformedRecords, { ordered: false });
        
        records.push(...batchTransformedRecords);
        after = response.data.paging?.next?.after;
      } else {
        after = null;
      }

      console.log(`Downloaded ${records.length} events of type ${eventType}`);
    } while (after);
    
    return records;
  } catch (error) {
    console.error(`Error downloading events of type ${eventType}:`, error);
    if (error.response?.data) {
      console.error('HubSpot API Error:', error.response.data);
    }
    throw error;
  }
}

// Add new function to track relationship changes
async function processEntityRelationships(entity, entityType, sourceId, tokenData, Token, token, workspaceId, job, limiter, streamCollection, consolidatedCollection) {
  const objectId = entity.record?.id;
  if (!objectId) return;
  
  console.log(`hubspot - Processing relationship changes for ${entityType}:${objectId}`);
  
  // Get current relationships from HubSpot
  const currentRelationships = [];
  
  // Define what types of entities this can be related to
  const relatedTypes = {
    'contacts': ['companies', 'deals', 'contacts'],
    'companies': ['contacts', 'deals', 'companies'],
    'deals': ['contacts', 'companies']
  };
  
  const toTypes = relatedTypes[entityType] || [];
  
  // Get access token for API calls
  const accessToken = await getValidToken(Token, token, workspaceId);
  
  // Fetch all current relationships from HubSpot
  for (const toType of toTypes) {
    try {
      await handleRateLimiting(tokenData.externalId, job, limiter);
      
      // Call HubSpot v4 Associations API
      const response = await axios.post(
        `https://api.hubapi.com/crm/v4/associations/${entityType}/${toType}/batch/read`,
        {
          inputs: [{ id: objectId }]
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      // Extract all associated IDs
      if (response.data.results && response.data.results.length > 0) {
        const result = response.data.results[0];
        if (result.to && result.to.length > 0) {
          result.to.forEach(association => {
            currentRelationships.push({
              fromType: entityType,
              fromId: objectId,
              toType: toType, 
              toId: association.toObjectId,
              relationshipId: `${entityType}_${objectId}_${toType}_${association.toObjectId}`
            });
          });
        }
      }
    } catch (error) {
      console.error(`hubspot - Error fetching relationships for ${entityType}:${objectId} to ${toType}:`, error.message);
    }
  }
  
  // Find all existing relationships in our consolidated collection
  const existingRelationships = [];
  try {
    // Find relationships where this entity is source OR target
    const sourceRelationships = await consolidatedCollection.find({
      'metadata.objectType': 'relationship',
      $or: [
        { 'record.source.externalId': objectId, 'record.source.type': mapHubspotTypeToGeneric(entityType) },
        { 'record.target.externalId': objectId, 'record.target.type': mapHubspotTypeToGeneric(entityType) }
      ]
    }).toArray();
    
    sourceRelationships.forEach(rel => {
      let relationshipId;
      if (rel.record.source.externalId === objectId) {
        // This entity is the source
        relationshipId = `${entityType}_${objectId}_${reverseMapGenericToHubspotType(rel.record.target.type)}_${rel.record.target.externalId}`;
      } else {
        // This entity is the target
        relationshipId = `${reverseMapGenericToHubspotType(rel.record.source.type)}_${rel.record.source.externalId}_${entityType}_${objectId}`;
      }
      
      existingRelationships.push({
        relationshipId,
        _id: rel._id,
        archived: rel.record.archived || false
      });
    });
  } catch (error) {
    console.error(`hubspot - Error finding existing relationships for ${entityType}:${objectId}:`, error.message);
  }
  
  // Find relationships that exist in our database but not in current HubSpot relationships
  // These are relationships that have been removed
  const removedRelationshipIds = existingRelationships
    .filter(existing => !existing.archived) // Only consider active relationships
    .filter(existing => !currentRelationships.some(current => current.relationshipId === existing.relationshipId))
    .map(removed => removed._id);
  
  // Mark removed relationships as archived
  if (removedRelationshipIds.length > 0) {
    console.log(`hubspot - Found ${removedRelationshipIds.length} removed relationships for ${entityType}:${objectId}`);
    try {
      const now = new Date();
      
      // Update each relationship record to set archived flag
      for (const relationshipId of removedRelationshipIds) {
        await consolidatedCollection.updateOne(
          { _id: relationshipId },
          { 
            $set: { 
              'record.archived': true,
              'metadata.updatedAt': now,
              'metadata.archivedAt': now,
              'metadata.archivedReason': 'relationship_removed_in_source'
            } 
          }
        );
        console.log(`hubspot - Marked relationship ${relationshipId} as archived`);
      }
    } catch (error) {
      console.error(`hubspot - Error archiving removed relationships:`, error.message);
    }
  }
  
  return removedRelationshipIds.length;
}

// Helper function to map generic entity types back to HubSpot types
function reverseMapGenericToHubspotType(genericType) {
  const typeMap = {
    'person': 'contacts',
    'organization': 'companies',
    'deal': 'deals',
    'ticket': 'tickets',
    'event': 'meetings'
  };
  
  return typeMap[genericType] || genericType;
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

    // Use the correct connection to find the Source *before* the try block
    console.log(`hubspot - Attempting to find Source ${sourceId} in workspace db...`);
    const source = await Source.findOne({ _id: sourceId }).exec();
    if (!source) {
        // If source not found *here*, throw immediately before starting the main try block
        console.error(`hubspot - Source ${sourceId} not found in workspace DB. Aborting job.`);
        await workspaceConnection.close();
        done(new Error(`Source with ID ${sourceId} not found`));
        return; // Ensure the function exits
    }
    console.log(`hubspot - Source ${sourceId} found successfully.`);

    let ingressBytes = 0;
    let apiCalls = 0;
    let savedJobHistory;
    const jobStartTime = new Date();

    try {
      console.log('hubspot - Job started for source:', sourceId);

      // Setup code
      if (!source) {
        throw new Error(`Source with ID ${sourceId} not found`);
      }

      savedJobHistory = await JobHistory.create({
        jobId: job.id,
        sourceId: source._id,
        status: 'in_progress',
        startTime: jobStartTime.toISOString(),
        name: 'hubspot'
      });

      // Create two separate rate limiters
      const defaultLimiter = new RedisRateLimiter({
        client: redisClient,
        namespace: "hubspot:default:",
        interval: RATE_LIMITS.default.intervalMs,
        maxInInterval: RATE_LIMITS.default.requestsPerInterval
      });

      const searchLimiter = new RedisRateLimiter({
        client: redisClient,
        namespace: "hubspot:search:",
        interval: RATE_LIMITS.search.intervalMs,
        maxInInterval: RATE_LIMITS.search.requestsPerInterval
      });

      const token = await Token.findById(source.tokenId).exec();
      console.log('hubspot - Token found:', token ? 'Yes' : 'No');
      if (!token) {
        throw new Error(`Token with ID ${source.tokenId} not found`);
      }

      const tokenData = token.toObject ? token.toObject() : token;
      if (!tokenData.externalId) {
        throw new Error('External ID not found in token');
      }

      // Use consistent prefixes and simplify step logs
      console.log('hubspot - Step 1: Discovering custom objects');
      const customObjects = await discoverCustomObjects(Token, token, workspaceId, job, defaultLimiter);
      
      console.log('hubspot - Step 2: Creating object download list');
      const objectDownloadList = createObjectDownloadList(STANDARD_OBJECTS, customObjects);

      console.log('hubspot - Step 3: Downloading records for each object');
      for (const objectType of objectDownloadList) {
        try {
          console.log(`hubspot - Processing object type: ${objectType.name}`);
          await downloadObjectRecords(
            objectType,
            source._id,
            Token,
            token,
            workspaceId,
            tokenData.externalId,
            job,
            searchLimiter,
            savedJobHistory,
            JobHistory,
            workspaceConnection
          );
          console.log(`hubspot - Completed object type: ${objectType.name}`);
        } catch (error) {
          await handleApiError(error, savedJobHistory, objectType.name, JobHistory);
          if (error.response?.status === 400) {
            console.log(`hubspot - Skipping object type ${objectType.name} - not accessible`);
            continue;
          }
          throw error;
        }
      }

      console.log('hubspot - Step 4: Discovering event types');
      const eventTypes = await getEventTypes(Token, token, workspaceId, job, defaultLimiter);
      console.log(`hubspot - Found ${eventTypes.length} event types`);

      console.log('hubspot - Step 5: Downloading events for each type');
      for (const eventType of eventTypes) {
        try {
          console.log(`hubspot - Processing event type: ${eventType}`);
          await downloadEvents(
            eventType,
            source._id,
            Token,
            token,
            workspaceId,
            tokenData.externalId,
            job,
            defaultLimiter,
            savedJobHistory,
            JobHistory,
            workspaceConnection
          );
          console.log(`hubspot - Completed event type: ${eventType}`);
        } catch (error) {
          await handleApiError(error, savedJobHistory, `event:${eventType}`, JobHistory);
          console.error(`hubspot - Error downloading events of type ${eventType}`);
        }
      }

      console.log('hubspot - Step 6: Processing relationships between objects');
      const objectTypes = ['contacts', 'companies', 'deals'];

      // Define the associations to fetch
      const associationMappings = {
        'contacts': ['companies', 'deals', 'contacts'],
        'companies': ['contacts', 'deals', 'companies'],
        'deals': ['contacts', 'companies']
      };

      let processedCount = 0;
      let relationshipsFound = 0;
      const streamCollection = workspaceConnection.collection(`source_${sourceId}_stream`);

      // Process each object type
      for (const fromType of objectTypes) {
        console.log(`hubspot - Processing relationships for ${fromType}`);
        
        // Find records of this type in stream
        const cursor = streamCollection.find({
          'metadata.objectType': fromType,
          'metadata.sourceType': 'hubspot'
        });
        
        // Process in batches
        const BATCH_SIZE = 10;
        let batch = [];
        let recordCounter = 0;
        
        while (await cursor.hasNext()) {
          const record = await cursor.next();
          recordCounter++;
          console.log(`hubspot - Processing record ${recordCounter} of type ${fromType}, ID: ${record.record?.id}`);
          batch.push(record);
          
          if (batch.length >= BATCH_SIZE) {
            console.log(`hubspot - Processing batch of ${batch.length} ${fromType} records`);
            await processRelationshipBatch(batch, fromType);
            batch = [];
            // Touch job to keep it alive
            job.touch();
          }
        }
        
        // Process any remaining records in the last batch
        if (batch.length > 0) {
          console.log(`hubspot - Processing final batch of ${batch.length} ${fromType} records`);
          await processRelationshipBatch(batch, fromType);
        }
        console.log(`hubspot - Finished processing ${recordCounter} records for type ${fromType}`);
      }

      console.log(`hubspot - Total processed: ${processedCount}, relationships: ${relationshipsFound}`);

      // Helper function to process a batch of records for relationships
      async function processRelationshipBatch(records, batchFromType) {
        console.log(`hubspot - Processing relationships for ${batchFromType}`);
        for (const record of records) {
          // Get the object ID from the record
          const objectId = record.record?.id;
          const fromType = record.metadata?.objectType;

          if (!objectId || !fromType) {
              console.error(`hubspot - Skipping record due to missing ID or type:`, record._id);
              continue;
          }
          
          // Find which object types we should get associations for
          const toTypes = associationMappings[fromType] || [];
          console.log(`hubspot - Record ID ${objectId} (${fromType}), checking associations to types: [${toTypes.join(', ')}]`);
          
          for (const toType of toTypes) {
            console.log(`hubspot - Checking association from ${fromType}:${objectId} to ${toType}`);
            try {
              await handleRateLimiting(tokenData.externalId, job, defaultLimiter);
              
              // Get valid access token using the scoped Token model
              const accessToken = await getValidToken(Token, token, workspaceId);
              
              console.log(`hubspot - Calling Associations API for ${fromType}/${objectId} -> ${toType}`);
              // Call HubSpot v4 Associations API
              const response = await axios.post(
                `https://api.hubapi.com/crm/v4/associations/${fromType}/${toType}/batch/read`,
                {
                  inputs: [{ id: objectId }]
                },
                {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                  }
                }
              );
              
              apiCalls++; // Increment API call counter

              if (response.data.results && response.data.results.length > 0) {
                const result = response.data.results[0];
                console.log(`hubspot - API Response for ${fromType}:${objectId} -> ${toType}: Found ${result.to?.length || 0} associations.`);
                
                if (result.to && result.to.length > 0) {
                  for (const association of result.to) {
                    // Create a unique ID for the relationship
                    const relationshipId = `${fromType}_${objectId}_${toType}_${association.toObjectId}`;
                    console.log(`hubspot - Processing association to ${association.toObjectId}, creating relationship ID: ${relationshipId}`);
                    
                    // Determine relationship type from association labels
                    const relationshipType = determineRelationshipType(fromType, toType, association.associationTypes);
                    console.log(`hubspot - Determined relationship type: ${relationshipType}`);
                    
                    // Create the relationship record
                    const relationshipRecord = {
                      record: {
                        id: relationshipId,
                        source: {
                          id: "",  // Leave empty - will be filled with MongoDB ObjectID later
                          type: mapHubspotTypeToGeneric(fromType),
                          externalId: objectId
                        },
                        target: {
                          id: "",  // Leave empty - will be filled with MongoDB ObjectID later
                          type: mapHubspotTypeToGeneric(toType),
                          externalId: association.toObjectId
                        },
                        relationshipType,
                        externalIds: {
                          hubspot: relationshipId
                        },
                        metadata: {
                          sourceType: 'hubspot',
                          nativeRelationshipType: relationshipType,
                          createdAt: new Date().toISOString(),
                          updatedAt: new Date().toISOString()
                        }
                      },
                      metadata: {
                        sourceId: source._id,
                        objectType: 'relationship',
                        sourceEntityType: fromType,
                        targetEntityType: toType,
                        sourceType: 'hubspot',
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        jobHistoryId: savedJobHistory._id
                      }
                    };
                    
                    console.log(`hubspot - Preparing to write relationship record to stream:`, JSON.stringify(relationshipRecord.metadata));
                    // Store relationship in the stream collection
                    const writeResult = await streamCollection.updateOne(
                      { 
                        'record.id': relationshipRecord.record.id,
                        'metadata.objectType': 'relationship'
                      },
                      { $set: relationshipRecord },
                      { upsert: true }
                    );
                    
                    console.log(`hubspot - Stream write result for ${relationshipId}:`, JSON.stringify(writeResult));
                    if (writeResult.upsertedCount > 0 || writeResult.modifiedCount > 0) {
                        relationshipsFound++;
                    }
                  }
                  
                  // console.log('hubspot - Relationships found'); // Removed redundant log
                }
              } else {
                  console.log(`hubspot - No associations found in API response for ${fromType}:${objectId} -> ${toType}`);
              }
            } catch (error) {
              console.error(`hubspot - Error processing association ${fromType}:${objectId} -> ${toType}:`, error.response?.data || error.message);
              // Continue with the next one rather than failing the whole job
            }
          }
          
          processedCount++;
        }
      }

    } catch (err) {
      // Pass JobHistory model to handleApiError
      await handleApiError(err, savedJobHistory, 'Overall Job', JobHistory);
      // Silently handle 400 errors related to object types
      if (err.response?.status === 400 && 
          (err.message?.includes('Unable to infer object type') || 
           err.response?.data?.message?.includes('Unable to infer object type'))) {
        // Add a helpful message without showing the error details
        console.log('hubspot - Skipping inaccessible object type - this is expected behavior');
        // The job will be marked as complete in the finally block
      } else {
        // Only log non-400 errors or 400 errors not related to object type
        const errorMessage = err.response?.data?.message || err.message;
        const statusCode = err.response?.status;
        const logMessage = statusCode ? 
          `Job error: [${statusCode}] ${errorMessage}` :
          `Job error: ${errorMessage}`;

        console.error(`hubspot - ${logMessage}`);
      }
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

/**
 * Determines the relationship type based on association types
 */
function determineRelationshipType(fromType, toType, associationTypes) {
  // Check for primary association
  const primaryAssociation = associationTypes.find(type => type.label === 'Primary');
  if (primaryAssociation) {
    return 'primary';
  }
  
  // Check for labeled associations (use the first one with a label)
  const labeledAssociation = associationTypes.find(type => 
    type.label && type.label !== 'Primary' && type.label !== null
  );
  
  if (labeledAssociation) {
    return labeledAssociation.label.toLowerCase().replace(/\s+/g, '_');
  }
  
  // Default relationship types based on object types
  if ((fromType === 'contacts' && toType === 'companies') || 
      (fromType === 'companies' && toType === 'contacts')) {
    return 'employment';
  }
  
  if ((fromType === 'contacts' && toType === 'deals') || 
      (fromType === 'deals' && toType === 'contacts')) {
    return 'involvement';
  }
  
  if ((fromType === 'companies' && toType === 'deals') || 
      (fromType === 'deals' && toType === 'companies')) {
    return 'business';
  }
  
  if (fromType === 'companies' && toType === 'companies') {
    return 'company_association';
  }
  
  if (fromType === 'contacts' && toType === 'contacts') {
    return 'contact_association';
  }
  
  // Default fallback
  return 'association';
}

/**
 * Maps HubSpot object types to generic entity types
 */
function mapHubspotTypeToGeneric(hubspotType) {
  const typeMap = {
    'contacts': 'person',
    'companies': 'organization',
    'deals': 'deal',
    'tickets': 'ticket',
    'meetings': 'event'
  };
  
  return typeMap[hubspotType] || hubspotType;
}

/**
 * Extracts attributes from association types
 */
function extractAttributesFromAssociationTypes(associationTypes) {
  const attributes = {};
  
  // Add label information to attributes
  associationTypes.forEach(type => {
    if (type.label) {
      attributes.label = type.label;
    }
    
    // Store typeId and category for reference
    if (!attributes.typeIds) {
      attributes.typeIds = [];
    }
    
    attributes.typeIds.push({
      typeId: type.typeId,
      category: type.category
    });
  });
  
  return attributes;
}
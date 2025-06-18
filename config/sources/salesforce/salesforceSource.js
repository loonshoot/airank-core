// Salesforce V1 Batch Job
// This service connects to Salesforce API to fetch a copy of all the CRM data
// It processes data for specified objects, handling rate limiting and Pub/Sub channel setup

const mongoose = require('mongoose');
const axios = require('axios');
const { getValidToken, refreshToken, createConnection, encryptData, createPubSubSubscription, listPubSubChannels } = require('../../providers/salesforce/api');
const { SourceSchema, TokenSchema, JobHistorySchema } = require('../../data/models');
const { RedisRateLimiter } = require("rolling-rate-limiter");
const config = require('./config.json'); // Import configuration
require('dotenv').config(); // Load environment variables from .env

// Fallback fields for standard objects when API discovery returns empty fields
// These are the minimum essential fields we need to get useful data
const FALLBACK_FIELDS = {
  Account: ['Id', 'Name', 'Phone', 'Website', 'Type', 'Industry', 'BillingCity', 'BillingCountry', 'CreatedDate', 'LastModifiedDate'],
  Contact: ['Id', 'FirstName', 'LastName', 'Email', 'Phone', 'Title', 'AccountId', 'CreatedDate', 'LastModifiedDate'],
  Lead: ['Id', 'FirstName', 'LastName', 'Email', 'Company', 'Status', 'CreatedDate', 'LastModifiedDate'],
  Opportunity: ['Id', 'Name', 'Amount', 'StageName', 'CloseDate', 'AccountId', 'CreatedDate', 'LastModifiedDate'],
  Campaign: ['Id', 'Name', 'Status', 'Type', 'CreatedDate', 'LastModifiedDate'],
  Case: ['Id', 'CaseNumber', 'Subject', 'Status', 'Priority', 'CreatedDate', 'LastModifiedDate'],
  Task: ['Id', 'Subject', 'Status', 'Priority', 'CreatedDate', 'LastModifiedDate'],
  Event: ['Id', 'Subject', 'StartDateTime', 'EndDateTime', 'CreatedDate', 'LastModifiedDate'],
  User: ['Id', 'Name', 'Username', 'Email', 'IsActive', 'CreatedDate', 'LastModifiedDate'],
  Product2: ['Id', 'Name', 'Description', 'CreatedDate', 'LastModifiedDate'],
  Pricebook2: ['Id', 'Name', 'IsActive', 'CreatedDate', 'LastModifiedDate'],
  PricebookEntry: ['Id', 'UnitPrice', 'IsActive', 'Pricebook2Id', 'Product2Id', 'CreatedDate', 'LastModifiedDate'],
  OpportunityLineItem: ['Id', 'OpportunityId', 'PricebookEntryId', 'Quantity', 'UnitPrice', 'CreatedDate', 'LastModifiedDate'],
  Contract: ['Id', 'AccountId', 'Status', 'StartDate', 'EndDate', 'CreatedDate', 'LastModifiedDate']
};

// Rate limiter constants
const RATE_LIMITS = {
  search: {
    requestsPerInterval: 5,
    intervalMs: 1000 // 1 second
  },
  default: {
    requestsPerInterval: 100,
    intervalMs: 10000 // 10 seconds
  }
};

// Handle rate limiting using Redis to ensure we don't exceed Salesforce's API quotas
async function handleRateLimiting(externalId, job, limiter) {
  return new Promise((resolve, reject) => {
    limiter.wouldLimitWithInfo(externalId.toString()).then(async (RateLimitInfo) => {
      const { blocked, actionsRemaining, millisecondsUntilAllowed } = RateLimitInfo;
      
      if (blocked) {
        const secondsToWait = (millisecondsUntilAllowed / 1000).toFixed(2);
        console.warn('salesforce - Rate limit reached, waiting for reset');
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
      console.error('salesforce - Rate limiting error occurred');
      reject(new Error('Rate limiting error'));
    });
  });
}

// Standard object types in preferred order
const STANDARD_OBJECTS = [
  { id: 'Contact', name: 'Contact' },
  { id: 'Account', name: 'Account' },
  { id: 'Opportunity', name: 'Opportunity' },
  { id: 'Lead', name: 'Lead' },
  { id: 'Case', name: 'Case' },
  { id: 'User', name: 'User' },
  { id: 'Campaign', name: 'Campaign' },
  { id: 'Task', name: 'Task' },
  { id: 'Event', name: 'Event' },
  { id: 'Product2', name: 'Product2' },
  { id: 'PricebookEntry', name: 'PricebookEntry' },
  { id: 'Pricebook2', name: 'Pricebook2' },
  { id: 'OpportunityLineItem', name: 'OpportunityLineItem' },
  { id: 'Contract', name: 'Contract' }
];

// Step 1: Discover Custom Objects
async function discoverCustomObjects(TokenModel, token, instanceUrl, workspaceId, job, limiter) {
  try {
    const accessToken = await getValidToken(TokenModel, token, workspaceId);
    const tokenData = token.toObject ? token.toObject() : token;
    const externalId = tokenData.externalId;
    
    if (!externalId) {
      throw new Error('External ID not found in token');
    }
    
    await handleRateLimiting(externalId, job, limiter);
    
    const response = await axios.get(
      `${instanceUrl}/services/data/v58.0/sobjects`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    
    // Filter custom objects (typically end with "__c" in Salesforce)
    return response.data.sobjects
      .filter(obj => 
        obj.name.endsWith('__c') && 
        obj.queryable && 
        !obj.deprecatedAndHidden && 
        !obj.customSetting
      )
      .map(obj => ({
        id: obj.name,
        name: obj.name,
        isCustom: true
      }));
  } catch (error) {
    console.error('Error discovering custom objects:', error);
    return [];
  }
}

// Step 2: Create Object Download List
const excludedObjects = [
  'ActivityHistory', // Historical data, query specific Tasks/Events instead
  'ContentDocument', // Binary documents, should be queried separately
  'IdeaComment', // Related to Idea objects
  'Vote' // Related to Idea objects
];

function createObjectDownloadList(standardObjects, customObjects) {
  const allObjects = [...standardObjects, ...customObjects];
  return allObjects.filter(obj => !excludedObjects.includes(obj.name));
}

// Add new function to fetch fields for an object type
async function fetchObjectFields(objectType, TokenModel, token, instanceUrl, workspaceId, externalId, job, limiter) {
  try {
    await handleRateLimiting(externalId, job, limiter);
    
    const accessToken = await getValidToken(TokenModel, token, workspaceId);
    
    console.log(`salesforce - Attempting to fetch field metadata for ${objectType.name}`);
    
    const response = await axios.get(
      `${instanceUrl}/services/data/v58.0/sobjects/${objectType.name}/describe`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        }
      }
    );
    
    // Check if fields exist in the response
    if (!response.data.fields || !Array.isArray(response.data.fields)) {
      console.warn(`salesforce - The describe API for ${objectType.name} returned no fields array. Using fallback fields.`);
      return FALLBACK_FIELDS[objectType.name] || ['Id', 'Name', 'CreatedDate', 'LastModifiedDate'];
    }
    
    // Check if the number of fields returned seems unusually low
    if (response.data.fields.length < 5) {
      console.warn(`salesforce - The describe API for ${objectType.name} returned only ${response.data.fields.length} fields. This may indicate a permissions issue.`);
    }
    
    // Filter out fields that are not creatable or updateable
    const fields = response.data.fields
      .filter(field => !field.deprecatedAndHidden)
      .map(field => field.name);
    
    console.log(`salesforce - API returned ${fields.length} accessible fields for ${objectType.name}`);
    
    // Ensure we always have at least Id field
    if (fields.length === 0 || !fields.includes('Id')) {
      console.warn(`salesforce - No accessible fields found for ${objectType.name}, using fallback fields`);
      
      // Use predefined fallback fields for standard objects if available
      if (FALLBACK_FIELDS[objectType.name]) {
        console.log(`salesforce - Using ${FALLBACK_FIELDS[objectType.name].length} fallback fields for ${objectType.name}`);
        return FALLBACK_FIELDS[objectType.name];
      }
      
      // Otherwise use a minimal set
      return ['Id', 'Name', 'CreatedDate', 'LastModifiedDate'];
    }
    
    return fields;
  } catch (error) {
    console.error(`salesforce - Error fetching fields for object ${objectType.name}:`, error.message);
    
    // See if we have fallback fields for this object type
    if (FALLBACK_FIELDS[objectType.name]) {
      console.log(`salesforce - Using ${FALLBACK_FIELDS[objectType.name].length} fallback fields for ${objectType.name} due to API error`);
      return FALLBACK_FIELDS[objectType.name];
    }
    
    // Return a minimal set of fields to continue operation
    return ['Id', 'Name', 'CreatedDate', 'LastModifiedDate'];
  }
}

const handleApiError = async (error, savedJobHistory, objectType, JobHistoryModel) => {
  const errorMessage = error.response?.data?.message || error.response?.data?.error || error.message;
  const errorDescription = error.response?.data?.error_description || '';
  const statusCode = error.response?.status;
  
  // Check for Salesforce-specific OAuth errors in the response data
  const isOAuthError = error.response?.data?.error === 'invalid_grant' || 
                       error.response?.data?.error === 'invalid_token' ||
                       errorMessage.includes('expired access/refresh token');
  
  // Create a user-friendly error message with guidance
  let userFriendlyMessage = errorMessage;
  if (isOAuthError) {
    userFriendlyMessage = `Authentication error: ${errorDescription || errorMessage}. 
    
TO FIX THIS: 
1. Go to Sources page
2. Delete this Salesforce source
3. Add a new Salesforce source and re-authenticate
4. This is required because the Salesforce refresh token has expired (typically after 90-180 days of inactivity)`;
  }
  
  // Determine if this is a critical error that should fail the job
  const isCritical = 
    // OAuth and token errors are always critical
    isOAuthError ||
    // Authentication errors, token issues
    (statusCode === 401) || 
    // Permissions errors on core objects
    (statusCode === 403 && ['Account', 'Contact', 'Opportunity'].includes(objectType)) ||
    // Rate limit exceeded without recovery
    (statusCode === 429 && error.message.includes('maxRetries')) ||
    // Connection errors without recovery
    errorMessage.includes('ETIMEDOUT') || 
    errorMessage.includes('ECONNREFUSED') ||
    // Invalid token errors
    errorMessage.includes('invalid token') ||
    errorMessage.includes('TokenModel') ||
    errorMessage.includes('refresh token') ||
    // Data access errors that prevent operation
    (objectType === 'Overall Job');

  const logMessage = statusCode ? 
    `API error for ${objectType}: [${statusCode}] ${errorMessage}` :
    `Error processing ${objectType}: ${errorMessage}`;

  // Add clear messaging for token errors
  if (isOAuthError) {
    console.error(`salesforce - CRITICAL ERROR: OAuth authentication failed. Re-authorization required. ${logMessage}`);
  } else {
    console.error(`salesforce - ${logMessage}`);
  }

  if (savedJobHistory && JobHistoryModel) {
    try {
      await JobHistoryModel.findByIdAndUpdate(savedJobHistory._id, {
        $push: {
          errors: {
            message: userFriendlyMessage, // Use the user-friendly message
            code: statusCode,
            objectType: objectType,
            timestamp: new Date(),
            critical: isCritical
          }
        },
        // Only mark as failed for critical errors
        ...(isCritical ? { status: 'failed' } : {})
      });
    } catch (historyError) {
      console.error('Failed to update job history with error:', historyError.message);
    }
  }
};

// Step 3: Download Records for Each Object
async function downloadObjectRecords(objectType, sourceId, TokenModel, token, instanceUrl, workspaceId, externalId, job, limiter, savedJobHistory, JobHistoryModel, workspaceConnection) {
  const records = [];
  let transformedRecords = [];
  let queryMoreUrl = null;
  const BATCH_SIZE = 100;
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 1000;

  try {
    console.log(`salesforce - Starting download for ${objectType.name}`);
    
    // Check for unfinished jobs using the passed-in model
    const unfinishedJob = await JobHistoryModel.findOne({
      sourceId,
      name: 'salesforce',
      _id: { $ne: job._id },
      endTime: { $exists: false },
      status: { $ne: 'skipped' }
    }).sort({ createdAt: -1 });

    if (unfinishedJob) {
      console.log('salesforce - Found unfinished job, skipping');
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
        name: 'salesforce',
        skipped: { $ne: true }
      }).sort({ startTime: -1 });

      startTime = lastJob ? 
        new Date(new Date(lastJob.startTime).getTime() + 1).toISOString() :
        new Date(Date.now() - 60 * 60 * 1000).toISOString();
    }

    console.log(`salesforce - Fetching fields for object type: ${objectType.name}`);
    
    const fields = await fetchObjectFields(objectType, TokenModel, token, instanceUrl, workspaceId, externalId, job, limiter);
    console.log(`salesforce - Processing ${objectType.name} with ${fields.length} fields`);
    
    // Construct SOQL query
    const fieldList = fields.length > 0 ? fields.join(', ') : 'Id';
    
    let query;
    if (job.attrs.data.backfill) {
      query = `SELECT ${fieldList} FROM ${objectType.name} ORDER BY LastModifiedDate ASC LIMIT 2000`;
    } else {
      // Modified date range filter for incremental sync
      const startDate = new Date(startTime).toISOString();
      const endDate = new Date(currentJobStartTime).toISOString();
      query = `SELECT ${fieldList} FROM ${objectType.name} WHERE LastModifiedDate >= ${startDate} AND LastModifiedDate <= ${endDate} ORDER BY LastModifiedDate ASC LIMIT 2000`;
    }
    
    console.log(`salesforce - Executing SOQL query for ${objectType.name}:`, query.substring(0, 250) + (query.length > 250 ? '...' : ''));
    
    let done = false;
    
    while (!done) {
      try {
        await handleRateLimiting(externalId, job, limiter);
        
        let response;
        
        if (queryMoreUrl) {
          // Use queryMore URL if we have one from a previous query
          console.log(`salesforce - Executing queryMore for ${objectType.name} with URL: ${queryMoreUrl.substring(0, 100)}...`);
          response = await axios.get(
            `${instanceUrl}${queryMoreUrl}`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              }
            }
          );
        } else {
          // Initial query
          response = await axios.get(
            `${instanceUrl}/services/data/v58.0/query`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
              params: {
                q: query
              }
            }
          );
        }
        
        // Log query results
        if (response.data) {
          console.log(`salesforce - Query results for ${objectType.name}: totalSize=${response.data.totalSize || 0}, done=${response.data.done}, records=${response.data.records ? response.data.records.length : 0}`);
          
          // If we didn't get any records but expected some, log more details
          if ((!response.data.records || response.data.records.length === 0) && objectType.name === 'Account') {
            console.warn(`salesforce - No Account records found. This may indicate permissions issues or empty org. Check field-level security in Salesforce.`);
          }
        }
        
        if (response.data.records && response.data.records.length > 0) {
          // Transform records for storage
          const batchTransformedRecords = response.data.records.map(record => {
            // Remove attributes and null values from nested objects
            const cleanRecord = { ...record };
            delete cleanRecord.attributes;
            
            // Clean any nested records recursively
            Object.keys(cleanRecord).forEach(key => {
              if (cleanRecord[key] && typeof cleanRecord[key] === 'object') {
                if (cleanRecord[key].attributes) {
                  delete cleanRecord[key].attributes;
                }
                // Remove null/undefined values
                Object.keys(cleanRecord[key]).forEach(nestedKey => {
                  if (cleanRecord[key][nestedKey] === null) {
                    delete cleanRecord[key][nestedKey];
                  }
                });
              } else if (cleanRecord[key] === null) {
                delete cleanRecord[key];
              }
            });
            
            return {
              record: cleanRecord,
              metadata: {
                sourceId: sourceId,
                objectType: objectType.name,
                sourceType: 'salesforce',
                createdAt: new Date(),
                updatedAt: new Date(),
                jobHistoryId: savedJobHistory._id
              }
            };
          });
          
          // Add batch to overall transformedRecords for later use
          transformedRecords = [...transformedRecords, ...batchTransformedRecords];
          
          // Store records in batches
          for (let i = 0; i < batchTransformedRecords.length; i += BATCH_SIZE) {
            const batch = batchTransformedRecords.slice(i, i + BATCH_SIZE);
            let retries = 0;
            let success = false;
            
            while (!success && retries < MAX_RETRIES) {
              try {
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
          
          // Check if there are more records to fetch
          if (response.data.nextRecordsUrl) {
            queryMoreUrl = response.data.nextRecordsUrl;
          } else {
            done = true;
          }
        } else {
          done = true;
        }
        
        console.log(`salesforce - Downloaded ${records.length} records for ${objectType.name}`);
      } catch (error) {
        console.error(`salesforce - Error downloading records for ${objectType.name}:`, error);
        throw error;
      }
    }
    
    // Process relationships for certain entity types
    if (objectType.name === 'Contact' || objectType.name === 'Account' || objectType.name === 'Opportunity') {
      await processEntityRelationships(
        transformedRecords,
        objectType.name,
        sourceId,
        TokenModel,
        token,
        instanceUrl,
        workspaceId,
        job,
        limiter,
        workspaceConnection.collection(`source_${sourceId}_stream`),
        workspaceConnection.collection(`source_${sourceId}_consolidated`)
      );
    }
    
    return records;
  } catch (error) {
    console.error(`salesforce - Error in downloadObjectRecords for ${objectType.name}:`, error);
    throw error;
  }
}

// Process relationships between entities
async function processEntityRelationships(records, objectType, sourceId, TokenModel, token, instanceUrl, workspaceId, job, limiter, streamCollection, consolidatedCollection) {
  console.log(`salesforce - Processing relationships for ${records.length} ${objectType} records`);
  
  const accessToken = await getValidToken(TokenModel, token, workspaceId);
  const tokenData = token.toObject ? token.toObject() : token;
  const externalId = tokenData.externalId;
  
  // Define relationship mappings
  const relationshipQueries = {
    'Contact': [
      {
        toType: 'Account',
        queryField: 'AccountId',
        relationshipType: 'employment'
      }
    ],
    'Account': [
      {
        toType: 'Account',
        queryField: 'ParentId',
        relationshipType: 'parent_subsidiary'
      }
    ],
    'Opportunity': [
      {
        toType: 'Account',
        queryField: 'AccountId',
        relationshipType: 'business'
      }
    ]
  };
  
  for (const record of records) {
    const sourceEntityId = record.record.Id;
    if (!sourceEntityId) continue;
    
    const relationships = relationshipQueries[objectType] || [];
    
    for (const relationship of relationships) {
      const targetEntityId = record.record[relationship.queryField];
      
      // Skip if no relationship exists
      if (!targetEntityId) continue;
      
      // Create relationship record
      const relationshipId = `${objectType}_${sourceEntityId}_${relationship.toType}_${targetEntityId}`;
      
      const relationshipRecord = {
        record: {
          id: relationshipId,
          source: {
            id: sourceEntityId,
            type: mapSalesforceTypeToGeneric(objectType),
            externalId: sourceEntityId
          },
          target: {
            id: targetEntityId,
            type: mapSalesforceTypeToGeneric(relationship.toType),
            externalId: targetEntityId
          },
          relationshipType: relationship.relationshipType,
          attributes: {}
        },
        metadata: {
          sourceId: sourceId,
          objectType: 'relationship',
          relationshipType: relationship.relationshipType,
          sourceEntityType: objectType,
          targetEntityType: relationship.toType,
          sourceType: 'salesforce',
          createdAt: new Date(),
          updatedAt: new Date(),
          jobHistoryId: record.metadata.jobHistoryId
        }
      };
      
      // Add any specific attributes for this relationship type
      if (objectType === 'Contact' && relationship.toType === 'Account') {
        // For Contact-Account relationships, include job title and department
        relationshipRecord.record.attributes.title = record.record.Title || '';
        relationshipRecord.record.attributes.department = record.record.Department || '';
      }
      
      // Store the relationship in stream collection
      await streamCollection.updateOne(
        { 
          'record.id': relationshipId,
          'metadata.objectType': 'relationship'
        },
        { $set: relationshipRecord },
        { upsert: true }
      );
    }
  }
}

// Map Salesforce object types to generic entity types
function mapSalesforceTypeToGeneric(salesforceType) {
  const typeMap = {
    'Contact': 'person',
    'Account': 'organization',
    'Opportunity': 'deal',
    'Case': 'ticket',
    'Event': 'event'
  };
  
  return typeMap[salesforceType] || salesforceType;
}

// Setup Pub/Sub API subscriptions
async function setupPubSubSubscriptions(TokenModel, token, instanceUrl, workspaceId, job, limiter, sourceId) {
  try {
    // Get configuration
    const config = require('./config.json');
    
    // Check if Pub/Sub is enabled in config
    const pubsubEnabled = config.features?.pubsub?.enabled !== false;
    const autoDetect = config.features?.pubsub?.autoDetect !== false;
    
    // Skip if Pub/Sub is explicitly disabled
    if (!pubsubEnabled && !autoDetect) {
      console.log('salesforce - Skipping Pub/Sub setup - feature disabled in config');
      return 0;
    }

    // Get the source to check if we already know Pub/Sub status
    const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
    const workspaceConnection = await mongoose.createConnection(dataLakeUri).asPromise();
    const Source = workspaceConnection.model('Source', mongoose.Schema({
      importMethod: String
    }));
    
    const source = await Source.findOne({ _id: sourceId }).exec();
    
    // If source already has importMethod set to polling, skip setup
    if (source && source.importMethod === 'polling') {
      console.log('salesforce - Skipping Pub/Sub setup - previously determined to be unavailable for this source');
      await workspaceConnection.close();
      return 0;
    }
    
    // If source already has importMethod set to pub/sub, we can skip testing
    if (source && source.importMethod === 'pub/sub') {
      console.log('salesforce - Pub/Sub already set up successfully for this source');
      await workspaceConnection.close();
      return 1; // Return non-zero to indicate it's set up
    }
    
    await workspaceConnection.close();

    console.log('salesforce - Setting up Pub/Sub subscriptions');
    
    // Get token information and validate
    const accessToken = await getValidToken(TokenModel, token, workspaceId);
    if (!accessToken) {
      console.error('salesforce - Failed to get valid token for Pub/Sub setup');
      return 0;
    }
    
    const tokenData = token.toObject ? token.toObject() : token;
    const externalId = tokenData.externalId;
    
    // List available channels
    try {
      await handleRateLimiting(externalId, job, limiter);
      const result = await listPubSubChannels(accessToken, instanceUrl, config, sourceId, workspaceId);
      
      // Check if the API call was successful
      if (!result.success) {
        if (result.reason === 'api_not_available') {
          console.log('salesforce - Pub/Sub API not available in this Salesforce org. This is normal for some Salesforce editions.');
          return 0;
        } else if (result.reason === 'feature_disabled') {
          console.log('salesforce - Pub/Sub feature is disabled in configuration');
          return 0;
        } else {
          console.error(`salesforce - Error accessing Pub/Sub channels: ${result.message}`);
          return 0;
        }
      }
      
      const channels = result.channels;
      
      // Filter for standard channels we want to subscribe to
      const standardChannels = config.pubsubChannels.standardObjects.filter(channel => 
        channels.some(c => c.channelName === channel)
      );
      
      // Subscribe to standard channels
      for (const channel of standardChannels) {
        try {
          await handleRateLimiting(externalId, job, limiter);
          const result = await createPubSubSubscription(accessToken, instanceUrl, externalId, channel, config, sourceId, workspaceId);
          
          if (result.success) {
            console.log(`salesforce - Successfully subscribed to channel: ${channel}`);
          } else {
            if (result.reason === 'api_not_available') {
              console.log('salesforce - Pub/Sub API not available in this Salesforce org. This is normal for some Salesforce editions.');
              // Break the loop since other subscriptions will also fail
              break;
            } else if (result.reason === 'feature_disabled') {
              console.log('salesforce - Pub/Sub feature is disabled in configuration');
              // Break the loop since other subscriptions will also be disabled
              break;
            } else {
              console.error(`salesforce - Error subscribing to channel ${channel}: ${result.message}`);
            }
          }
        } catch (error) {
          console.error(`salesforce - Error subscribing to channel ${channel}:`, error.message);
          // Continue to next channel even if one fails
        }
      }
      
      // Subscribe to any configured custom channels
      for (const channel of config.pubsubChannels.customEvents) {
        if (channels.some(c => c.channelName === channel)) {
          try {
            await handleRateLimiting(externalId, job, limiter);
            const result = await createPubSubSubscription(accessToken, instanceUrl, externalId, channel, config, sourceId, workspaceId);
            
            if (result.success) {
              console.log(`salesforce - Successfully subscribed to custom channel: ${channel}`);
            } else {
              if (result.reason === 'api_not_available') {
                console.log('salesforce - Pub/Sub API not available in this Salesforce org. This is normal for some Salesforce editions.');
                // Break the loop since other subscriptions will also fail
                break;
              } else if (result.reason === 'feature_disabled') {
                console.log('salesforce - Pub/Sub feature is disabled in configuration');
                // Break the loop since other subscriptions will also be disabled
                break;
              } else {
                console.error(`salesforce - Error subscribing to custom channel ${channel}: ${result.message}`);
              }
            }
          } catch (error) {
            console.error(`salesforce - Error subscribing to custom channel ${channel}:`, error.message);
          }
        }
      }
      
      return standardChannels.length;
    } catch (error) {
      // Handle any other errors in the Pub/Sub API call
      console.error('salesforce - Error in Pub/Sub setup:', error.message);
      return 0;
    }
  } catch (error) {
    // Catch any other errors in the setup process
    console.error('salesforce - Error setting up Pub/Sub subscriptions:', error.message);
    return 0;
  }
}

module.exports = {
  job: async (job, done) => {
    // Initialize job parameters and configurations
    const { sourceId, workspaceId, backfill, usePolling = true } = job.attrs.data;
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

    // Define models explicitly on the workspace connection
    const Source = workspaceConnection.model('Source', SourceSchema);
    const Token = workspaceConnection.model('Token', TokenSchema);
    const JobHistory = workspaceConnection.model('JobHistory', JobHistorySchema);

    // Use the correct connection to find the Source
    console.log(`salesforce - Attempting to find Source ${sourceId} in workspace db...`);
    const source = await Source.findOne({ _id: sourceId }).exec();
    if (!source) {
        console.error(`salesforce - Source ${sourceId} not found in workspace DB. Aborting job.`);
        await workspaceConnection.close();
        done(new Error(`Source with ID ${sourceId} not found`));
        return;
    }
    console.log(`salesforce - Source ${sourceId} found successfully.`);
    
    // Check for legacy config format and update to new importMethod format if needed
    if (source.config && (source.config.usePubSub !== undefined || source.config.usePolling !== undefined)) {
      console.log('salesforce - Detected legacy configuration format, upgrading to new format');
      let importMethod = 'polling'; // Default to polling
      
      // If Pub/Sub was enabled and polling was disabled, use pub/sub
      if (source.config.usePubSub === true && source.config.usePolling === false) {
        importMethod = 'pub/sub';
      }
      
      // Update the source with the new format
      try {
        await Source.updateOne(
          { _id: sourceId },
          { 
            $set: { 'importMethod': importMethod },
            $unset: { 'config.usePubSub': "", 'config.usePolling': "" }
          }
        );
        console.log(`salesforce - Updated source to use importMethod: ${importMethod}`);
        
        // Update the local source object too
        source.importMethod = importMethod;
      } catch (updateError) {
        console.error('salesforce - Error updating source format:', updateError);
      }
    }
    
    // Check if we should skip polling based on source configuration
    if (!backfill) {
      // If source has Pub/Sub enabled and this is not a backfill job
      if (source.importMethod === 'pub/sub') {
        // We can skip polling for normal sync jobs (non-backfill) if we're using Pub/Sub
        console.log('salesforce - Skipping polling job as Pub/Sub is active for this source');
        
        // Create job history record
        const skipJobHistory = await JobHistory.create({
          jobId: job.id,
          sourceId: source._id,
          status: 'completed',
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          name: 'salesforce',
          message: 'Skipped polling job as Pub/Sub is active'
        });
        
        // Complete the job successfully
        await workspaceConnection.close();
        done();
        return;
      } else if (source.importMethod === undefined) {
        // If importMethod is not set yet, make sure we run the Pub/Sub detection
        console.log('salesforce - No importMethod detected, will run Pub/Sub detection');
      }
    }

    let ingressBytes = 0;
    let apiCalls = 0;
    let savedJobHistory;
    const jobStartTime = new Date();
    // Track errors but don't fail the job unless critical
    let nonCriticalErrors = [];
    // Flag to track if we have encountered a critical error
    let hasCriticalError = false;

    try {
      console.log('salesforce - Job started for source:', sourceId);

      savedJobHistory = await JobHistory.create({
        jobId: job.id,
        sourceId: source._id,
        status: 'in_progress',
        startTime: jobStartTime.toISOString(),
        name: 'salesforce'
      });

      // Create two separate rate limiters
      const defaultLimiter = new RedisRateLimiter({
        client: redisClient,
        namespace: "salesforce:default:",
        interval: RATE_LIMITS.default.intervalMs,
        maxInInterval: RATE_LIMITS.default.requestsPerInterval
      });

      const searchLimiter = new RedisRateLimiter({
        client: redisClient,
        namespace: "salesforce:search:",
        interval: RATE_LIMITS.search.intervalMs,
        maxInInterval: RATE_LIMITS.search.requestsPerInterval
      });

      const token = await Token.findById(source.tokenId).exec();
      console.log('salesforce - Token found:', token ? 'Yes' : 'No');
      if (!token) {
        throw new Error(`Token with ID ${source.tokenId} not found`);
      }

      const tokenData = token.toObject ? token.toObject() : token;
      if (!tokenData.externalId) {
        throw new Error('External ID not found in token');
      }
      
      const instanceUrl = tokenData.instanceUrl;
      if (!instanceUrl) {
        throw new Error('Instance URL not found in token');
      }

      // First, validate that the token is usable at all before processing any objects
      try {
        console.log('salesforce - Validating token before starting job');
        await getValidToken(Token, token, workspaceId);
        console.log('salesforce - Token validation successful');
      } catch (tokenError) {
        if (tokenError.response?.data?.error === 'invalid_grant' || 
            tokenError.message.includes('refresh token')) {
          console.error('salesforce - CRITICAL ERROR: Token validation failed, authentication error:', 
                       tokenError.response?.data?.error_description || tokenError.message);
          
          await handleApiError(tokenError, savedJobHistory, 'TokenValidation', JobHistory);
          
          // Set job as failed and exit early
          await JobHistory.findByIdAndUpdate(savedJobHistory._id, { 
            status: 'failed',
            errors: [{
              message: 'Authentication failed. Token is invalid or expired. Re-authorization required.',
              timestamp: new Date(),
              critical: true
            }]
          });
          
          console.error('salesforce - Job failed due to authentication error. Re-authorization required.');
          throw new Error('Authentication failed. Token is invalid or expired.');
        }
      }

      // Step 1: Discover custom objects
      console.log('salesforce - Step 1: Discovering custom objects');
      let customObjects = [];
      try {
        customObjects = await discoverCustomObjects(Token, token, instanceUrl, workspaceId, job, defaultLimiter);
      } catch (error) {
        await handleApiError(error, savedJobHistory, 'discoverCustomObjects', JobHistory);
        
        // Check if this was a critical error (like auth failure)
        if (error.response?.data?.error === 'invalid_grant' || 
            error.response?.status === 401 ||
            error.message.includes('refresh token')) {
          
          console.error('salesforce - Critical error in discovering custom objects, cannot proceed with job');
          hasCriticalError = true;
          throw error; // Rethrow critical errors to exit the job
        }
        
        console.error('salesforce - Error discovering custom objects:', error.message);
        nonCriticalErrors.push({
          step: 'discoverCustomObjects',
          error: error.message,
          timestamp: new Date().toISOString()
        });
        // Continue with empty customObjects array for non-critical errors
      }
      
      // Step 2: Create object download list
      console.log('salesforce - Step 2: Creating object download list');
      const objectDownloadList = createObjectDownloadList(STANDARD_OBJECTS, customObjects);

      // Step 3: Download records for each object
      console.log('salesforce - Step 3: Downloading records for each object');
      for (const objectType of objectDownloadList) {
        // Skip if we already encountered a critical error
        if (hasCriticalError) {
          console.log(`salesforce - Skipping object type ${objectType.name} due to previous critical error`);
          continue;
        }
        
        try {
          console.log(`salesforce - Processing object type: ${objectType.name}`);
          await downloadObjectRecords(
            objectType,
            source._id,
            Token,
            token,
            instanceUrl,
            workspaceId,
            tokenData.externalId,
            job,
            searchLimiter,
            savedJobHistory,
            JobHistory,
            workspaceConnection
          );
          console.log(`salesforce - Completed object type: ${objectType.name}`);
        } catch (error) {
          // Check if this is a critical error (auth failure, etc.)
          const isOAuthError = error.response?.data?.error === 'invalid_grant' || 
                              error.response?.data?.error === 'invalid_token';
                              
          if (isOAuthError || error.response?.status === 401) {
            await handleApiError(error, savedJobHistory, objectType.name, JobHistory);
            hasCriticalError = true;
            console.error(`salesforce - Critical authentication error encountered. Stopping job processing.`);
            break; // Exit the loop on critical errors
          }
                              
          // Record the error but don't fail the job for non-critical errors
          nonCriticalErrors.push({
            step: `downloadObjectRecords-${objectType.name}`,
            error: error.message,
            timestamp: new Date().toISOString()
          });
          
          await handleApiError(error, savedJobHistory, objectType.name, JobHistory);
          console.log(`salesforce - Error processing object type ${objectType.name}, continuing with next object`);
          // Continue with next object type for non-critical errors
        }
      }

      // If we had a critical error, don't try to set up Pub/Sub
      if (hasCriticalError) {
        console.log('salesforce - Skipping Pub/Sub setup due to critical errors');
      } else {
        // Step 4: Setup Pub/Sub API subscriptions for real-time updates
        console.log('salesforce - Step 4: Setting up Pub/Sub API subscriptions');
        try {
          const subscriptionCount = await setupPubSubSubscriptions(
            Token,
            token,
            instanceUrl,
            workspaceId,
            job,
            defaultLimiter,
            source._id
          );
          console.log(`salesforce - Setup ${subscriptionCount} Pub/Sub subscriptions`);
        } catch (error) {
          // OAuth errors are critical
          if (error.response?.data?.error === 'invalid_grant' || 
              error.response?.data?.error === 'invalid_token') {
            await handleApiError(error, savedJobHistory, 'Pub/Sub Setup', JobHistory);
            hasCriticalError = true;
          } else {
            // 404s and other Pub/Sub-specific errors are not critical
            console.log('salesforce - Pub/Sub setup failed, but continuing with job:', error.message);
            nonCriticalErrors.push({
              step: 'setupPubSubSubscriptions',
              error: error.message,
              timestamp: new Date().toISOString()
            });
          }
        }
      }

      if (hasCriticalError) {
        console.log('salesforce - Job completed with critical errors - re-authorization required');
      } else if (nonCriticalErrors.length > 0) {
        console.log(`salesforce - Job completed with ${nonCriticalErrors.length} non-critical errors`);
      } else {
        console.log('salesforce - Job completed successfully with no errors');
      }
      
      // If we have non-critical errors, add them to the job history
      if (nonCriticalErrors.length > 0 && !hasCriticalError) {
        await JobHistory.findByIdAndUpdate(savedJobHistory._id, {
          $push: { errors: { $each: nonCriticalErrors } }
        });
      }
    } catch (err) {
      // Handle overall job error (critical errors that should fail the job)
      console.error(`salesforce - Critical job error:`, err.message);
      await handleApiError(err, savedJobHistory, 'Overall Job', JobHistory);
      hasCriticalError = true;
    } finally {
      const jobEndTime = new Date();
      const runtimeMilliseconds = jobEndTime - jobStartTime;

      if (savedJobHistory && JobHistory) {
        try {
          let finalStatus = 'complete';
          
          if (savedJobHistory.status === 'skipped') {
            finalStatus = 'skipped';
          } else if (hasCriticalError || (savedJobHistory.errors && savedJobHistory.errors.some(e => e.critical))) {
            finalStatus = 'failed';
          } else if (nonCriticalErrors.length > 0) {
            finalStatus = 'complete_with_errors';
          }
                              
          await JobHistory.findByIdAndUpdate(savedJobHistory._id, { 
            status: finalStatus,
            lastFinishedAt: new Date().toISOString(),
            startTime: jobStartTime.toISOString(),
            endTime: jobEndTime.toISOString(),
            runtimeMilliseconds
          });
          
          // Check if this was a backfill job that completed successfully
          if (job.attrs.data.backfill && finalStatus !== 'failed') {
            console.log('salesforce - Backfill completed, checking importMethod status');
            
            // Get the source to check if importMethod is already set
            const sourceAfterJob = await Source.findById(sourceId).exec();
            
            // If importMethod not set yet, determine it now based on Pub/Sub success
            if (!sourceAfterJob.importMethod) {
              console.log('salesforce - No importMethod set, determining based on Pub/Sub setup');
              
              // Try to set up Pub/Sub if it wasn't set up during the job
              let pubSubSuccess = false;
              try {
                // Find out if Pub/Sub was successfully set up
                const token = await Token.findById(source.tokenId).exec();
                if (token) {
                  const tokenData = token.toObject ? token.toObject() : token;
                  const instanceUrl = tokenData.instanceUrl;
                  
                  // Try to set up Pub/Sub subscriptions
                  const subscriptionCount = await setupPubSubSubscriptions(
                    Token,
                    token,
                    instanceUrl,
                    workspaceId,
                    job,
                    defaultLimiter,
                    source._id
                  );
                  
                  pubSubSuccess = subscriptionCount > 0;
                }
              } catch (error) {
                console.error('salesforce - Error checking Pub/Sub status:', error.message);
                pubSubSuccess = false;
              }
              
              // Now set the importMethod and schedule polling if needed
              if (pubSubSuccess) {
                console.log('salesforce - Pub/Sub is available, using pub/sub mode');
                await Source.findByIdAndUpdate(sourceId, { importMethod: 'pub/sub' });
              } else {
                console.log('salesforce - Pub/Sub not available, configuring polling mode');
                await Source.findByIdAndUpdate(sourceId, { importMethod: 'polling' });
                
                // Schedule recurring polling job using Agenda
                try {
                  const Agenda = require('agenda');
                  const mongoUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
                  
                  // Create a new Agenda instance just for scheduling this job
                  const pollingAgenda = new Agenda({ db: { address: mongoUri, collection: 'jobs' } });
                  
                  // Wait for Agenda to be ready
                  await new Promise((resolve) => {
                    pollingAgenda.on('ready', async () => {
                      try {
                        // Create the recurring polling job
                        const pollingJob = await pollingAgenda.create('salesforce', {
                          sourceId,
                          workspaceId,
                          backfill: false
                        });
                        
                        // Set it to repeat every 15 minutes
                        await pollingJob.repeatEvery('15 minutes', {
                          skipImmediate: true // Skip immediate run since we just completed the backfill
                        });
                        
                        await pollingJob.save();
                        console.log('salesforce - Successfully scheduled recurring polling job (every 15 minutes)');
                        resolve();
                      } catch (scheduleError) {
                        console.error('salesforce - Error scheduling recurring job:', scheduleError);
                        resolve();
                      }
                    });
                    
                    // Add timeout in case Agenda connection fails
                    setTimeout(() => resolve(), 5000);
                  });
                  
                  // Close the Agenda connection
                  try {
                    await pollingAgenda.stop();
                  } catch (stopError) {
                    console.error('salesforce - Error stopping Agenda:', stopError);
                  }
                } catch (agendaError) {
                  console.error('salesforce - Error initializing Agenda for polling:', agendaError);
                }
              }
            }
          }
          
          // Log the final job state clearly
          if (finalStatus === 'failed') {
            console.error(`salesforce - Job FAILED for source ID: ${sourceId} due to critical errors`);
          } else if (finalStatus === 'complete_with_errors') {
            console.warn(`salesforce - Job completed with non-critical errors for source ID: ${sourceId}`);
          } else {
            console.log(`salesforce - Job completed successfully for source ID: ${sourceId}`);
          }
        } catch (historyError) {
          console.error('Failed to update job history in finally block:', historyError.message);
        }
      }

      await workspaceConnection.close();
      done();
    }
  }
}; 
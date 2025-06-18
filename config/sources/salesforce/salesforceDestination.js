/**
 * Salesforce Destination Job Handler
 * 
 * This job handles two types of syncs:
 * 1. Initial sync: Sync all records from Outrun to Salesforce when a destination is first created
 * 2. Incremental sync: Sync individual records when they are updated in Outrun
 */

const mongoose = require('mongoose');
const axios = require('axios');
const { getValidToken, refreshToken, createConnection, publishToPubSub } = require('../../providers/salesforce/api');
const { DestinationSchema, TokenSchema, JobHistorySchema } = require('../../data/models');
const config = require('./config.json'); // Import the config file
require('dotenv').config(); // Load environment variables from .env
const { RedisRateLimiter } = require("rolling-rate-limiter");
const { logInfo, logError, logSuccess, logWarning } = require('../../utils/logger');

// Number of records to process per batch in initial sync
const BATCH_SIZE = 50;

// Rate limiter constants
const RATE_LIMITS = {
  default: {
    requestsPerInterval: 100,
    intervalMs: 10000 // 10 seconds
  }
};

/**
 * Handle rate limiting using Redis to ensure we don't exceed Salesforce's API quotas
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
 * Get the field mappings from the config
 */
function getFieldMappingsFromConfig(objectType, config) {
  if (!config || !config.destinationMapping) {
    logWarning('config', 'No destination mapping found in config, using defaults');
    return { mappings: {}, availableFields: [] };
  }
  
  // Get the right section from the config based on the object type
  const mappings = config.destinationMapping[objectType];
  if (!mappings) {
    logWarning('config', `No mapping found for ${objectType} in config, using defaults`);
    return { mappings: {}, availableFields: [] };
  }
  
  // Return the field mappings
  return mappings;
}

/**
 * Get the appropriate field mappings for a Salesforce object type
 */
function getSalesforceFieldMapping(objectType, config) {
  // If no config provided, use the imported config at module level
  if (!config) {
    config = require('./config.json');
  }
  
  // Get field mappings directly from config
  if (config && config.destinationMapping && config.destinationMapping[objectType]) {
    const objectConfig = config.destinationMapping[objectType];
    
    // Use fieldMappings if defined in config
    if (objectConfig.fieldMappings && Object.keys(objectConfig.fieldMappings).length > 0) {
      console.log(`Using field mappings from config for ${objectType}`);
      return objectConfig.fieldMappings;
    }
    
    // If fieldMappings not defined but availableFields exists, generate mappings
    if (Array.isArray(objectConfig.availableFields) && objectConfig.availableFields.length > 0) {
      console.log(`Generating field mappings from availableFields for ${objectType}`);
      const fieldMappings = {};
      
      // Map fields using object type mappings
      const sfObjectType = getSalesforceObjectType(objectType);
      
      // Get the appropriate mapping section based on object type
      let mappingSource = null;
      if (config.objects) {
        if (sfObjectType === 'Contact' && config.objects.Contact && config.objects.Contact.peopleMapping) {
          mappingSource = config.objects.Contact.peopleMapping;
        } else if (sfObjectType === 'Account' && config.objects.Account && config.objects.Account.organizationsMapping) {
          mappingSource = config.objects.Account.organizationsMapping;
        }
      }
      
      if (mappingSource) {
        // Use the mapping source to create field mappings
        objectConfig.availableFields.forEach(field => {
          if (mappingSource[field]) {
            // Handle both string and array/object mappings
            if (typeof mappingSource[field] === 'string') {
              fieldMappings[field] = mappingSource[field];
            } else if (Array.isArray(mappingSource[field]) && mappingSource[field].length > 0) {
              // For arrays (like phoneNumbers), use the first element's mapping
              if (typeof mappingSource[field][0] === 'object' && mappingSource[field][0].number) {
                fieldMappings[field] = mappingSource[field][0].number;
              }
            }
          }
        });
      } else {
        // Fallback: generate basic mappings using PascalCase conversion
        objectConfig.availableFields.forEach(field => {
          // Special handling for known fields
          if (field === 'companyName' && sfObjectType === 'Account') {
            fieldMappings[field] = 'Name';
          } else if (field === 'emailAddress' && sfObjectType === 'Contact') {
            fieldMappings[field] = 'Email';
          } else {
            // Convert to PascalCase for Salesforce fields
            const sfField = field.charAt(0).toUpperCase() + field.slice(1);
            fieldMappings[field] = sfField;
          }
        });
      }
      
      console.log(`Generated field mappings for ${objectType}:`, fieldMappings);
      return fieldMappings;
    }
  }
  
  // Fallback to consolidation mapping if exists
  if (config && config.consolidationMapping) {
    const sfObjectType = getSalesforceObjectType(objectType);
    
    if (config.consolidationMapping[sfObjectType]) {
      console.log(`Using consolidation mapping for ${sfObjectType}`);
      
      // Create reversed mapping (from Salesforce field names to our field names)
      const mapping = {};
      const consolidation = config.consolidationMapping[sfObjectType];
      
      // Invert the mapping (our field -> SF field becomes SF field -> our field)
      Object.entries(consolidation).forEach(([ourField, sfField]) => {
        mapping[ourField] = sfField;
      });
      
      // Map specific fields based on object type
      if (sfObjectType === 'Contact') {
        mapping.firstName = consolidation.firstName || 'FirstName';
        mapping.lastName = consolidation.lastName || 'LastName';
        mapping.emailAddress = consolidation.email || 'Email';
        mapping.phoneNumbers = consolidation.phone || 'Phone';
      } else if (sfObjectType === 'Account') {
        mapping.companyName = consolidation.name || 'Name';
        mapping.website = consolidation.website || 'Website';
        mapping.phoneNumbers = consolidation.phone || 'Phone';
      }
      
      return mapping;
    }
  }
  
  // Last resort fallback for basic mappings
  console.log(`No mapping found in config for ${objectType}, using basic fallback`);
  
  // Map our internal object types to Salesforce object types
  const salesforceObjectType = getSalesforceObjectType(objectType);
  
  // If no config or no mapping found, use default mappings
  switch (salesforceObjectType) {
    case 'Contact':
      return {
        'firstName': 'FirstName',
        'lastName': 'LastName',
        'emailAddress': 'Email',
        'phoneNumbers': 'Phone',
        'jobTitle': 'Title'
      };
    case 'Account':
      return {
        'companyName': 'Name',
        'website': 'Website',
        'industry': 'Industry',
        'description': 'Description',
        'phoneNumbers': 'Phone'
      };
    default:
      return {};
  }
}

/**
 * Map internal object types to Salesforce object types
 */
function getSalesforceObjectType(internalObjectType) {
  // First try to use the mapping from config
  if (config && config.objectTypeMapping) {
    // The config.objectTypeMapping is structured with internal types as keys
    // and arrays of external types as values
    const mappedTypes = config.objectTypeMapping[internalObjectType];
    if (Array.isArray(mappedTypes) && mappedTypes.length > 0) {
      // Use the first external type in the array for this internal type
      console.log(`Mapped ${internalObjectType} to ${mappedTypes[0]} using objectTypeMapping from config`);
      return mappedTypes[0];
    }
  }
  
  // If not found in config, use hardcoded mappings as fallback
  switch (internalObjectType.toLowerCase()) {
    case 'people':
    case 'person':
    case 'contact':
      return 'Contact';
    case 'organizations':
    case 'organization':
    case 'company':
      return 'Account';
    case 'opportunities':
    case 'opportunity':
    case 'deal':
      return 'Opportunity';
    default:
      return internalObjectType;
  }
}

/**
 * Extract the Salesforce ID from a record if it exists
 * This checks for both direct salesforceId field and the externalIds object
 */
function getSalesforceIdFromRecord(record, objectType) {
  console.log('Checking for Salesforce ID in record:', JSON.stringify({
    hasSalesforceId: !!record.salesforceId,
    hasExternalIds: !!record.externalIds,
    externalIdKeys: record.externalIds ? Object.keys(record.externalIds) : []
  }));
  
  // First, check for direct salesforceId field
  if (record.salesforceId) {
    console.log(`Found direct salesforceId: ${record.salesforceId}`);
    return record.salesforceId;
  }
  
  // Next, check in externalIds.salesforce
  if (record.externalIds && record.externalIds.salesforce && Array.isArray(record.externalIds.salesforce)) {
    const salesforceIds = record.externalIds.salesforce.filter(id => 
      // For contacts and accounts, we need the correct type
      (objectType === 'Contact' && (id.type === 'contact' || id.type === 'object')) ||
      (objectType === 'Account' && (id.type === 'account' || id.type === 'object')) ||
      // For other object types, any salesforce ID will do
      (objectType !== 'Contact' && objectType !== 'Account')
    );
    
    if (salesforceIds.length > 0 && salesforceIds[0].id) {
      console.log(`Found Salesforce ID in externalIds.salesforce: ${salesforceIds[0].id}`);
      return salesforceIds[0].id;
    }
  }
  
  // Also check for sf_id field which might be set by the consolidation process
  if (record.sf_id) {
    console.log(`Found sf_id: ${record.sf_id}`);
    return record.sf_id;
  }
  
  console.log('No Salesforce ID found in record');
  // No Salesforce ID found
  return null;
}

/**
 * Get value from nested fields in a record (supports dot notation)
 */
function getNestedValue(record, fieldPath) {
  if (!fieldPath || !record) return undefined;
  
  const parts = fieldPath.split('.');
  let value = record;
  
  for (const part of parts) {
    if (value === null || value === undefined || typeof value !== 'object') {
      return undefined;
    }
    value = value[part];
  }
  
  return value;
}

/**
 * Format a phone number for Salesforce
 * Assumes the phone number is already in E.164 format from the consolidation step
 * @param {string} phoneNumber - The phone number to format (in E.164 format)
 * @returns {string} - Formatted phone number for Salesforce
 */
function formatPhoneForSalesforce(phoneNumber) {
  if (!phoneNumber) return '';
  
  // Since we expect E.164 format from consolidation, just do basic validation
  if (!phoneNumber.startsWith('+')) {
    console.log(`Unexpected phone format (not E.164): ${phoneNumber}, adding + prefix`);
    return `+${phoneNumber.replace(/\D/g, '')}`;
  }
  
  // Salesforce accepts E.164 format, so we can use it directly
  console.log(`Using E.164 phone number directly: ${phoneNumber}`);
  return phoneNumber;
}

/**
 * Map a record to the format expected by Salesforce
 */
function mapRecordToSalesforce(record, objectType, fieldMappings = {}, config = {}) {
  const attributes = {};
  
  console.log('Record fields available:', Object.keys(record));
  console.log('Field mappings provided:', Object.keys(fieldMappings).length > 0 ? 'Yes' : 'No');
  
  // If no config provided, use the imported config at module level
  if (!config || Object.keys(config).length === 0) {
    config = require('./config.json');
  }
  
  // If fieldMappings is empty, try to get them from config
  if (Object.keys(fieldMappings).length === 0) {
    console.log(`No field mappings provided for ${objectType}, trying to get them from config`);
    
    const configMappings = getSalesforceFieldMapping(objectType, config);
    if (configMappings && Object.keys(configMappings).length > 0) {
      console.log('Found mappings via helper:', Object.keys(configMappings).length);
      fieldMappings = configMappings;
    } else {
      console.log('No mappings found, using empty object');
      fieldMappings = {};
    }
  }
  
  console.log(`Mapping record for object type: ${objectType} with ${Object.keys(fieldMappings).length} field mappings`);
  
  // Loop through all the fields in the record
  for (const [field, mapping] of Object.entries(fieldMappings)) {
    // Get value from record, supporting nested fields with dot notation
    const value = getNestedValue(record, field);
    
    if (value !== undefined && value !== null) {
      console.log(`Mapping field ${field} to ${mapping}: ${value}`);
      
      // Special handling for phone fields to format them correctly for Salesforce
      if (field.toLowerCase().includes('phone')) {
        if (typeof value === 'string') {
          // Already in E.164 format from consolidation step
          attributes[mapping] = formatPhoneForSalesforce(value);
        } else if (Array.isArray(value) && value.length > 0) {
          // Handle phone numbers stored as array
          console.log(`Phone field is an array: ${JSON.stringify(value)}`);
          
          // Extract the first phone number from the array
          let phoneNumber = null;
          
          if (typeof value[0] === 'object' && value[0] !== null) {
            // Handle array of objects with number property
            // These should be in E.164 format from consolidation
            if (value[0].number) {
              phoneNumber = value[0].number;
            } else if (value[0].phoneNumber) {
              phoneNumber = value[0].phoneNumber;
            } else if (value[0].value) {
              // Some consolidated schemas use 'value' field
              phoneNumber = value[0].value;
            }
          } else if (typeof value[0] === 'string') {
            // Handle array of strings - use first one
            phoneNumber = value[0];
          }
          
          // Apply formatting if we found a phone number
          if (phoneNumber) {
            attributes[mapping] = formatPhoneForSalesforce(phoneNumber);
            console.log(`Using phone number: ${attributes[mapping]}`);
          }
        }
      } else {
        attributes[mapping] = value;
      }
    }
  }
  
  // Check for required fields based on config
  if (config && config.destinationMapping && config.destinationMapping[objectType]) {
    const objectConfig = config.destinationMapping[objectType];
    
    // If requiredFields is defined in the config, ensure all required fields are set
    if (Array.isArray(objectConfig.requiredFields) && objectConfig.requiredFields.length > 0) {
      console.log(`Checking for required fields: ${objectConfig.requiredFields.join(', ')}`);
      
      objectConfig.requiredFields.forEach(requiredField => {
        // Get the Salesforce field name for this required field
        let sfField = null;
        if (objectConfig.fieldMappings && objectConfig.fieldMappings[requiredField]) {
          sfField = objectConfig.fieldMappings[requiredField];
        } else if (fieldMappings[requiredField]) {
          sfField = fieldMappings[requiredField];
        }
        
        // If we found a field mapping and the attribute is not set
        if (sfField && !attributes[sfField]) {
          // Try to get the value from the record
          const value = getNestedValue(record, requiredField);
          if (value !== undefined && value !== null) {
            console.log(`Adding required field ${requiredField} -> ${sfField}: ${value}`);
            attributes[sfField] = value;
          } else {
            console.log(`WARNING: Required field ${requiredField} (${sfField}) is missing in the record`);
          }
        }
      });
    }
  }
  
  // Special case handling for required fields based on Salesforce object type
  const salesforceObjectType = getSalesforceObjectType(objectType);
  
  // Salesforce has specific required fields for standard objects
  if (salesforceObjectType === 'Account' && !attributes.Name && record.companyName) {
    console.log(`Adding Name field from companyName as it's required for Salesforce Account`);
    attributes.Name = record.companyName;
  } else if (salesforceObjectType === 'Contact' && !attributes.LastName && record.lastName) {
    console.log(`Adding LastName field as it's required for Salesforce Contact`);
    attributes.LastName = record.lastName;
  }
  
  console.log('Final mapped attributes:', attributes);
  
  return attributes;
}

/**
 * Process a job
 */
async function handleJob(job) {
  const jobId = job.attrs._id.toString();
  const { data } = job.attrs;
  const redisClient = job.attrs.redisClient;
  
  // Store the job in a global variable so it can be accessed by processIncrementalSync
  global.currentSalesforceJob = job;
  
  // Ensure Redis client is available and modify error handling
  if (!redisClient) {
    console.warn(`[salesforceDestination][${jobId}] ⚠️ Redis client not available. Using simple memory rate limiter instead.`);
  }
  
  console.log(`[salesforceDestination][${jobId}] Starting job with data:`, JSON.stringify({
    workspaceSlug: data.workspaceSlug,
    destinationId: data.destinationId, 
    collectionName: data.collectionName,
    objectType: data.objectType,
    objectId: data.objectId,
    isInitialSync: !!data.isInitialSync
  }));
  
  logInfo(jobId, `Starting Salesforce destination job with data: ${JSON.stringify(data)}`);
  
  const { 
    workspaceSlug, 
    destinationId, 
    collectionName, 
    objectType, 
    objectId, 
    isInitialSync,
    page
  } = data;
  
  // Important: validate the collectionName and objectType
  if (!objectType) {
    throw new Error('No object type provided');
  }
  
  // Ensure we have a valid collection name to work with
  let targetCollection = collectionName;
  if (!targetCollection || typeof targetCollection !== 'string') {
    // Fall back to using objectType as the collection name
    targetCollection = objectType;
    console.log(`[salesforceDestination][${jobId}] No valid collection name provided, using objectType '${objectType}' as the collection name`);
  } else {
    console.log(`[salesforceDestination][${jobId}] Using provided collection name: ${targetCollection}`);
  }
  
  // Validate required parameters
  if (!workspaceSlug) {
    throw new Error('No workspace slug provided');
  }
  
  if (!destinationId) {
    throw new Error('No destination ID provided');
  }
  
  // Set up connection to workspace database
  const workspaceDbUri = `${process.env.MONGODB_URI}/workspace_${workspaceSlug}?${process.env.MONGODB_PARAMS}`;
  
  logInfo(jobId, `Connecting to workspace database at ${workspaceDbUri}`);
  // Create a dedicated connection for this job
  let workspaceConnection = null;
  
  try {
    // Create and wait for workspace connection
    workspaceConnection = await mongoose.createConnection(workspaceDbUri).asPromise();
    workspaceConnection.set('maxTimeMS', 30000); // Set global timeout to 30 seconds
    
    // Define models explicitly on the workspace connection using imported schemas
    const Destination = workspaceConnection.model('Destination', DestinationSchema || new mongoose.Schema({}, { strict: false }));
    const Token = workspaceConnection.model('Token', TokenSchema || new mongoose.Schema({}, { strict: false }));
    
    logInfo(jobId, `Looking for destination with ID: ${destinationId} in collection: destinations`);
    const destination = await Destination.findById(destinationId).exec();
    
    if (!destination) {
      logError(jobId, `Destination ${destinationId} not found in collection destinations`);
      // Try with direct MongoDB query as fallback
      const directDestination = await workspaceConnection.collection('destinations').findOne({ 
        _id: new mongoose.Types.ObjectId(destinationId) 
      });
      
      if (directDestination) {
        logInfo(jobId, `Found destination using direct MongoDB query`);
        return await processDestination(directDestination, workspaceConnection, jobId, job, redisClient, {...data, targetCollection});
      }
      
      throw new Error(`Destination ${destinationId} not found`);
    } else {
      logInfo(jobId, `Found destination using Mongoose: ${destination.name}`);
      return await processDestination(destination, workspaceConnection, jobId, job, redisClient, {...data, targetCollection});
    }
  } catch (error) {
    logError(jobId, `Error processing job: ${error.message}`, error);
    // Propagate the error
    throw error;
  } finally {
    // Close connection if it was opened
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
 * Helper function to process a destination once found
 */
async function processDestination(destination, workspaceConnection, jobId, job, redisClient, data) {
  const { 
    objectType, 
    objectId,
    collectionName,
    targetCollection,
    fields, 
    fieldMappings = {},
    isInitialSync,
    page
  } = data;

  // Log more details about what we received
  console.log(`Processing destination with data:`, {
    jobId,
    objectType,
    objectId,
    collectionName,
    targetCollection,
    isInitialSync: !!isInitialSync,
    fieldsCount: fields?.length || 0
  });

  logInfo(jobId, `Processing destination details for ${destination.name}`);
  
  const tokenId = destination.tokenId;
  
  if (!tokenId) {
    throw new Error(`No token ID found for destination ${destination._id}`);
  }
  
  // Get the token from the database
  const Token = workspaceConnection.model('Token', TokenSchema || new mongoose.Schema({}, { strict: false }));
  
  logInfo(jobId, `Looking up token with ID: ${tokenId}`);
  const tokenRecord = await Token.findById(tokenId).exec();
  
  if (!tokenRecord) {
    // Try direct MongoDB query as fallback
    const directToken = await workspaceConnection.collection('tokens').findOne({
      _id: new mongoose.Types.ObjectId(tokenId)
    });
    
    if (!directToken) {
      throw new Error(`Token with ID ${tokenId} not found`);
    }
    
    logInfo(jobId, `Found token using direct MongoDB query`);
    
    // Use getValidToken to handle token refreshing
    try {
      // For direct token, we need to use it as is since it's not a mongoose model
      authToken = await getValidToken(Token, directToken, data.workspaceSlug);
      instanceUrl = directToken.instanceUrl;
      logInfo(jobId, `Retrieved valid token from direct token record: ${authToken.substring(0, 10)}...`);
    } catch (tokenError) {
      logError(jobId, `Failed to get valid token: ${tokenError.message}`, tokenError);
      throw new Error(`Failed to get valid token: ${tokenError.message}`);
    }
  } else {
    // Use getValidToken to handle token refreshing
    try {
      authToken = await getValidToken(Token, tokenRecord, data.workspaceSlug);
      instanceUrl = tokenRecord.instanceUrl;
      logInfo(jobId, `Retrieved valid token: ${authToken.substring(0, 10)}...`);
    } catch (tokenError) {
      logError(jobId, `Failed to get valid token: ${tokenError.message}`, tokenError);
      throw new Error(`Failed to get valid token: ${tokenError.message}`);
    }
  }
  
  // Extract field mappings from destination
  const destinationMappings = destination.mappings || {};
  
  // Determine which fields to sync based on the object type
  let fieldList = [];
  if (objectType === 'people' && destinationMappings.people?.fields) {
    fieldList = destinationMappings.people.fields;
    logInfo(jobId, `Using field list for people from destination: ${fieldList.join(', ')}`);
  } else if (objectType === 'organizations' && destinationMappings.organizations?.fields) {
    fieldList = destinationMappings.organizations.fields;
    logInfo(jobId, `Using field list for organizations from destination: ${fieldList.join(', ')}`);
  } else {
    // Use provided fields if no mappings are found in destination
    fieldList = fields || [];
    logInfo(jobId, `No mappings found in destination, using provided fields: ${fieldList.join(', ')}`);
  }
  
  // Create a rate limiter instance - either Redis-based or in-memory
  let rateLimiter;
  
  // Use Redis rate limiter if available, otherwise use memory limiter
  if (redisClient) {
    rateLimiter = new RedisRateLimiter({
      client: redisClient,
      namespace: "salesforce:destination:",
      interval: RATE_LIMITS.default.intervalMs,
      maxInInterval: RATE_LIMITS.default.requestsPerInterval
    });
    logInfo(jobId, `Using Redis rate limiter (${RATE_LIMITS.default.requestsPerInterval} requests per ${RATE_LIMITS.default.intervalMs}ms)`);
  } else {
    // Simple in-memory rate limiter as fallback
    const memoryLimiter = {
      lastRequest: 0,
      wouldLimitWithInfo: async () => ({ 
        blocked: false,
        actionsRemaining: 100,
        millisecondsUntilAllowed: 0
      }),
      limit: async () => true
    };
    rateLimiter = memoryLimiter;
    logInfo(jobId, "Using simple memory rate limiter (no limits)");
  }
  
  // Get the tokenData
  const tokenData = tokenRecord?.toObject ? tokenRecord.toObject() : tokenRecord;
  const externalId = tokenData.externalId;
  
  // Create a function to make Salesforce API requests with rate limiting
  const makeSalesforceRequest = async (method, endpoint, data = null) => {
    // Handle rate limiting
    await handleRateLimiting(externalId, job, rateLimiter);
    
    try {
      const baseUrl = instanceUrl;
      const fullUrl = `${baseUrl}${endpoint}`;
      
      const config = {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      };
      
      logInfo(jobId, `Making ${method.toUpperCase()} request to ${endpoint}`);
      
      let response;
      if (method.toLowerCase() === 'get') {
        response = await axios.get(fullUrl, config);
      } else if (method.toLowerCase() === 'post') {
        response = await axios.post(fullUrl, data, config);
      } else if (method.toLowerCase() === 'patch') {
        response = await axios.patch(fullUrl, data, config);
      } else if (method.toLowerCase() === 'delete') {
        response = await axios.delete(fullUrl, config);
      } else {
        throw new Error(`Unsupported method: ${method}`);
      }
      
      return response.data;
    } catch (error) {
      if (error.response) {
        logError(jobId, `Salesforce API error: ${error.response.status} ${JSON.stringify(error.response.data)}`);
        throw new Error(`Salesforce API error: ${error.response.status} ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  };
  
  // Get proper field mappings from config based on object type
  const configMappings = getSalesforceFieldMapping(objectType, config);
  // Merge provided field mappings with config mappings, prioritizing config
  const mergedFieldMappings = { ...fieldMappings, ...configMappings };
  
  logInfo(jobId, `Using field mappings for ${objectType}:`, mergedFieldMappings);
  
  // Process based on job type
  if (isInitialSync) {
    // Initial sync - process a batch of records
    const currentPage = page || 0;
    
    // Use the validated collection name (targetCollection) if available
    const syncCollectionName = targetCollection || collectionName;
    logInfo(jobId, `Using collection ${syncCollectionName} for initial sync of ${objectType}`);
    
    // Process initial sync
    const result = await processInitialSync(
      workspaceConnection,
      syncCollectionName,
      objectType,
      fieldList,
      mergedFieldMappings,
      currentPage,
      makeSalesforceRequest,
      jobId,
      destination,
      instanceUrl
    );
    
    // If there are more records, schedule the next page job
    if (result.hasMoreRecords) {
      // Create a new job for the next page
      const agenda = job.agenda;
      await agenda.now('salesforceDestination', {
        ...data,
        page: result.nextPage
      });
      
      logInfo(jobId, `Scheduled next page job for page ${result.nextPage}`);
    } else {
      logSuccess(jobId, `Initial sync completed for ${objectType}`);
    }
  } else {
    // Incremental sync - process a single record
    if (!objectId) {
      throw new Error('No object ID provided for incremental sync');
    }
    
    // Use the validated collection name (targetCollection) if available
    const syncCollectionName = targetCollection || collectionName;
    logInfo(jobId, `Using collection ${syncCollectionName} for incremental sync of ${objectType}`);
    
    // Process incremental sync
    await processIncrementalSync(
      workspaceConnection,
      syncCollectionName,
      objectType,
      objectId,
      fieldList,
      mergedFieldMappings,
      makeSalesforceRequest,
      jobId,
      destination,
      instanceUrl,
      authToken,
      externalId
    );
    
    logSuccess(jobId, `Incremental sync completed for ${objectType} ${objectId}`);
  }
  
  return { success: true };
}

/**
 * Process an initial sync by retrieving all objects from the database and sending to Salesforce
 */
async function processInitialSync(workspaceConnection, collectionName, objectType, fields, fieldMappings, page, makeSalesforceRequest, jobId, destination, instanceUrl) {
  logInfo(jobId, `Processing initial sync for ${objectType}`);
  
  // Ensure collectionName is a valid string
  if (!collectionName || typeof collectionName !== 'string') {
    // If collectionName is not provided or not a string, use objectType as fallback
    collectionName = objectType;
    logWarning(jobId, `Collection name not valid, using objectType "${objectType}" as collection name`);
  }
  
  // Create a dynamic model for the collection
  const Collection = workspaceConnection.model(collectionName, new mongoose.Schema({}, { 
    strict: false,
    collection: collectionName
  }));
  
  // Get destination config
  const { config: destinationConfig } = destination || {};
  
  // Get available fields from config
  const configMappings = getFieldMappingsFromConfig(objectType, destinationConfig);
  const availableFields = configMappings.availableFields || [];
  
  // Merge user-selected fields with available fields
  const allFields = [...new Set([...fields, ...availableFields])];
  
  logInfo(jobId, `Using fields for sync: ${JSON.stringify(allFields)}`);
  
  // Query to find records that have the required fields
  const query = {
    deletedAt: { $exists: false }
  };
  
  // Ensure we only fetch documents that have at least one of the required fields
  // This is important for the initial sync to be efficient
  const fieldExistsConditions = allFields.map(field => ({ [field]: { $exists: true, $ne: null } }));
  if (fieldExistsConditions.length > 0) {
    query.$or = fieldExistsConditions;
  }
  
  logInfo(jobId, `Fetching ${BATCH_SIZE} records from page ${page}`);
  
  // Fetch a batch of records
  const records = await Collection.find(query)
    .skip(page * BATCH_SIZE)
    .limit(BATCH_SIZE)
    .lean();
  
  logInfo(jobId, `Found ${records.length} records to process`);
  
  // Process each record
  for (const record of records) {
    try {
      // Map the record to Salesforce format
      const salesforceRecord = mapRecordToSalesforce(record, objectType, fieldMappings);
      
      // Skip if no valid attributes to send
      if (Object.keys(salesforceRecord).length === 0) {
        logWarning(jobId, `Skipping record ${record._id} - no valid attributes to send`);
        continue;
      }
      
      // Determine the Salesforce API endpoint based on object type
      let endpoint;
      let method = 'post';
      
      // Map our internal object types to Salesforce API object types
      const salesforceObjectType = 
        objectType === 'people' ? 'Contact' : 
        objectType === 'organizations' ? 'Account' : 
        objectType;
      
      switch(salesforceObjectType) {
        case 'Contact':
          endpoint = '/services/data/v58.0/sobjects/Contact';
          break;
        case 'Account':
          endpoint = '/services/data/v58.0/sobjects/Account';
          break;
        case 'Opportunity':
          endpoint = '/services/data/v58.0/sobjects/Opportunity';
          break;
        default:
          logError(jobId, `Unsupported object type: ${objectType} (maps to ${salesforceObjectType})`);
          throw new Error(`Unsupported object type: ${objectType}`);
      }
      
      // Check if we have a Salesforce ID already (for updates)
      const salesforceId = getSalesforceIdFromRecord(record, objectType);
      if (salesforceId) {
        endpoint = `${endpoint}/${salesforceId}`;
        method = 'patch';
        logInfo(jobId, `Updating existing ${objectType} with Salesforce ID ${salesforceId}`);
      } else {
        logInfo(jobId, `Creating new ${objectType} for record ${record._id}`);
      }
      
      // Send to Salesforce
      let result;
      if (method === 'patch') {
        // For PATCH, we need to use a different endpoint
        endpoint = `/services/data/v58.0/sobjects/${salesforceObjectType}/${salesforceId}`;
        result = await makeSalesforceRequest(method, endpoint, salesforceRecord);
        // PATCH doesn't return ID, so use the one we know
        result = { id: salesforceId, success: true };
      } else {
        // For POST, use the standard endpoint
        result = await makeSalesforceRequest(method, endpoint, salesforceRecord);
      }
      
      logSuccess(jobId, `Successfully synchronized ${objectType} ${record._id} to Salesforce ID ${result.id || salesforceId}`);
      
      // Update the record with Salesforce ID if it's a new record or if the ID has changed
      if (result.id && (!salesforceId || salesforceId !== result.id)) {
        console.log(`Updating record ${record._id} with Salesforce ID ${result.id}`);
        
        // Build the update with salesforce key format
        const updateOperation = { 
          $set: { 
            salesforceId: result.id,
            // Use consistent externalIds format
            'externalIds.salesforce': [
              {
                id: result.id,
                label: objectType === 'people' ? 'Contact ID' : 
                       objectType === 'organizations' ? 'Account ID' : 'Object ID',
                type: objectType === 'people' ? 'contact' : 
                      objectType === 'organizations' ? 'account' : 'object',
                timestamp: new Date()
              }
            ]
          }
        };
        
        await Collection.updateOne(
          { _id: record._id },
          updateOperation
        );
        
        console.log(`Updated record ${record._id} with Salesforce ID ${result.id}`);
      }
    } catch (error) {
      logError(jobId, `Failed to sync ${objectType} ${record._id}`, error);
    }
  }
  
  // If we have more records, schedule the next page
  if (records.length === BATCH_SIZE) {
    logInfo(jobId, `Scheduling next page (${page + 1})`);
    // Note: The actual scheduling happens in the agenda job
    return { hasMoreRecords: true, nextPage: page + 1 };
  }
  
  return { hasMoreRecords: false };
}

/**
 * Process an incremental sync by retrieving a single object from the database and sending to Salesforce
 * Also publishes a message to the Pub/Sub API for real-time updates if supported
 */
async function processIncrementalSync(workspaceConnection, collectionName, objectType, objectId, fields, fieldMappings, makeSalesforceRequest, jobId, destination, instanceUrl, authToken, externalId) {
  logInfo(jobId, `Processing incremental sync for ${objectType} ${objectId}`);
  
  // Ensure collectionName is a valid string
  if (!collectionName || typeof collectionName !== 'string') {
    // If collectionName is not provided or not a string, use objectType as fallback
    collectionName = objectType;
    logWarning(jobId, `Collection name not valid, using objectType "${objectType}" as collection name`);
  }
  
  // Create a dynamic model for the collection
  const Collection = workspaceConnection.model(collectionName, new mongoose.Schema({}, { 
    strict: false,
    collection: collectionName
  }));
  
  // Get destination config
  const { config: destinationConfig } = destination || {};
  
  // Get available fields from config
  const configMappings = getFieldMappingsFromConfig(objectType, destinationConfig);
  const availableFields = configMappings.availableFields || [];
  
  // Merge user-selected fields with available fields
  const allFields = [...new Set([...fields, ...availableFields])];
  
  logInfo(jobId, `Using fields for sync: ${JSON.stringify(allFields)}`);
  
  // Find the record by ID
  const record = await Collection.findById(objectId).lean();
  
  if (!record) {
    logError(jobId, `Record ${objectId} not found in collection ${collectionName}`);
    throw new Error(`Record ${objectId} not found in collection ${collectionName}`);
  }
  
  // Check if record has been deleted
  if (record.deletedAt) {
    logWarning(jobId, `Record ${objectId} has been deleted, skipping sync`);
    return;
  }
  
  // Map the record to Salesforce format
  const salesforceRecord = mapRecordToSalesforce(record, objectType, fieldMappings);
  
  // Skip if no valid attributes to send
  if (Object.keys(salesforceRecord).length === 0) {
    logWarning(jobId, `Skipping record ${objectId} - no valid attributes to send`);
    return;
  }
  
  // Determine the Salesforce API endpoint based on object type
  let endpoint;
  let method = 'post';
  
  // Map our internal object types to Salesforce API object types
  const salesforceObjectType = 
    objectType === 'people' ? 'Contact' : 
    objectType === 'organizations' ? 'Account' : 
    objectType;
  
  switch(salesforceObjectType) {
    case 'Contact':
      endpoint = '/services/data/v58.0/sobjects/Contact';
      break;
    case 'Account':
      endpoint = '/services/data/v58.0/sobjects/Account';
      break;
    case 'Opportunity':
      endpoint = '/services/data/v58.0/sobjects/Opportunity';
      break;
    default:
      logError(jobId, `Unsupported object type: ${objectType} (maps to ${salesforceObjectType})`);
      throw new Error(`Unsupported object type: ${objectType}`);
  }
  
  // Check if we have a Salesforce ID already (for updates)
  const salesforceId = getSalesforceIdFromRecord(record, objectType);
  if (salesforceId) {
    endpoint = `${endpoint}/${salesforceId}`;
    method = 'patch';
    logInfo(jobId, `Updating existing ${objectType} with Salesforce ID ${salesforceId}`);
  } else {
    logInfo(jobId, `Creating new ${objectType} for record ${objectId}`);
  }
  
  // Send to Salesforce
  let result;
  if (method === 'patch') {
    // For PATCH, we need to use a different endpoint
    endpoint = `/services/data/v58.0/sobjects/${salesforceObjectType}/${salesforceId}`;
    result = await makeSalesforceRequest(method, endpoint, salesforceRecord);
    // PATCH doesn't return ID, so use the one we know
    result = { id: salesforceId, success: true };
    
    // Try to publish to Pub/Sub API for real-time updates
    try {
      // Get config
      const config = require('./config.json');
      
      // Check if Pub/Sub is enabled in config
      const pubsubEnabled = config.features?.pubsub?.enabled !== false;
      const autoDetect = config.features?.pubsub?.autoDetect !== false;
      
      // Skip if Pub/Sub is explicitly disabled
      if (!pubsubEnabled && !autoDetect) {
        logInfo(jobId, 'Skipping Pub/Sub publish - feature disabled in config');
        return;
      }
      
      // Check if we should use Pub/Sub
      // For this example, we'll publish to a change event channel if it exists
      const pubsubChannel = `/event/${salesforceObjectType}ChangeEvent`;
      
      // Simple check to avoid publishing if not needed
      if (config.pubsubChannels && config.pubsubChannels.standardObjects && config.pubsubChannels.standardObjects.includes(pubsubChannel)) {
        // Create a Pub/Sub payload
        const pubsubPayload = {
          recordId: salesforceId,
          changeType: "UPDATE",
          channelName: pubsubChannel,
          source: "Outrun",
          timestamp: new Date().toISOString(),
          data: salesforceRecord
        };
        
        // Publish to Pub/Sub API
        const pubsubResult = await publishToPubSub(authToken, instanceUrl, pubsubChannel, pubsubPayload, config);
        
        // Check if the publish was successful
        if (pubsubResult.success) {
          logInfo(jobId, `Published update to Pub/Sub channel ${pubsubChannel}`);
        } else {
          // Handle different error scenarios
          if (pubsubResult.reason === 'api_not_available') {
            logInfo(jobId, 'Pub/Sub API not available in this Salesforce org. This is normal for some Salesforce editions.');
          } else if (pubsubResult.reason === 'feature_disabled') {
            logInfo(jobId, 'Pub/Sub feature is disabled in configuration');
          } else {
            logWarning(jobId, `Failed to publish to Pub/Sub: ${pubsubResult.message}`);
          }
        }
      }
    } catch (pubsubError) {
      // Don't fail the whole sync if Pub/Sub fails
      logWarning(jobId, `Failed to publish to Pub/Sub: ${pubsubError.message}`);
    }
  } else {
    // For POST, use the standard endpoint
    result = await makeSalesforceRequest(method, endpoint, salesforceRecord);
  }
  
  logSuccess(jobId, `Successfully synchronized ${objectType} ${objectId} to Salesforce ID ${result.id || salesforceId}`);
  
  // Update the record with Salesforce ID if it's a new record or if the ID has changed
  if (result.id && (!salesforceId || salesforceId !== result.id)) {
    console.log(`Updating record ${record._id} with Salesforce ID ${result.id}`);
    
    // Build the update with salesforce key format
    const updateOperation = { 
      $set: { 
        salesforceId: result.id,
        // Use consistent externalIds format
        'externalIds.salesforce': [
          {
            id: result.id,
            label: objectType === 'people' ? 'Contact ID' : 
                   objectType === 'organizations' ? 'Account ID' : 'Object ID',
            type: objectType === 'people' ? 'contact' : 
                  objectType === 'organizations' ? 'account' : 'object',
            timestamp: new Date()
          }
        ]
      }
    };
    
    await Collection.updateOne(
      { _id: record._id },
      updateOperation
    );
    
    console.log(`Updated record ${record._id} with Salesforce ID ${result.id}`);
  }
  
  // Update the listener metadata for this record to mark it as processed
  try {
    const now = new Date();
    // Get the listener ID from the data that was passed to handleJob
    let listenerId = destination._id.toString(); // Default fallback
    
    // Try to get the listenerId from the original job data in the handleJob function
    try {
      // This function is called from processDestination which is called from handleJob
      // The original job is available in the handleJob scope
      const originalJob = global.currentSalesforceJob; // Accessing the job that's stored globally in handleJob
      if (originalJob && originalJob.attrs && originalJob.attrs.data && originalJob.attrs.data.listenerId) {
        listenerId = originalJob.attrs.data.listenerId;
        logInfo(jobId, `Using listenerId ${listenerId} from job data`);
      } else {
        logInfo(jobId, `No listenerId found in job data, using destination ID as fallback: ${listenerId}`);
      }
    } catch (error) {
      logWarning(jobId, `Error accessing job data for listenerId, using destination ID as fallback: ${error.message}`);
    }
    
    // Update the record with listener metadata
    await Collection.updateOne(
      { _id: record._id },
      {
        $set: {
          [`metadata.listeners.${listenerId}`]: {
            status: 'complete',
            lastRun: now,
            jobId: jobId
          }
        }
      }
    );
    
    logInfo(jobId, `Updated listener metadata for record ${objectId} with status 'complete'`);
  } catch (error) {
    logWarning(jobId, `Failed to update listener metadata for record ${objectId}: ${error.message}`);
    console.warn(`Failed to update listener metadata for record ${objectId}`, error);
    // Don't fail the job just because we couldn't update the listener metadata
  }
}

/**
 * Module export for the job handler
 */
module.exports = {
  job: async function(job, done) {
    // Add detailed logging at the start
    console.log('\n\n');
    console.log('========================================================');
    console.log('*** SALESFORCE DESTINATION JOB INVOKED - START PROCESSING ***');
    console.log(`*** JOB ID: ${job.attrs._id} ***`);
    console.log(`*** DATE/TIME: ${new Date().toISOString()} ***`);
    console.log('========================================================');
    console.log('\n');
    
    try {
      const result = await handleJob(job);
      // Log success with clear boundaries
      console.log('\n');
      console.log('========================================================');
      console.log('*** SALESFORCE JOB COMPLETED SUCCESSFULLY ***');
      console.log(`*** JOB ID: ${job.attrs._id} ***`);
      console.log(`*** DATE/TIME: ${new Date().toISOString()} ***`);
      console.log('========================================================');
      console.log('\n\n');
      // Clean up global job reference
      global.currentSalesforceJob = null;
      done(null, result);
    } catch (error) {
      // Log error with clear boundaries
      console.log('\n');
      console.log('========================================================');
      console.log('*** SALESFORCE JOB FAILED ***');
      console.log(`*** JOB ID: ${job.attrs._id} ***`);
      console.log(`*** ERROR: ${error.message} ***`);
      console.log(`*** DATE/TIME: ${new Date().toISOString()} ***`);
      console.log('========================================================');
      console.log('\n\n');
      console.error('Error in salesforceDestination job:', error);
      // Clean up global job reference
      global.currentSalesforceJob = null;
      done(error);
    }
  }
}; 
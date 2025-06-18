// This service connects to Zoho CRM API to fetch a copy of all the CRM data
// It processes data for specified modules and handles rate limiting and error cases
// https://www.zoho.com/crm/developer/docs/api/v8/get-records.html
// https://www.zoho.com/crm/developer/docs/api/v8/modules-api.html

const mongoose = require('mongoose');
const axios = require('axios');
const { getValidToken } = require('../../providers/zoho/api.js');
const { SourceSchema, TokenSchema, JobHistorySchema } = require('../../data/models'); // Import schemas
const { RedisRateLimiter } = require('rolling-rate-limiter');
const { logInfo, logError, logSuccess, logWarning } = require('../../utils/logger');
const path = require('path');
const fs = require('fs');

// Load Zoho source configuration
const zohoConfigPath = path.join(__dirname, 'config.json');
const zohoConfig = require(zohoConfigPath);

const ZOHO_API_VERSION = 'v8';

// Helper function to determine relationship type based on parent and child modules
function getRelationshipType(parentModule, relatedModule) {
  // Entity to Entity relationships
  if (parentModule === 'Accounts' && relatedModule === 'Contacts') return 'organization_to_people';
  if (parentModule === 'Accounts' && relatedModule === 'Leads') return 'organization_to_people';
  if (parentModule === 'Contacts' && relatedModule === 'Accounts') return 'people_to_organization';
  if (parentModule === 'Leads' && relatedModule === 'Accounts') return 'people_to_organization';
  
  // Activity relationships
  if (relatedModule === 'Notes') return 'has_note';
  if (relatedModule === 'Tasks') return 'has_task';
  if (relatedModule === 'Events') return 'has_event';
  if (relatedModule === 'Calls') return 'has_call';
  if (relatedModule === 'Attachments') return 'has_attachment';
  
  // Default fallback
  return 'related_to';
}

// Rate limiter constants based on Zoho API concurrency limits
// Zoho limits: 20 concurrent requests for Enterprise edition
// Sub-concurrency: 10 for resource-intensive operations
// Being conservative to avoid hitting limits
const RATE_LIMITS = {
  default: {
    requestsPerInterval: 5, // Very conservative - 5 requests per 10 seconds
    intervalMs: 10000 // 10 seconds
  },
  metadata: {
    requestsPerInterval: 3, // Even more conservative for metadata calls
    intervalMs: 10000 // 10 seconds
  },
  read: {
    requestsPerInterval: 8, // Slightly higher for read operations
    intervalMs: 10000 // 10 seconds
  },
  search: {
    requestsPerInterval: 3, // Very conservative for search (sub-concurrency limited)
    intervalMs: 10000 // 10 seconds
  }
};

// Handle rate limiting using Redis to ensure we don't exceed Zoho's API quotas
async function handleRateLimiting(externalId, job, limiter) {
  return new Promise((resolve, reject) => {
    limiter.wouldLimitWithInfo(externalId.toString()).then(async (RateLimitInfo) => {
      const { blocked, actionsRemaining, millisecondsUntilAllowed } = RateLimitInfo;
      
      if (blocked) {
        const secondsToWait = (millisecondsUntilAllowed / 1000).toFixed(2);
        console.warn('zohocrm - Rate limit reached, waiting for reset');
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
      console.error('zohocrm - Rate limiting error occurred');
      reject(new Error('Rate limiting error'));
    });
  });
}

const convertAccountsServerToApiDomain = (accountsServerUrl) => {
  // Convert accounts server URL to API domain URL
  // e.g., https://accounts.zoho.in -> https://www.zohoapis.in
  //       https://accounts.zoho.com -> https://www.zohoapis.com
  //       https://accounts.zoho.eu -> https://www.zohoapis.eu
  //       https://accounts.zoho.com.au -> https://www.zohoapis.com.au
  
  if (!accountsServerUrl || typeof accountsServerUrl !== 'string') {
      return 'https://www.zohoapis.com'; // Default fallback
  }
  
  // Extract the domain part after accounts.zoho
  const match = accountsServerUrl.match(/https:\/\/accounts\.zoho\.([^\/]+)/);
  if (match && match[1]) {
      const region = match[1]; // e.g., 'in', 'com', 'eu', 'com.au'
      return `https://www.zohoapis.${region}`;
  }
  
  // If it doesn't match the expected pattern, return default
  console.warn(`Unexpected accounts server URL format: ${accountsServerUrl}, using default API domain`);
  return 'https://www.zohoapis.com';
};

const getZohoApiBaseUrl = (apiDomainValue) => {
  // Handle both string and object formats
  if (typeof apiDomainValue === 'string') {
    // Direct URL string
    return apiDomainValue;
  } else if (apiDomainValue && typeof apiDomainValue === 'object' && apiDomainValue.api_domain) {
    // Object with api_domain property
    return apiDomainValue.api_domain;
  } else {
    // Default fallback
    console.warn("api_domain not found in tokenData, defaulting to global URL");
    return 'https://www.zohoapis.com';
  }
};

const handleApiError = async (error, savedJobHistory, objectType, JobHistoryModel, jobId) => {
  if (savedJobHistory) {
    try {
      const errorMessage = error.response?.data?.message || error.message;
      const statusCode = error.response?.status;
      const logMessage = statusCode ? 
        `API error for ${objectType}: [${statusCode}] ${errorMessage}` :
        `Error processing ${objectType}: ${errorMessage}`;

      logError(jobId, logMessage, error);
      
      await JobHistoryModel.findByIdAndUpdate(savedJobHistory._id, {
        $push: { errors: { objectType, error: logMessage } }
      });
    } catch (historyError) {
      logError(jobId, 'Failed to update job history', historyError);
    }
  }
  return false;
};

// Cache for related lists metadata to avoid refetching for every batch of parent records
const relatedListCache = new Map();

// Step 1: Discover All Available Modules
async function discoverModules(accessToken, apiDomain, limiter, job, jobId, externalId) {
  logInfo(jobId, 'Starting Zoho module discovery...');
  if (job) job.touch();

  const url = `${apiDomain}/crm/${ZOHO_API_VERSION}/settings/modules`;
  let allModules = [];

  try {
    await handleRateLimiting(externalId, job, limiter);
    console.log(`Discovering modules from Zoho: ${url}`);

    const response = await axios.get(url, {
      headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
    });

    if (response.data && response.data.modules) {
      allModules = response.data.modules.map(module => ({
        api_name: module.api_name,
        module_name: module.module_name,
        singular_label: module.singular_label,
        plural_label: module.plural_label,
        visible: module.visible,
        creatable: module.creatable,
        editable: module.editable,
        deletable: module.deletable,
        raw: module
      }));
      logInfo(jobId, `Successfully discovered ${allModules.length} modules from Zoho`);
      console.log(`Discovered ${allModules.length} Zoho modules. Example: ${allModules.length > 0 ? allModules[0].api_name : 'N/A'}`);
    } else {
      logWarning(jobId, 'No modules found in Zoho response or unexpected response structure');
      console.warn('Zoho discoverModules: No modules found or unexpected structure.', response.data);
    }
  } catch (error) {
    logError(jobId, `Error discovering modules from Zoho at ${url}`, error);
  }
  if (job) job.touch();
  return allModules;
}

// Step 2: Discover Fields for a Module
async function discoverFieldsPerModule(moduleApiName, accessToken, apiDomain, limiter, job, jobId, externalId) {
  logInfo(jobId, `Discovering fields for Zoho module: ${moduleApiName}...`);
  if (job) job.touch();

  // Use the correct Fields API endpoint instead of the Module Metadata endpoint
  const url = `${apiDomain}/crm/${ZOHO_API_VERSION}/settings/fields?module=${moduleApiName}`;
  let fields = [];

  try {
    await handleRateLimiting(externalId, job, limiter);
    console.log(`Discovering fields for module ${moduleApiName} from Zoho: ${url}`);

    const response = await axios.get(url, {
      headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
    });

    if (response.data && response.data.fields && Array.isArray(response.data.fields)) {
      if (response.data.fields.length > 0) {
        fields = response.data.fields.map(field => ({
          api_name: field.api_name,
          field_label: field.field_label || field.display_label,
          data_type: field.data_type,
          is_custom_field: field.custom_field || false,
          is_mandatory: field.system_mandatory || false,
          is_readonly: field.field_read_only || false,
          max_length: field.length,
          precision: field.precision,
          json_type: field.json_type,
          lookup: field.lookup,
          picklist_values: field.pick_list_values,
          raw: field
        }));
        logInfo(jobId, `Successfully discovered ${fields.length} fields for module ${moduleApiName}`);
        console.log(`Discovered ${fields.length} fields for Zoho module ${moduleApiName}. Example field: ${fields.length > 0 ? fields[0].api_name : 'N/A'}`);
      } else {
        logWarning(jobId, `No fields found for module ${moduleApiName} in Zoho Fields API response`);
        console.log(`Zoho discoverFieldsPerModule for ${moduleApiName}: No fields found in response.`, response.data);
      }
    } else {
      // Fallback: If Fields API fails, try to get basic field info from module metadata
      logWarning(jobId, `Fields API returned unexpected format for ${moduleApiName}, trying module metadata fallback`);
      
      try {
        const moduleUrl = `${apiDomain}/crm/${ZOHO_API_VERSION}/settings/modules/${moduleApiName}`;
        const moduleResponse = await axios.get(moduleUrl, {
          headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
        });
        
        if (moduleResponse.data && moduleResponse.data.modules && moduleResponse.data.modules.length > 0) {
          const moduleData = moduleResponse.data.modules[0];
          if (moduleData && moduleData.custom_view && moduleData.custom_view.fields) {
            // Use fields from the default custom view as a fallback
            fields = moduleData.custom_view.fields.map(field => ({
              api_name: field.api_name,
              field_label: field.api_name, // API name as fallback label
              data_type: 'text', // Default data type
              is_custom_field: false,
              is_mandatory: false,
              is_readonly: false,
              raw: field
            }));
            logInfo(jobId, `Using ${fields.length} fields from module custom view for ${moduleApiName}`);
          } else {
            // Check if this is a system module that doesn't expose fields
            if (moduleData && moduleData.status === 'system_hidden') {
              logInfo(jobId, `Module ${moduleApiName} is a system module (status: ${moduleData.status}), using default fields`);
              // For system modules like Attachments, use basic fields that are commonly available
              fields = [
                { api_name: 'id', field_label: 'ID', data_type: 'id', is_custom_field: false },
                { api_name: 'Created_Time', field_label: 'Created Time', data_type: 'datetime', is_custom_field: false },
                { api_name: 'Modified_Time', field_label: 'Modified Time', data_type: 'datetime', is_custom_field: false }
              ];
              logInfo(jobId, `Using ${fields.length} default fields for system module ${moduleApiName}`);
            } else {
              logWarning(jobId, `No fields found for module ${moduleApiName} in Zoho response or unexpected structure`);
              console.warn(`Zoho discoverFieldsPerModule for ${moduleApiName}: No fields found or unexpected structure.`, moduleData);
            }
          }
        } else {
          logWarning(jobId, `Module ${moduleApiName} not found in Zoho settings/modules response or unexpected structure`);
          console.warn(`Zoho discoverFieldsPerModule: Module ${moduleApiName} not found or unexpected structure.`, moduleResponse.data);
        }
      } catch (fallbackError) {
        logError(jobId, `Error in fallback module metadata request for ${moduleApiName}`, fallbackError);
      }
    }
  } catch (error) {
    logError(jobId, `Error discovering fields for module ${moduleApiName} from Zoho at ${url}`, error);
  }
  if (job) job.touch();
  return fields;
}

// Step 3: Download Records for Each Module
async function downloadModuleRecords(
  moduleInfo,
  fieldsToFetch,
  accessToken,
  apiDomain,
  StreamModel,
  limiter,
  relatedRecordsLimiter,
  job,
  savedJobHistory,
  sourceId,
  workspaceId,
  isBackfill,
  lastSuccessfulSyncTime,
  rateLimiters,
  jobId,
  externalId
) {
  const moduleApiName = moduleInfo.api_name;
  logInfo(jobId, `Starting record download for module: ${moduleApiName}. Backfill: ${isBackfill}, Sync since: ${lastSuccessfulSyncTime || 'N/A'}`);
  if (job) job.touch();

  let moreRecords = true;
  const batchSize = 200; // Zoho API limit per page
  const fieldApiNames = fieldsToFetch.map(f => f.api_name).join(',');

  let currentPage = 1;
  let pageToken = null;
  let requestUrl;
  let usingSearchApi = false;

  const lastModifiedField = 'Modified_Time';

  if (!isBackfill && lastSuccessfulSyncTime) {
    logInfo(jobId, `Performing incremental sync for ${moduleApiName} since ${lastSuccessfulSyncTime}`);
    const criteria = `(${lastModifiedField}:gt:${new Date(lastSuccessfulSyncTime).toISOString()})`;
    requestUrl = `${apiDomain}/crm/${ZOHO_API_VERSION}/${moduleApiName}/search?criteria=${encodeURIComponent(criteria)}&fields=${fieldApiNames}&per_page=${batchSize}`;
    usingSearchApi = true;
  } else {
    logInfo(jobId, `Performing full sync (backfill) for ${moduleApiName}`);
    requestUrl = `${apiDomain}/crm/${ZOHO_API_VERSION}/${moduleApiName}?fields=${fieldApiNames}&per_page=${batchSize}&sort_by=Created_Time&sort_order=asc`;
    usingSearchApi = false;
  }

  while (moreRecords) {
    await handleRateLimiting(externalId, job, limiter);
    if (job) job.touch();

    let currentUrl = requestUrl;
    if (usingSearchApi) {
      currentUrl += `&page=${currentPage}`;
    } else {
      if (pageToken) {
        currentUrl = `${requestUrl}&page_token=${pageToken}`;
      } else {
        currentUrl += `&page=${currentPage}`;
      }
    }

    try {
      console.log(`Fetching ${moduleApiName} from Zoho: ${currentUrl}`);
      const response = await axios.get(currentUrl, {
        headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
      });

      const records = response.data.data || [];
      const pageInfo = response.data.info;

      if (records.length > 0) {
        logInfo(jobId, `Fetched ${records.length} records from ${moduleApiName} (page ${pageToken || currentPage})`);
        const streamObjects = records.map(record => ({
          record,
          metadata: {
            sourceId,
            objectType: moduleApiName,
            sourceType: zohoConfig.sourceType,
            jobHistoryId: savedJobHistory._id,
            recordId: record.id,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        }));
        await StreamModel.insertMany(streamObjects);
        logInfo(jobId, `Successfully inserted ${records.length} records from ${moduleApiName} into stream`);

        // Download related records for this batch - only for parent modules
        const parentModules = ['Accounts']; // Only these modules should fetch related records
        if (parentModules.includes(moduleApiName)) {
          logInfo(jobId, `Starting related records download for ${records.length} ${moduleApiName} records (parent module)`);
          await downloadRelatedRecords(
            records,
            moduleInfo,
            fieldsToFetch,
            accessToken,
            apiDomain,
            StreamModel,
            relatedRecordsLimiter,
            job,
            savedJobHistory,
            sourceId,
            workspaceId,
            rateLimiters,
            jobId,
            externalId
          );
          logInfo(jobId, `Completed related records download for ${moduleApiName} batch`);
        } else {
          logInfo(jobId, `Skipping related records download for ${moduleApiName} (child module - will be discovered via parent modules)`);
        }
      } else {
        logInfo(jobId, `No new records found for ${moduleApiName} in this iteration (page ${pageToken || currentPage})`);
      }

      // Handle pagination
      if (pageInfo && pageInfo.more_records) {
        if (usingSearchApi) {
          currentPage++;
        } else {
          if (pageInfo.next_page_token) {
            pageToken = pageInfo.next_page_token;
            currentPage = 1;
          } else if (currentPage * batchSize < (pageInfo.count || 2000) && currentPage < 10) {
            pageToken = null;
            currentPage++;
          } else {
            moreRecords = false;
          }
        }
      } else {
        moreRecords = false;
      }

      // Safety breaks
      if (currentPage > 1000 && usingSearchApi) {
        console.warn(`Safety break for ${moduleApiName} search pagination at page ${currentPage}.`);
        moreRecords = false;
      }
      if (pageToken && pageToken.length > 255 && !usingSearchApi) {
        console.warn(`Safety break for ${moduleApiName} Get Records pagination due to long page_token.`);
        moreRecords = false;
      }

    } catch (error) {
      logError(jobId, `Error downloading records for ${moduleApiName} (page ${pageToken || currentPage}) from ${currentUrl}`, error);
      moreRecords = false;
    }
  }
  logInfo(jobId, `Finished record download for module: ${moduleApiName}`);
  if (job) job.touch();
}

// Step 4: Discover Related Lists for a Module
async function discoverRelatedListsForModule(parentModuleApiName, accessToken, apiDomain, limiter, job, jobId, externalId) {
  if (relatedListCache.has(parentModuleApiName)) {
    logInfo(jobId, `Using cached related lists for ${parentModuleApiName}`);
    return relatedListCache.get(parentModuleApiName);
  }

  logInfo(jobId, `Discovering related lists for module: ${parentModuleApiName}...`);
  if (job) job.touch();
  const url = `${apiDomain}/crm/${ZOHO_API_VERSION}/settings/modules/${parentModuleApiName}/related_lists`;
  let discoveredRelatedLists = [];

  try {
    await handleRateLimiting(externalId, job, limiter);
    console.log(`Discovering related lists for ${parentModuleApiName} from Zoho: ${url}`);
    const response = await axios.get(url, {
      headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
    });

    if (response.data && response.data.related_lists) {
      discoveredRelatedLists = response.data.related_lists.map(rl => ({
        api_name: rl.api_name,
        module: rl.module,
        display_label: rl.display_label,
        visible: rl.visible,
        href: rl.href,
        id: rl.id,
        type: rl.type,
        raw: rl
      })).filter(rl => rl.visible && rl.module && rl.href);

      logInfo(jobId, `Successfully discovered ${discoveredRelatedLists.length} visible related lists for ${parentModuleApiName}`);
      console.log(`Discovered ${discoveredRelatedLists.length} related lists for ${parentModuleApiName}. Example: ${discoveredRelatedLists.length > 0 ? discoveredRelatedLists[0].api_name : 'N/A'}`);
      relatedListCache.set(parentModuleApiName, discoveredRelatedLists);
    } else {
      logWarning(jobId, `No related lists found for ${parentModuleApiName} or unexpected response structure`);
      console.warn(`Zoho discoverRelatedLists for ${parentModuleApiName}: No related lists or unexpected structure.`, response.data);
      console.warn(`Response structure:`, JSON.stringify(response.data, null, 2));
    }
  } catch (error) {
    if (error.response && error.response.status === 404) {
      logWarning(jobId, `No related lists found or API not supported for module ${parentModuleApiName} (404)`);
      console.warn(`Zoho discoverRelatedLists for ${parentModuleApiName}: 404 - No related lists or API not supported.`);
    } else {
      logError(jobId, `Error discovering related lists for ${parentModuleApiName} from Zoho at ${url}`, error);
    }
    relatedListCache.set(parentModuleApiName, []);
  }
  if (job) job.touch();
  return discoveredRelatedLists;
}

// Step 5: Download Related Records
async function downloadRelatedRecords(
  parentRecords,
  parentModuleInfo,
  parentFields,
  accessToken,
  apiDomain,
  StreamModel,
  limiter,
  job,
  savedJobHistory,
  sourceId,
  workspaceId,
  rateLimiters,
  jobId,
  externalId
) {
  const parentModuleApiName = parentModuleInfo.api_name;
  logInfo(jobId, `Starting related record download for ${parentRecords.length} ${parentModuleApiName} records`);
  if (job) job.touch();

  if (parentRecords.length === 0) {
    logInfo(jobId, `No parent records provided to downloadRelatedRecords for ${parentModuleApiName}. Skipping`);
    return;
  }

  // For Accounts, hardcode the known related modules since discovery API might not work
  // but we know the actual Related Records API calls work fine
  let relatedLists = [];
  
  if (parentModuleApiName === 'Accounts') {
    // Hardcode known related modules for Accounts (excluding Leads as it's not a valid relation)
    relatedLists = [
      { api_name: 'Contacts', module: 'Contacts', display_label: 'Contacts', visible: true, href: 'Contacts' },
      { api_name: 'Notes', module: 'Notes', display_label: 'Notes', visible: true, href: 'Notes' },
      { api_name: 'Tasks', module: 'Tasks', display_label: 'Tasks', visible: true, href: 'Tasks' },
      { api_name: 'Events', module: 'Events', display_label: 'Events', visible: true, href: 'Events' },
      { api_name: 'Calls', module: 'Calls', display_label: 'Calls', visible: true, href: 'Calls' }
    ];
    logInfo(jobId, `Using hardcoded related lists for ${parentModuleApiName} (discovery API returned 404)`);
  } else {
    // For other modules, try discovery
    const metadataLimiter = rateLimiters.metadata || rateLimiters.default;
    relatedLists = await discoverRelatedListsForModule(parentModuleApiName, accessToken, apiDomain, metadataLimiter, job, jobId, externalId);
  }

  logInfo(jobId, `Found ${relatedLists.length} total related lists for ${parentModuleApiName}: ${relatedLists.map(rl => `${rl.module} (${rl.api_name})`).join(', ')}`);

  if (relatedLists.length === 0) {
    logInfo(jobId, `No usable related lists found or configured for ${parentModuleApiName}. Skipping related record download`);
    return;
  }

  // Fetch ALL related records using Related Records API
  // This includes both entity relationships (Contacts, Leads) and activity relationships (Notes, Tasks, etc.)
  const supportedModules = ['Contacts', 'Leads', 'Notes', 'Tasks', 'Events', 'Calls', 'Attachments', 'Activities'];
  const listsToFetch = relatedLists.filter(rl => 
    rl.visible && rl.module && rl.href && supportedModules.includes(rl.module)
  );

  logInfo(jobId, `Filtering related lists: ${relatedLists.length} total → ${listsToFetch.length} matching supported modules`);
  logInfo(jobId, `Supported modules: ${supportedModules.join(', ')}`);
  logInfo(jobId, `Filtered out: ${relatedLists.filter(rl => !supportedModules.includes(rl.module)).map(rl => `${rl.module} (${rl.api_name})`).join(', ')}`);

  if (listsToFetch.length === 0) {
    logInfo(jobId, `No visible related lists found for ${parentModuleApiName}. Total available: ${relatedLists.length}`);
    logInfo(jobId, `Available modules: ${relatedLists.map(rl => rl.module).join(', ')}`);
    return;
  }
  logInfo(jobId, `Will fetch related records for: ${listsToFetch.map(rl => `${rl.module} (${rl.api_name})`).join(', ')} for ${parentModuleApiName}`);

  for (const parentRecord of parentRecords) {
    const parentRecordId = parentRecord.id;
    if (!parentRecordId) {
      logWarning(jobId, `Parent record from ${parentModuleApiName} is missing an ID. Skipping related records`);
      continue;
    }

    for (const relatedList of listsToFetch) {
      let relatedCurrentPage = 1;
      let moreRelatedRecords = true;
      const relatedModuleApiName = relatedList.module;
      const relatedListUrlSegment = relatedList.href;

      logInfo(jobId, `Fetching related '${relatedModuleApiName}' for ${parentModuleApiName} ID ${parentRecordId} via list ${relatedList.api_name}`);

      while (moreRelatedRecords) {
        await handleRateLimiting(externalId, job, limiter);
        if (job) job.touch();

        // Get fields for the related module
        let fieldsParam = '';
        switch (relatedModuleApiName) {
          case 'Contacts':
            fieldsParam = 'fields=Id,Email,First_Name,Last_Name,Phone,Title,Account_Name,Created_Time,Modified_Time,Owner';
            break;
          case 'Notes':
            fieldsParam = 'fields=Id,Note_Title,Note_Content,Created_Time,Modified_Time,Owner';
            break;
          case 'Tasks':
            fieldsParam = 'fields=Id,Subject,Status,Priority,Due_Date,Created_Time,Modified_Time,Owner';
            break;
          case 'Events':
            fieldsParam = 'fields=Id,Event_Title,Start_DateTime,End_DateTime,Created_Time,Modified_Time,Owner';
            break;
          case 'Calls':
            fieldsParam = 'fields=Id,Subject,Call_Start_Time,Call_Duration,Created_Time,Modified_Time,Owner';
            break;
          default:
            fieldsParam = 'fields=Id,Created_Time,Modified_Time';
        }
        
        const relatedRecordsUrl = `${apiDomain}/crm/${ZOHO_API_VERSION}/${parentModuleApiName}/${parentRecordId}/${relatedListUrlSegment}?${fieldsParam}&page=${relatedCurrentPage}&per_page=200`;

        try {
          console.log(`Fetching related records from Zoho: ${relatedRecordsUrl}`);
          logInfo(jobId, `API Call: GET ${relatedRecordsUrl}`);
          const response = await axios.get(relatedRecordsUrl, {
            headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
          });

          const fetchedRelatedRecords = response.data.data || [];
          const pageInfo = response.data.info;
          logInfo(jobId, `API Response: ${fetchedRelatedRecords.length} records, hasMore: ${pageInfo?.more_records || false}`);

          if (fetchedRelatedRecords.length > 0) {
            logInfo(jobId, `Fetched ${fetchedRelatedRecords.length} related '${relatedModuleApiName}' for ${parentModuleApiName} ID ${parentRecordId} (page ${relatedCurrentPage})`);
            const streamObjects = fetchedRelatedRecords.map(relRecord => {
              // Create synthetic relationship record instead of storing full record
              const relationshipId = `${parentModuleApiName.toLowerCase()}_${parentRecordId}_${relatedModuleApiName.toLowerCase()}_${relRecord.id}`;
              const relationshipType = getRelationshipType(parentModuleApiName, relatedModuleApiName);
              
              // Determine source and target based on relationship direction
              let source, target;
              if (relationshipType.includes('organization_to')) {
                source = {
                  id: "",
                  type: "organization", 
                  externalId: parentRecordId
                };
                target = {
                  id: "",
                  type: "person",
                  externalId: relRecord.id
                };
              } else if (relationshipType.includes('people_to')) {
                source = {
                  id: "",
                  type: "person",
                  externalId: relRecord.id  
                };
                target = {
                  id: "",
                  type: "organization",
                  externalId: parentRecordId
                };
              } else {
                // Activity relationships (has_task, has_note, etc.)
                source = {
                  id: "",
                  type: "organization",
                  externalId: parentRecordId
                };
                target = {
                  id: "",
                  type: relatedModuleApiName.toLowerCase(),
                  externalId: relRecord.id
                };
              }

              const relationshipRecord = {
                id: relationshipId,
                source,
                target,
                relationshipType,
                externalIds: {
                  zohocrm: relationshipId
                },
                metadata: {
                  sourceType: zohoConfig.sourceType,
                  nativeRelationshipType: relatedList.api_name,
                  parentModule: parentModuleApiName,
                  relatedModule: relatedModuleApiName,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString()
                }
              };

              return {
                record: relationshipRecord,
                metadata: {
                  sourceId,
                  objectType: 'relationship',
                  sourceEntityType: parentModuleApiName.toLowerCase(),
                  targetEntityType: relatedModuleApiName.toLowerCase(), 
                  sourceType: zohoConfig.sourceType,
                  jobHistoryId: savedJobHistory._id,
                  recordId: relationshipId,
                  createdAt: new Date(),
                  updatedAt: new Date()
                }
              };
            });
            await StreamModel.insertMany(streamObjects);
            logInfo(jobId, `Inserted ${fetchedRelatedRecords.length} related '${relatedModuleApiName}' for ${parentModuleApiName} ID ${parentRecordId} into stream`);
          } else {
            logInfo(jobId, `No more related '${relatedModuleApiName}' found for ${parentModuleApiName} ID ${parentRecordId} (page ${relatedCurrentPage})`);
          }

          if (pageInfo && pageInfo.more_records) {
            relatedCurrentPage++;
          } else {
            moreRelatedRecords = false;
          }
          if (relatedCurrentPage > 100) {
            console.warn(`Safety break for related ${relatedModuleApiName} for ${parentModuleApiName} ID ${parentRecordId} pagination at page ${relatedCurrentPage}.`);
            moreRelatedRecords = false;
          }

        } catch (error) {
          if (error.response && error.response.data && error.response.data.code === "NO_CONTENT") {
            logInfo(jobId, `No related '${relatedModuleApiName}' (NO_CONTENT) found for ${parentModuleApiName} ID ${parentRecordId} via list ${relatedList.api_name}`);
          } else if (error.response && error.response.status === 404) {
            logInfo(jobId, `No related '${relatedModuleApiName}' (404) found for ${parentModuleApiName} ID ${parentRecordId} via list ${relatedList.api_name}. URL: ${relatedRecordsUrl}`);
          } else {
            logError(jobId, `Error downloading related '${relatedModuleApiName}' for ${parentModuleApiName} ID ${parentRecordId} from ${relatedRecordsUrl}`, error);
          }
          moreRelatedRecords = false;
        }
      }
    }
  }
  logInfo(jobId, `Finished related record download phase for this batch of ${parentModuleApiName}`);
  if (job) job.touch();
}

// Decrypt token function
const crypto = require('crypto');
const ALGORITHM = 'aes-256-cbc';

const decryptToken = (encryptedText) => {
  if (!process.env.CRYPTO_SECRET) throw new Error('CRYPTO_SECRET is not defined.');
  if (!encryptedText || typeof encryptedText !== 'string' || !encryptedText.includes(':')) {
    console.error('Invalid encrypted text format for api_domain decryption:', encryptedText);
    throw new Error('Invalid encrypted text format for api_domain.');
  }
  const parts = encryptedText.split(':');
  if (parts.length !== 2) throw new Error('Invalid encrypted text format (missing IV or data).');
  const iv = Buffer.from(parts[0], 'hex');
  const encryptedData = Buffer.from(parts[1], 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(process.env.CRYPTO_SECRET), iv);
  let decrypted = decipher.update(encryptedData);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
};

// Function to auto-detect the correct Zoho API domain
async function detectZohoApiDomain(accessToken, jobId) {
  const domains = [
    'https://www.zohoapis.com',     // US
    'https://www.zohoapis.eu',      // EU  
    'https://www.zohoapis.in',      // India
    'https://www.zohoapis.com.au',  // Australia
    'https://www.zohoapis.ca'       // Canada
  ];
  
  for (const domain of domains) {
    try {
      logInfo(jobId, `Testing API domain: ${domain}`);
      const response = await axios.get(`${domain}/crm/v8/settings/modules`, {
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });
      
      if (response.data && !response.data.code) {
        logSuccess(jobId, `Found working API domain: ${domain}`);
        return domain;
      }
    } catch (error) {
      logWarning(jobId, `API domain ${domain} failed: ${error.response?.data?.message || error.message}`);
    }
  }
  
  throw new Error('No working API domain found for this Zoho account');
}

module.exports = {
  job: async (job, done) => {
    const { sourceId, workspaceId, backfill } = job.attrs.data;
    const redisClient = job.attrs.redisClient;
    const jobId = job._id ? job._id.toString() : 'unknown';

    // Check if redisClient is defined
    if (!redisClient) {
      logError(jobId, 'Redis client is not defined');
      done(new Error('Redis client is not defined'));
      return;
    }

    // Connect to MongoDB and initialize job
    const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
    const workspaceConnection = await mongoose.createConnection(dataLakeUri).asPromise();
    workspaceConnection.set('maxTimeMS', 30000);

    // Define models explicitly on the workspace connection USING IMPORTED SCHEMAS
    const Source = workspaceConnection.model('Source', SourceSchema);
    const Token = workspaceConnection.model('Token', TokenSchema);
    const JobHistory = workspaceConnection.model('JobHistory', JobHistorySchema);

    // Find the source before starting
    logInfo(jobId, `Attempting to find Source ${sourceId} in workspace db...`);
    const source = await Source.findOne({ _id: sourceId }).exec();
    if (!source) {
      logError(jobId, `Source ${sourceId} not found in workspace DB. Aborting job`);
      await workspaceConnection.close();
      done(new Error(`Source with ID ${sourceId} not found`));
      return;
    }
    logInfo(jobId, `Source ${sourceId} found successfully`);

    let ingressBytes = 0;
    let apiCalls = 0;
    let savedJobHistory;
    const jobStartTime = new Date();

    try {
      logInfo(jobId, `Job started for source: ${sourceId}`);

      // Create job history record
      savedJobHistory = await JobHistory.create({
        jobId: job._id,
        sourceId: source._id,
        status: 'in_progress',
        startTime: jobStartTime.toISOString(),
        name: 'zohocrm'
      });

      // Setup rate limiters
      const rateLimiters = {};
      for (const [key, limitConfig] of Object.entries(RATE_LIMITS)) {
        if (redisClient) {
          rateLimiters[key] = new RedisRateLimiter({
            client: redisClient,
            namespace: `zohocrm:${key}:`,
            interval: limitConfig.intervalMs,
            maxInInterval: limitConfig.requestsPerInterval
          });
          logInfo(jobId, `Initialized RedisRateLimiter for ${key}`);
        } else {
          rateLimiters[key] = {
            getTokensRemaining: async () => limitConfig.requestsPerInterval,
            getTimeUntilReset: async () => 0,
            removeTokens: async () => {},
          };
        }
      }
      const defaultLimiter = rateLimiters.default;

      // Get token and setup
      const token = await Token.findById(source.tokenId).exec();
      logInfo(jobId, `Token found: ${token ? 'Yes' : 'No'}`);
      if (!token) {
        throw new Error(`Token with ID ${source.tokenId} not found`);
      }

      const tokenData = token.toObject ? token.toObject() : token;
      if (!tokenData.externalId) {
        throw new Error('External ID not found in token');
      }

             // Fetch valid access token
       const accessToken = await getValidToken(Token, token, workspaceId, redisClient);
       
       // Get API domain with fallback and auto-detection
       let zohoApiDomain = 'https://www.zohoapis.com'; // Default fallback
       if (token.encryptedApiDomain) {
         try {
           const decryptedValue = decryptToken(token.encryptedApiDomain);
           
           // Check if the decrypted value is an accounts server URL or already an API domain
           if (decryptedValue.includes('accounts.zoho')) {
             // Convert accounts server URL to API domain
             zohoApiDomain = convertAccountsServerToApiDomain(decryptedValue);
           } else if (decryptedValue.includes('zohoapis')) {
             // Already an API domain
             zohoApiDomain = decryptedValue;
           } else {
             // Try to parse as legacy JSON format
             try {
               const parsedApiDomain = JSON.parse(decryptedValue);
               zohoApiDomain = getZohoApiBaseUrl(parsedApiDomain);
             } catch (parseError) {
               // If it's not JSON, assume it's a direct API domain
               zohoApiDomain = getZohoApiBaseUrl(decryptedValue);
             }
           }
           
           logInfo(jobId, `Using decrypted API domain: ${zohoApiDomain}`);
         } catch (error) {
           logWarning(jobId, `Failed to decrypt API domain, using auto-detection: ${error.message}`);
           zohoApiDomain = await detectZohoApiDomain(accessToken, jobId);
         }
       } else {
         logWarning(jobId, 'encryptedApiDomain not found in token, auto-detecting correct domain...');
         zohoApiDomain = await detectZohoApiDomain(accessToken, jobId);
       }

      logInfo(jobId, 'Successfully obtained Zoho access token');
      job.touch();

      // Clear related list cache
      relatedListCache.clear();

      // Determine last successful sync time
      let lastSuccessfulSyncTime = null;
      if (!backfill) {
        const lastSuccessJob = await JobHistory.findOne({
          sourceId,
          status: 'complete',
          name: 'zohocrm'
        }).sort({ startTime: -1 });

        if (lastSuccessJob) {
          lastSuccessfulSyncTime = lastSuccessJob.startTime;
          logInfo(jobId, `Last successful sync completed at: ${lastSuccessfulSyncTime}. This job will fetch records modified since then`);
        } else {
          logInfo(jobId, 'No previous successful sync found. Performing a full sync (backfill behavior) for all modules');
        }
      } else {
        logInfo(jobId, 'Backfill requested. Performing a full sync for all modules');
      }

      // Step 1: Discover modules
      logInfo(jobId, 'Step 1: Discovering custom modules');
      const allDiscoveredModules = await discoverModules(accessToken, zohoApiDomain, rateLimiters.metadata || defaultLimiter, job, jobId, tokenData.externalId);
      if (!allDiscoveredModules || allDiscoveredModules.length === 0) {
        throw new Error('Module discovery failed or returned no modules. Cannot proceed.');
      }
      logInfo(jobId, `Successfully discovered ${allDiscoveredModules.length} total modules from Zoho`);
      job.touch();

      // Step 2: Filter modules to process
      logInfo(jobId, 'Step 2: Creating module download list');
      const configuredModuleNames = new Set([
        ...Object.keys(zohoConfig.objects),
        ...(zohoConfig.objectTypeMapping.people || []),
        ...(zohoConfig.objectTypeMapping.organizations || []),
        ...(zohoConfig.objectTypeMapping.relationship || [])
      ]);
      logInfo(jobId, `Processing modules configured in config.json: ${Array.from(configuredModuleNames).join(', ')}`);

      // Debug: Log visibility status for configured modules
      const configuredModules = allDiscoveredModules.filter(m => configuredModuleNames.has(m.api_name));
      logInfo(jobId, `Configured modules visibility status:`);
      configuredModules.forEach(m => {
        logInfo(jobId, `  ${m.api_name}: visible=${m.visible}, creatable=${m.creatable}, editable=${m.editable}`);
      });

      // Temporarily bypass visibility check for testing - use configured modules regardless of visibility
      const modulesToProcess = allDiscoveredModules.filter(m => configuredModuleNames.has(m.api_name));
      // Original line: const modulesToProcess = allDiscoveredModules.filter(m => configuredModuleNames.has(m.api_name) && m.visible);

      if (modulesToProcess.length === 0) {
        logWarning(jobId, `No modules to process after filtering based on config.json. Discovered: ${allDiscoveredModules.map(m=>m.api_name).join(',')}`);
      } else {
        logInfo(jobId, `Filtered to ${modulesToProcess.length} modules for processing (visibility check bypassed): ${modulesToProcess.map(m => m.api_name).join(', ')}`);
      }

      // Step 3: Process each module
      logInfo(jobId, 'Step 3: Downloading records for each module');

      const StreamModel = workspaceConnection.model(`source_${sourceId}_stream`, new mongoose.Schema({}, { strict: false, collection: `source_${sourceId}_stream` }));

      for (const moduleInfo of modulesToProcess) {
        logInfo(jobId, `Processing module: ${moduleInfo.api_name} (${moduleInfo.plural_label})`);
        if (job) job.touch();

        const fields = await discoverFieldsPerModule(moduleInfo.api_name, accessToken, zohoApiDomain, rateLimiters.metadata || defaultLimiter, job, jobId, tokenData.externalId);
        if (!fields || fields.length === 0) {
          logWarning(jobId, `No fields discovered for module ${moduleInfo.api_name}. Skipping record download for this module`);
          continue;
        }
        logInfo(jobId, `Discovered ${fields.length} fields for ${moduleInfo.api_name}`);

        // Download records for this module
        await downloadModuleRecords(
          moduleInfo,
          fields,
          accessToken,
          zohoApiDomain,
          StreamModel,
          rateLimiters.read || defaultLimiter,
          rateLimiters.relatedRecords || defaultLimiter,
          job,
          savedJobHistory,
          sourceId,
          workspaceId,
          backfill,
          lastSuccessfulSyncTime,
          rateLimiters,
          jobId,
          tokenData.externalId
        );

        logInfo(jobId, `Completed record and related record download for module: ${moduleInfo.api_name}`);
      }

      logInfo(jobId, 'All configured modules processed');

      // Finalize job
      logSuccess(jobId, 'Job completed successfully');

    } catch (error) {
      await handleApiError(error, savedJobHistory, 'Overall Job', JobHistory, jobId);
      logError(jobId, `Zoho CRM batch job failed for source ${sourceId} in workspace ${workspaceId}`, error);
    } finally {
      const jobEndTime = new Date();
      const runtimeMilliseconds = jobEndTime - jobStartTime;

      if (savedJobHistory && JobHistory) {
        try {
          const finalStatus = savedJobHistory.errors && savedJobHistory.errors.length > 0 ? "failed" : "complete";
          await JobHistory.findByIdAndUpdate(savedJobHistory._id, { 
            status: finalStatus,
            startTime: jobStartTime.toISOString(),
            endTime: jobEndTime.toISOString(),
            runtimeMilliseconds
          });
        } catch (historyError) {
          logError(jobId, 'Failed to update job history in finally block', historyError);
        }
      }

      logInfo(jobId, `Job completed for source ID: ${sourceId}`);
      await workspaceConnection.close();
      done();
    }
  }
};

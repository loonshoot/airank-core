const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs').promises;
// Import JobHistorySchema and ConsolidatedRecordSchema
const { JobHistorySchema, ConsolidatedRecordSchema } = require('../../data/models'); 
require('dotenv').config(); // Load environment variables from .env

// Function to load source configs (reused from consolidateRecord)
const loadSourceConfigs = async () => {
  const sourcesDir = path.join(__dirname, '../../sources');
  const configs = {};

  try {
    const dirs = await fs.readdir(sourcesDir);
    for (const dir of dirs) {
      const configPath = path.join(sourcesDir, dir, 'config.json');
      try {
        delete require.cache[require.resolve(configPath)];
        const config = require(configPath);
        const baseSourceType = config.provider;
        configs[baseSourceType] = config;
        configs[dir] = config;
      } catch (err) {
        console.error(`Error loading config for ${dir}:`, err);
      }
    }
  } catch (err) {
    console.error('Error loading source configs:', err);
  }

  return configs;
};

// Cache for source configs
let sourceConfigsCache = null;

// Helper to get field value from a path string (e.g. "contact.email")
const getFieldValue = (obj, path) => {
  return path.split('.').reduce((curr, key) => curr && curr[key], obj);
};

// Helper to set field value from a path string
const setFieldValue = (obj, path, value) => {
  const keys = path.split('.');
  const lastKey = keys.pop();
  const target = keys.reduce((curr, key) => {
    curr[key] = curr[key] || {};
    return curr[key];
  }, obj);
  target[lastKey] = value;
};

// Helper to check if two values should be considered a match
const isFieldMatch = (value1, value2, field) => {
  if (!value1 || !value2) return false;
  
  // Convert values to strings for consistent comparison
  const str1 = String(value1);
  const str2 = String(value2);
  
  // Handle different field types
  switch(field) {
    case 'email':
    case 'emailAddress':
      return str1.toLowerCase() === str2.toLowerCase();
    case 'phone':
    case 'phoneNumbers.number':
      // Standardize to E.164 format for comparison
      const clean1 = standardizeToE164(str1);
      const clean2 = standardizeToE164(str2);
      return clean1 === clean2 && clean1 !== '';
    case 'firstName':
    case 'lastName':
      // Case-insensitive name comparison
      return str1.toLowerCase().trim() === str2.toLowerCase().trim();
    default:
      return str1 === str2;
  }
};

// Helper to standardize phone numbers to E.164 format
const standardizeToE164 = (phoneNumber, countryCode = null) => {
  if (!phoneNumber) return '';
  
  // Remove all non-numeric characters to get just digits
  let digits = phoneNumber.replace(/\D/g, '');
  
  // Country code mapping (ISO country code to phone country code)
  const countryCodes = {
    'US': '1',
    'CA': '1',
    'UK': '44',
    'GB': '44',
    'AU': '61',
    'DE': '49',
    'FR': '33',
    'JP': '81',
    'CN': '86',
    'IN': '91',
    'BR': '55',
    'IT': '39',
    'ES': '34',
    'NL': '31',
    'RU': '7',
    // Add more country codes as needed
  };
  
  // Try to determine country code
  let countryDialingCode = '1'; // Default to US
  
  // If country code provided, use it
  if (countryCode && countryCodes[countryCode.toUpperCase()]) {
    countryDialingCode = countryCodes[countryCode.toUpperCase()];
  }
  
  // Check if digits already start with a valid country code
  const startsWithCountryCode = Object.values(countryCodes).some(code => 
    digits.startsWith(code) && digits.length > parseInt(code) + 5
  );
  
  // If it doesn't have a country code, add one
  if (!startsWithCountryCode) {
    // For standard 10-digit numbers, add the appropriate country code
    if (digits.length === 10) {
      digits = countryDialingCode + digits;
    }
    // For numbers that look like they're missing country code
    else if (digits.length === 9 || digits.length === 11) {
      digits = countryDialingCode + digits;
    }
  }
  
  // Add + prefix for E.164 format
  return digits.length > 0 ? '+' + digits : '';
};

// Helper to calculate match confidence between two records
const calculateMatchConfidence = (record1, record2, rules) => {
  // First check for exact external ID matches - these should be automatic merges
  if (record1.externalIds && record2.externalIds) {
    for (const [provider, ids1] of Object.entries(record1.externalIds)) {
      if (record2.externalIds[provider]) {
        const ids2 = record2.externalIds[provider];
        
        // Check if any external IDs match between the two records
        const hasMatchingExternalId = Array.isArray(ids1) && Array.isArray(ids2) &&
          ids1.some(id1 => ids2.some(id2 => 
            id1.id && id2.id && String(id1.id) === String(id2.id)
          ));
          
        if (hasMatchingExternalId) {
          console.log(`consolidatePeople - Found matching external ID for ${provider}, automatic merge with 100% confidence`);
          return 1.0; // 100% confidence for external ID matches
        }
      }
    }
  }

  let matchCount = 0;
  let totalCriteria = 0;

  for (const rule of rules) {
    // Skip externalIds from normal confidence calculation since we handle them above
    if (rule.field === 'externalIds') {
      continue;
    }
    
    const value1 = getFieldValue(record1, rule.field);
    const value2 = getFieldValue(record2, rule.field);
    
    // Skip comparison if both values are blank/empty
    if ((!value1 || value1.length === 0) && (!value2 || value2.length === 0)) {
      continue;
    }
    
    // Only count fields where at least one record has a value
    if (value1 || value2) {
      totalCriteria++;
      
      // Special handling for array fields
      if (Array.isArray(value1) && Array.isArray(value2)) {
        // For arrays like phoneNumbers, check if any elements match
        let hasArrayMatch = false;
        
        if (rule.field === 'phoneNumbers') {
          // Extract phone numbers for comparison
          const phones1 = value1.map(p => p.number).filter(Boolean);
          const phones2 = value2.map(p => p.number).filter(Boolean);
          
          // Check if any phone number matches between the arrays
          for (const phone1 of phones1) {
            for (const phone2 of phones2) {
              if (isFieldMatch(phone1, phone2, 'phoneNumbers.number')) {
                hasArrayMatch = true;
                break;
              }
            }
            if (hasArrayMatch) break;
          }
        } else {
          // Generic array comparison
          hasArrayMatch = value1.some(v1 => 
            value2.some(v2 => JSON.stringify(v1) === JSON.stringify(v2))
          );
        }
        
        if (hasArrayMatch) {
          matchCount++;
        }
      } else if (isFieldMatch(value1, value2, rule.field)) {
        matchCount++;
      }
    }
  }

  return totalCriteria > 0 ? matchCount / totalCriteria : 0;
};

// Helper to create field history entry
const createFieldHistory = (field, oldValue, newValue, sourceType, timestamp) => {
  return {
    field,
    oldValue,
    newValue,
    sourceType,
    timestamp,
    changeType: oldValue ? 'update' : 'create'
  };
};

// Helper to convert workspace rules to search criteria
const buildSearchCriteriaFromRules = (rules, record) => {
  const searchCriteria = [];
  
  if (rules.combinator === 'or') {
    for (const rule of rules.rules) {
      const recordValue = getFieldValue(record, rule.value.replace('airank_', ''));
      if (recordValue) {
        searchCriteria.push({ [rule.field]: recordValue });
      }
    }
  }
  
  return searchCriteria;
};

// Helper to check if a field should be updated based on source priorities
const shouldUpdateField = (field, currentSourceInfo, newSourceInfo, sourceConfigs, combineSources, fieldMetadata = {}) => {
  // If the field was never set before, always update it
  if (!currentSourceInfo) {
    return true;
  }

  // Extract field-level source information if available
  const fieldSourceId = fieldMetadata.sourceId;
  const fieldSourceType = fieldMetadata.sourceType || (typeof currentSourceInfo === 'string' ? currentSourceInfo : currentSourceInfo.sourceType);
  
  // If specific source IDs are available and they match, always update (allow self-override)
  if (fieldSourceId && newSourceInfo.sourceId && fieldSourceId === newSourceInfo.sourceId) {
    return true;
  }
  
  // Fallback to sourceType comparison if IDs aren't available or don't match
  if (fieldSourceType === newSourceInfo.sourceType) {
    return true;
  }

  // If using automatic source combination, use default priority logic
  if (combineSources.data.method === 'automatic') {
    const currentPriority = sourceConfigs[fieldSourceType]?.priority || Infinity;
    const newPriority = sourceConfigs[newSourceInfo.sourceType]?.priority || Infinity;
    return newPriority <= currentPriority;
  }
  
  // For manual source combination, check manual priority settings from manualSources array
  const manualSources = combineSources.data?.manualSources || [];
  const currentSource = manualSources.find(s => s.sourceType === fieldSourceType);
  const newSource = manualSources.find(s => s.sourceType === newSourceInfo.sourceType);
  
  // If source not found in manual configuration, treat as lowest priority
  const currentRank = currentSource?.displayRank || Infinity;
  const newRank = newSource?.displayRank || Infinity;
  
  // Lower displayRank means higher priority
  if (newRank < currentRank) {
    return true;
  }
  
  // If same rank, check willOverride flag
  if (newRank === currentRank) {
    return newSource?.willOverride || false;
  }
  
  return false;
};

// Helper to get nested value using dot notation or array of possible paths
const getNestedValue = (obj, path) => {
  if (Array.isArray(path)) {
    // Try each path in order until we find a value
    for (const p of path) {
      const value = getNestedValue(obj, p);
      if (value !== undefined) return value;
    }
    return undefined;
  }
  
  return path.split('.').reduce((curr, key) => curr && curr[key], obj);
};

// Helper to transform record based on field mapping
const transformRecord = (record, fieldMapping) => {
  if (!record || typeof record !== 'object') {
    console.warn('consolidatePeople - Record is undefined or not an object');
    return {};
  }

  if (!fieldMapping || typeof fieldMapping !== 'object') {
    console.warn('consolidatePeople - Field mapping is undefined or not an object');
    return {};
  }

  const transformed = {};

  try {
    for (const [commonField, mapping] of Object.entries(fieldMapping)) {
      if (!mapping) continue;

      // Handle simple string mappings (direct field paths)
      if (typeof mapping === 'string') {
        const value = getFieldValue(record, mapping);
        if (value !== undefined) {
          transformed[commonField] = value;
        }
      } 
      // Handle array mappings (for phoneNumbers, addresses, etc)
      else if (Array.isArray(mapping)) {
        transformed[commonField] = mapping.reduce((arr, item) => {
          const mappedItem = {};
          let hasValue = false;

          // Map each field in the item
          for (const [key, path] of Object.entries(item)) {
            if (typeof path === 'string') {
              const value = getFieldValue(record, path);
              if (value !== undefined) {
                mappedItem[key] = value;
                hasValue = true;
              }
            } else {
              // Handle static values (like type: "mobile")
              mappedItem[key] = path;
              hasValue = true;
            }
          }

          if (hasValue) {
            arr.push(mappedItem);
          }
          return arr;
        }, []);
      }
      // Handle nested object mappings (for externalIds)
      else if (typeof mapping === 'object') {
        transformed[commonField] = {};
        for (const [key, value] of Object.entries(mapping)) {
          if (Array.isArray(value)) {
            transformed[commonField][key] = value.map(item => {
              const mappedItem = {};
              for (const [itemKey, itemPath] of Object.entries(item)) {
                if (typeof itemPath === 'string') {
                  const fieldValue = getFieldValue(record, itemPath);
                  if (fieldValue !== undefined) {
                    mappedItem[itemKey] = fieldValue;
                  }
                } else {
                  mappedItem[itemKey] = itemPath;
                }
              }
              return mappedItem;
            });
          }
        }
      }
    }
  } catch (error) {
    console.error('consolidatePeople - Error transforming record:', error);
    return {};
  }

  return transformed;
};

// Helper to find duplicates based on workspace configuration
const findDuplicates = async (PeopleModel, transformedRecord, mergeConfig, consolidationConfig, sourceType, rules) => {
  const searchCriteria = [];
  
  // Get source-specific unique identifiers from consolidation config
  const sourceUniqueIds = consolidationConfig.sources[sourceType]?.uniqueIdentifiers || [];
  
  console.log(`consolidatePeople - Finding duplicates for ${sourceType} using unique identifiers:`, sourceUniqueIds);
  
  // If we have an external HubSpot ID, always add that to the search criteria first
  if (transformedRecord.externalIds && 
      transformedRecord.externalIds.hubspot && 
      Array.isArray(transformedRecord.externalIds.hubspot) && 
      transformedRecord.externalIds.hubspot.length > 0) {
    
    const hubspotIds = transformedRecord.externalIds.hubspot.map(id => id.id).filter(Boolean);
    
    if (hubspotIds.length > 0) {
      console.log(`consolidatePeople - Found HubSpot IDs to search with:`, hubspotIds);
      
      // Add specific searches for HubSpot IDs in various formats
      hubspotIds.forEach(id => {
        // Direct match on the ID field
        searchCriteria.push({ 'externalIds.hubspot.id': id });
        
        // Match using $elemMatch for more complex array matching
        searchCriteria.push({ 
          'externalIds.hubspot': { 
            $elemMatch: { id: id } 
          } 
        });
      });
    }
  }
  
  // Name-based matching (when first and last name are both available)
  if (transformedRecord.firstName && transformedRecord.lastName) {
    console.log(`consolidatePeople - Adding name-based search criteria: ${transformedRecord.firstName} ${transformedRecord.lastName}`);
    
    // Add criteria for exact name match (case insensitive)
    searchCriteria.push({ 
      $and: [
        { firstName: { $regex: `^${escapeRegExp(transformedRecord.firstName)}$`, $options: 'i' } },
        { lastName: { $regex: `^${escapeRegExp(transformedRecord.lastName)}$`, $options: 'i' } }
      ]
    });
  }
  
  // Build criteria from configured rules
  for (const rule of rules) {
    // Only use identifiers that are allowed for this source
    if (sourceUniqueIds.includes(rule.field)) {
      const value = getFieldValue(transformedRecord, rule.field);
      
      if (value) {
        // Handle nested fields (like phoneNumbers.number)
        if (rule.field.includes('.')) {
          const [arrayField, valueField] = rule.field.split('.');
          const array = transformedRecord[arrayField];
          if (Array.isArray(array)) {
            array.forEach(item => {
              if (item[valueField]) {
                // For phone numbers, standardize to E.164 for searching
                if (arrayField === 'phoneNumbers' && valueField === 'number') {
                  // Try to get country from the address if available
                  let countryCode = null;
                  if (transformedRecord.addresses && transformedRecord.addresses.length > 0) {
                    // Use the country from the first address that has one
                    for (const address of transformedRecord.addresses) {
                      if (address.country) {
                        countryCode = address.country;
                        break;
                      }
                    }
                  }
                  
                  const standardizedPhone = standardizeToE164(item[valueField], countryCode);
                  if (standardizedPhone) {
                    console.log(`consolidatePeople - Adding search criteria for standardized ${arrayField}.${valueField}:`, standardizedPhone);
                    console.log(`consolidatePeople - Used country code: ${countryCode || 'default'}`);
                    
                    // Search by standardized phone number and also by pattern that would match various formats
                    searchCriteria.push({ [`${arrayField}.${valueField}`]: standardizedPhone });
                    
                    // Also search for the phone number without the leading +
                    if (standardizedPhone.startsWith('+')) {
                      const digitsOnly = standardizedPhone.substring(1);
                      searchCriteria.push({ [`${arrayField}.${valueField}`]: { $regex: digitsOnly + '$' } });
                    }
                  }
                } else {
                  console.log(`consolidatePeople - Adding search criteria for ${arrayField}.${valueField}:`, item[valueField]);
                  searchCriteria.push({ [`${arrayField}.${valueField}`]: item[valueField] });
                }
              }
            });
          }
        } 
        // Handle email address special case with case-insensitive search
        else if (rule.field === 'emailAddress' && typeof value === 'string') {
          console.log(`consolidatePeople - Adding case-insensitive search for emailAddress:`, value);
          searchCriteria.push({ emailAddress: { $regex: `^${escapeRegExp(value)}$`, $options: 'i' } });
        }
        // Handle externalIds special case
        else if (rule.field === 'externalIds') {
          // Already handled HubSpot IDs at the top, skip to avoid duplication
          if (value.hubspot) {
            console.log(`consolidatePeople - Skipping duplicate hubspot ID criteria (already added)`);
          }
          
          // Add other external IDs if present
          Object.entries(value).forEach(([provider, ids]) => {
            if (provider !== 'hubspot' && Array.isArray(ids)) {
              ids.forEach(id => {
                if (id && id.id) {
                  console.log(`consolidatePeople - Adding search criteria for externalIds.${provider}.id:`, id.id);
                  searchCriteria.push({ [`externalIds.${provider}.id`]: id.id });
                }
              });
            }
          });
        }
        // Handle simple fields
        else {
          console.log(`consolidatePeople - Adding search criteria for ${rule.field}:`, value);
          searchCriteria.push({ [rule.field]: value });
        }
      }
    }
  }

  if (searchCriteria.length === 0) {
    console.log('consolidatePeople - No search criteria generated, returning empty results');
    return [];
  }

  // Only match against non-archived records unless the incoming record is also archived
  const isArchived = transformedRecord.archived === true;
  const query = { 
    $or: searchCriteria,
    // Only include this condition for non-archived records
    ...(isArchived ? {} : { archived: { $ne: true } })
  };
  
  console.log('consolidatePeople - Searching with query criteria:', JSON.stringify(query.$or.map(c => Object.keys(c)[0])));
  console.log('consolidatePeople - Only matching non-archived records:', !isArchived);
  
  try {
    const results = await PeopleModel.find(query).exec();
    console.log(`consolidatePeople - Found ${results.length} matching records`);
    
    if (results.length > 0) {
      // Log IDs of matching records to help with debugging
      console.log(`consolidatePeople - Matching record IDs:`, results.map(r => r._id.toString()));
    }
    
    return results;
  } catch (err) {
    console.error('consolidatePeople - Error finding duplicates:', err);
    return [];
  }
};

// Helper function to escape special regex characters
const escapeRegExp = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// Helper to merge array fields based on field type
const mergeArrayFields = (existing, incoming, fieldName, sourceInfo, combineSources, consolidationConfig) => {
  // Get sourceType from sourceInfo object or use it directly if it's a string
  const sourceType = typeof sourceInfo === 'object' ? sourceInfo.sourceType : sourceInfo;
  const existingArray = existing[fieldName] || [];
  const incomingArray = incoming[fieldName] || [];
  
  // If using automatic mode or no existing data, just use incoming array
  if (!existingArray.length || 
      (combineSources.data.method === 'automatic' && shouldUpdateField(fieldName, existing.metadata.fieldMetadata?.[fieldName]?.sourceType, sourceInfo, consolidationConfig?.sources, combineSources))) {
    return incomingArray;
  }

  // For manual mode, merge based on field type
  const merged = [...existingArray];
  
  for (const incomingItem of incomingArray) {
    let isDuplicate = false;
    
    switch(fieldName) {
      case 'phoneNumbers':
        isDuplicate = merged.some(m => normalizePhone(m.number) === normalizePhone(incomingItem.number));
        break;
        
      case 'addresses':
        isDuplicate = merged.some(m => 
          normalizeString(m.street) === normalizeString(incomingItem.street) &&
          normalizeString(m.city) === normalizeString(incomingItem.city) &&
          normalizeString(m.state) === normalizeString(incomingItem.state) &&
          normalizeString(m.country) === normalizeString(incomingItem.country) &&
          normalizeString(m.postalCode) === normalizeString(incomingItem.postalCode)
        );
        break;
        
      case 'socialProfiles':
        isDuplicate = merged.some(m => 
          m.platform === incomingItem.platform &&
          (m.handle === incomingItem.handle || m.url === incomingItem.url)
        );
        break;
        
      case 'associations':
        isDuplicate = merged.some(m => 
          m.type === incomingItem.type &&
          m.id === incomingItem.id &&
          m.source === incomingItem.source
        );
        break;
        
      default:
        isDuplicate = merged.some(m => JSON.stringify(m) === JSON.stringify(incomingItem));
    }
    
    if (!isDuplicate) {
      merged.push(incomingItem);
    }
  }
  
  return merged;
};

// Helper to normalize strings for comparison
const normalizeString = (str) => {
  if (!str) return '';
  return str.toLowerCase().trim().replace(/\s+/g, ' ');
};

// Helper to normalize phone numbers for comparison
const normalizePhone = (phone) => {
  if (!phone) return '';
  return phone.replace(/\D/g, '');
};

// Helper to merge records
const mergeRecords = (existing, incoming, sourceInfo, combineSources, consolidationConfig) => {
  const merged = { ...existing };
  const now = new Date();
  
  // Ensure sourceInfo is an object with both id and type
  const sourceData = typeof sourceInfo === 'string' 
    ? { sourceType: sourceInfo } 
    : sourceInfo;
  
  // Initialize or get field metadata to track source and timestamp of each field
  merged.metadata = merged.metadata || {};
  merged.metadata.fieldMetadata = merged.metadata.fieldMetadata || {};
  
  // Merge array fields
  const arrayFields = ['phoneNumbers', 'addresses', 'socialProfiles', 'associations'];
  for (const field of arrayFields) {
    if (incoming[field]) {
      merged[field] = mergeArrayFields(existing, incoming, field, sourceData, combineSources, consolidationConfig);
      // Update field metadata with source ID, type and timestamp
      merged.metadata.fieldMetadata[field] = {
        sourceId: sourceData.sourceId,
        sourceType: sourceData.sourceType,
        updatedAt: now
      };
    }
  }
  
  // Merge externalIds
  if (incoming.externalIds) {
    merged.externalIds = merged.externalIds || {};
    for (const [provider, ids] of Object.entries(incoming.externalIds)) {
      merged.externalIds[provider] = mergeArrayFields(
        { ids: merged.externalIds[provider] || [] },
        { ids },
        'ids',
        sourceData,
        combineSources,
        consolidationConfig
      ).ids;
      // Update field metadata with source ID, type and timestamp
      merged.metadata.fieldMetadata[`externalIds.${provider}`] = {
        sourceId: sourceData.sourceId,
        sourceType: sourceData.sourceType,
        updatedAt: now
      };
    }
  }
  
  // Update scalar fields based on source priority and field-level source information
  for (const [field, value] of Object.entries(incoming)) {
    if (!arrayFields.includes(field) && field !== 'externalIds' && field !== 'metadata') {
      // Get field-level metadata for this specific field
      const fieldMetadata = {
        sourceId: existing.metadata?.fieldMetadata?.[field]?.sourceId,
        sourceType: existing.metadata?.fieldMetadata?.[field]?.sourceType
      };
      
      if (shouldUpdateField(field, existing.metadata.lastSourceType, sourceData, consolidationConfig.sources, combineSources, fieldMetadata)) {
        merged[field] = value;
        // Update field metadata with source ID, type and timestamp
        merged.metadata.fieldMetadata[field] = {
          sourceId: sourceData.sourceId,
          sourceType: sourceData.sourceType,
          updatedAt: now
        };
      }
    }
  }
  
  return merged;
};

// Helper to get the record ID based on source configuration
const getRecordId = (record, sourceType, sourceConfigs) => {
  // First try to get the ID from the top-level externalId (like in Salesforce)
  if (record.externalId) {
    console.log(`Using top-level externalId: ${record.externalId}`);
    return record.externalId;
  }
  
  // Otherwise, try to get the ID based on the source config
  const sourceConfig = sourceConfigs[sourceType];
  if (!sourceConfig) {
    console.error(`No config found for source type: ${sourceType}`);
    return null;
  }
  
  // Get primaryId field from config
  const primaryIdField = sourceConfig.defaultConfig?.primaryId || 'id';
  console.log(`Using primaryId field from config: ${primaryIdField}`);
  
  // Try to get ID from record using primaryId
  const id = record.record[primaryIdField];
  if (id) {
    console.log(`Found ID using primaryId field: ${id}`);
    return id;
  }
  
  // Last resort: try common ID field names
  const possibleIdFields = ['id', 'Id', 'ID', '_id'];
  for (const field of possibleIdFields) {
    if (record.record[field]) {
      console.log(`Found ID using fallback field: ${field}`);
      return record.record[field];
    }
  }
  
  console.error('Could not find ID in record');
  return null;
};

// Helper to create appropriate indexes for a given collection based on source type
async function createIndexesForSource(collection, sourceType, sourceConfigsCache) {
  console.log(`Creating indexes for source type: ${sourceType}`);
  
  try {
    // Get the source config
    const sourceConfig = sourceConfigsCache[sourceType];
    
    if (!sourceConfig) {
      console.log(`No source config found for source type: ${sourceType}`);
      return;
    }
    
    // Create standard index for the external source ID
    const defaultIdField = `externalIds.${sourceType}.id`;
    await collection.createIndex({ [defaultIdField]: 1 }, { background: true, sparse: true });
    console.log(`Created index for ${defaultIdField}`);
    
    // Check if source config contains index configuration
    if (sourceConfig.indexConfig) {
      // Create common indexes
      if (sourceConfig.indexConfig.common) {
        for (const indexDef of sourceConfig.indexConfig.common) {
          const indexFields = Object.keys(indexDef).filter(key => key !== 'options');
          const indexOptions = indexDef.options || { background: true };
          
          const indexSpec = {};
          for (const field of indexFields) {
            indexSpec[field] = indexDef[field];
          }
          
          await collection.createIndex(indexSpec, indexOptions);
          console.log(`Created common index for ${JSON.stringify(indexSpec)}`);
        }
      }
      
      // Create collection-specific indexes
      const collectionType = collection.collectionName === 'organizations' ? 'organizations' : 
                            collection.collectionName === 'people' ? 'people' : 'relationships';
      
      if (sourceConfig.indexConfig[collectionType]) {
        for (const indexDef of sourceConfig.indexConfig[collectionType]) {
          const indexFields = Object.keys(indexDef).filter(key => key !== 'options');
          const indexOptions = indexDef.options || { background: true };
          
          const indexSpec = {};
          for (const field of indexFields) {
            indexSpec[field] = indexDef[field];
          }
          
          await collection.createIndex(indexSpec, indexOptions);
          console.log(`Created ${collectionType} index for ${JSON.stringify(indexSpec)}`);
        }
      }
    } else {
      // Fallback to generic recommended indexes if no source-specific indexes are defined
      console.log('No index configuration found in source config, creating generic indexes');
      
      // Create basic indexes for all collections
      if (collection.collectionName === 'organizations') {
        await collection.createIndex({ 'companyName': 1 }, { background: true, sparse: true });
        await collection.createIndex({ 'domain': 1 }, { background: true, sparse: true });
      } else if (collection.collectionName === 'people') {
        await collection.createIndex({ 'emailAddress': 1 }, { background: true, sparse: true });
        await collection.createIndex({ 'phoneNumbers.number': 1 }, { background: true, sparse: true });
      } else if (collection.collectionName === 'relationships') {
        await collection.createIndex({ 'source.id': 1, 'target.id': 1 }, { background: true });
        await collection.createIndex({ 'metadata.sourceEntityType': 1, 'metadata.targetEntityType': 1 }, { background: true });
      }
    }
  } catch (error) {
    console.error(`Error creating indexes for source ${sourceType}:`, error);
    // Continue processing, don't throw error
  }
}

// Helper to determine object configuration from object type mapping
const getObjectConfigForSourceType = (sourceConfigsCache, sourceType, record) => {
  if (!sourceConfigsCache || !sourceType) {
    console.error('Missing source configs or source type');
    return null;
  }

  const sourceConfig = sourceConfigsCache[sourceType];
  if (!sourceConfig) {
    console.error(`No source config found for ${sourceType}`);
    return null;
  }

  // Get the actual object type from the record
  const recordObjectType = record.metadata.objectType;
  console.log(`Determining mapping for record with objectType: ${recordObjectType}`);

  // Find the corresponding object configuration
  const objectConfig = sourceConfig.objects?.[recordObjectType];
  if (objectConfig) {
    console.log(`Found object config for ${recordObjectType}`);
    return objectConfig;
  }

  // If direct match not found, try to find by checking the objectTypeMapping
  if (sourceConfig.objectTypeMapping?.people) {
    const mappedTypes = sourceConfig.objectTypeMapping.people;
    
    if (mappedTypes.includes(recordObjectType)) {
      console.log(`Found mapped object type ${recordObjectType} for people`);
      const objectConfig = sourceConfig.objects?.[recordObjectType];
      
      if (objectConfig) {
        console.log(`Found object config for ${recordObjectType} through mapping`);
        return objectConfig;
      }
    }
  }

  console.warn(`No object config found for ${recordObjectType} in ${sourceType}`);
  return null;
};

// Helper to get the external ID key for a source
const getExternalIdKey = (sourceType, sourceConfigsCache) => {
  if (!sourceConfigsCache) return sourceType;
  
  const sourceConfig = sourceConfigsCache[sourceType];
  if (!sourceConfig) return sourceType;
  
  // Get the external ID key from config, or use a default
  return sourceConfig.externalIdKey || sourceType;
};

/**
 * Update any relationship documents that reference this person
 * @param {Object} person - The consolidated person record
 * @param {Object} db - MongoDB connection
 * @param {Array} externalIds - Array of external IDs for this person
 */
async function updateRelationshipsForPerson(person, db, externalIds) {
  try {
    if (!person || !person._id) {
      console.log('Cannot update relationships: Missing person record or _id');
      return;
    }

    const personId = person._id.toString();
    const Relationships = db.model('relationships', new mongoose.Schema({}, { strict: false }));
    
    console.log(`Looking for relationships that reference person with ID: ${personId}`);
    console.log(`External IDs to check: ${JSON.stringify(externalIds)}`);
    
    // Build query to find any relationships that reference this person
    const queries = [];
    
    // Add queries for MongoDB ObjectId (in case it was previously set correctly)
    if (mongoose.Types.ObjectId.isValid(personId)) {
      queries.push({ 'source.id': personId, 'source.type': 'person' });
      queries.push({ 'target.id': personId, 'target.type': 'person' });
    }
    
    // Add queries for each external ID
    for (const externalId of externalIds) {
      if (externalId) {
        // Convert externalId to string for consistent handling
        const externalIdStr = String(externalId);
        // Only search in externalId field, not in id field
        queries.push({ 'source.externalId': externalIdStr, 'source.type': 'person' });
        queries.push({ 'target.externalId': externalIdStr, 'target.type': 'person' });
      }
    }
    
    if (queries.length === 0) {
      console.log('No external IDs to search for relationships');
      return;
    }
    
    // Find all relationships that reference this person
    const relationships = await Relationships.find({ $or: queries }).exec();
    console.log(`Found ${relationships.length} relationships referencing this person`);
    
    // Get display name for the person
    let displayName = '';
    if (person.name && (person.name.firstName || person.name.lastName)) {
      displayName = `${person.name.firstName || ''} ${person.name.lastName || ''}`.trim();
    } else if (person.emailAddress) {
      displayName = person.emailAddress;
    }
    
    // Update each relationship
    let updateCount = 0;
    for (const relationship of relationships) {
      let updated = false;
      
      // Check and update source if it references this person
      if (relationship.source.type === 'person' && 
          externalIds.some(id => String(id) === String(relationship.source.externalId))) {
        // Keep the external ID as is, just ensure it's a string
        relationship.source.externalId = String(relationship.source.externalId);
        // Update id to MongoDB ObjectId
        relationship.source.id = personId;
        if (displayName) relationship.source.displayName = displayName;
        updated = true;
      }
      
      // Check and update target if it references this person
      if (relationship.target.type === 'person' && 
          externalIds.some(id => String(id) === String(relationship.target.externalId))) {
        // Keep the external ID as is, just ensure it's a string
        relationship.target.externalId = String(relationship.target.externalId);
        // Update id to MongoDB ObjectId
        relationship.target.id = personId;
        if (displayName) relationship.target.displayName = displayName;
        updated = true;
      }
      
      // Save the relationship if updated
      if (updated) {
        await relationship.save();
        updateCount++;
      }
    }
    
    console.log(`Updated ${updateCount} relationships with person's MongoDB ObjectId`);
  } catch (error) {
    console.error('Error updating relationships for person:', error);
    // Don't throw - let the main process continue
  }
}

module.exports = {
  job: async (job, done) => {
    const { sourceId, sourceType, workspaceId, objectId, externalRecordId } = job.attrs.data;
    const jobStartTime = new Date();
    let workspaceConnection;

    try {
      // Validate required fields
      if (!sourceId || !sourceType || !workspaceId || !objectId) {
        console.error('Missing required fields:', {
          hasSourceId: !!sourceId,
          hasSourceType: !!sourceType,
          hasWorkspaceId: !!workspaceId,
          hasObjectId: !!objectId
        });
        throw new Error('Missing required fields');
      }

      // Load configs if not cached
      if (!sourceConfigsCache) {
        sourceConfigsCache = await loadSourceConfigs();
      }
      
      const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
      workspaceConnection = await mongoose.createConnection(dataLakeUri).asPromise();

      // Define models on the workspace connection
      const JobHistory = workspaceConnection.model('JobHistory', JobHistorySchema);
      // Define People model using imported schema, named 'People', targeting 'people' collection
      const People = workspaceConnection.model('People', ConsolidatedRecordSchema, 'people'); 

      // Create indices with proper error handling
      try {
        console.log('consolidatePeople - Creating indices for better duplicate detection');
        await createIndexesForSource(People.collection, sourceType, sourceConfigsCache);
      } catch (indexError) {
        console.error('consolidatePeople - Error creating indices:', indexError.message);
        // Continue processing despite index error - don't crash the job
      }

      // Safely create ObjectId for sourceId
      let sourceIdObject;
      try {
        if (mongoose.Types.ObjectId.isValid(sourceId)) {
          sourceIdObject = new mongoose.Types.ObjectId(sourceId);
        } else {
          console.warn(`consolidatePeople - Invalid ObjectId for sourceId: ${sourceId}, using string as is`);
          sourceIdObject = sourceId;
        }
      } catch (objectIdError) {
        console.error(`consolidatePeople - Error creating ObjectId from ${sourceId}:`, objectIdError);
        sourceIdObject = sourceId;
      }

      // Get consolidated collection
      const consolidatedCollection = workspaceConnection.collection(`source_${sourceId}_consolidated`);
      
      // Fetch the record using objectId
      console.log('consolidatePeople - Looking for record', objectId);
      
      // Try to find the record using different strategies
      let record = null;
      
      // First try MongoDB ObjectId
      if (mongoose.Types.ObjectId.isValid(objectId)) {
        try {
          record = await consolidatedCollection.findOne({ _id: new mongoose.Types.ObjectId(objectId) });
          if (record) {
            console.log('consolidatePeople - Found record by MongoDB ObjectId');
          }
        } catch (error) {
          console.error('consolidatePeople - Error finding by MongoDB ObjectId:', error);
        }
      }
      
      // If not found and we have externalRecordId, try that
      if (!record && externalRecordId) {
        try {
          record = await consolidatedCollection.findOne({ 'record.id': externalRecordId });
          if (record) {
            console.log('consolidatePeople - Found record by external ID');
          }
        } catch (error) {
          console.error('consolidatePeople - Error finding by external ID:', error);
        }
      }
      
      // If still not found, try the objectId as an external ID
      if (!record) {
        try {
          record = await consolidatedCollection.findOne({ 'record.id': objectId });
          if (record) {
            console.log('consolidatePeople - Found record by objectId as external ID');
          }
        } catch (error) {
          console.error('consolidatePeople - Error finding by objectId as external ID:', error);
        }
      }
      
      console.log('consolidatePeople - Record lookup complete');

      if (!record) {
        throw new Error(`Record not found using any available identifier`);
      }

      // Get source config to check object type mapping
      const sourceTypeConfig = sourceConfigsCache[sourceType];
      if (!sourceTypeConfig) {
        throw new Error(`No source config found for source type: ${sourceType}`);
      }

      // Validate that we're only processing people based on objectTypeMapping
      const validObjectTypes = sourceTypeConfig.objectTypeMapping?.people || [];
      if (!validObjectTypes.includes(record.metadata.objectType)) {
        console.log(`Skipping record ${objectId} - not a people type (${record.metadata.objectType})`);
        return;
      }

      console.log('consolidatePeople - Processing record');

      // Get consolidation config
      const consolidationConfig = require('./config.json');
      const sourceConfig = consolidationConfig.sources[sourceType];
      
      if (!sourceConfig) {
        throw new Error(`No config found for source type: ${sourceType}`);
      }

      // Get workspace-specific configurations
      console.log('Fetching workspace configurations...');
      let [mergeConfig, combineSourcesConfig] = await Promise.all([
        workspaceConnection.collection('config').findOne({ configType: 'dataPeopleMergeIdentities' }),
        workspaceConnection.collection('config').findOne({ configType: 'dataPeopleCombineSources' })
      ]);
      console.log('consolidatePeople - Workspace configurations loaded');

      // Use default configurations if not found
      const defaultMergeConfig = {
        method: 'automatic',
        data: {
          rules: {
            rules: consolidationConfig.mergeRules.matchingCriteria.map(field => ({
              field,
              operator: 'equals'
            }))
          }
        }
      };

      const defaultCombineSourcesConfig = {
        method: 'automatic',
        data: {
          manualSources: []
        }
      };

      if (!mergeConfig) {
        console.log('consolidatePeople - Using default merge config with criteria');
        mergeConfig = defaultMergeConfig;
      }

      if (!combineSourcesConfig) {
        console.log('consolidatePeople - Using default combine sources config');
        combineSourcesConfig = defaultCombineSourcesConfig;
      }

      // Get object config
      const objectConfig = getObjectConfigForSourceType(sourceConfigsCache, sourceType, record);
      console.log('consolidatePeople - Object config loaded');

      // Transform record using mapping
      console.log('consolidatePeople - Transforming record');
      
      // IMPORTANT FIX: Pass record.record directly rather than assuming properties subfield
      const transformedRecord = objectConfig?.peopleMapping 
        ? transformRecord(record.record, objectConfig.peopleMapping)
        : {};
      console.log('consolidatePeople - Record transformation complete');

      // Check if the record is archived in the source
      if (record.record.archived === true) {
        console.log('consolidatePeople - Processing archived record');
        
        // For archived records, set the archived flag in the transformed record
        transformedRecord.archived = true;
      }

      // Validate transformed record only contains approved fields
      const approvedFields = Object.keys(consolidationConfig.commonFields);

      
      const filteredRecord = {};
      for (const [key, value] of Object.entries(transformedRecord)) {
        if (approvedFields.includes(key)) {
          filteredRecord[key] = value;
        } else {
          console.warn(`Removing unapproved field: ${key}`);
        }
      }

      // CRITICAL ENHANCEMENT: Pre-check for existing records with the same HubSpot ID
      // This is a direct check before going through the more complex duplicate detection logic
      let existingRecord = null;
      if (filteredRecord.externalIds && 
          filteredRecord.externalIds.hubspot && 
          Array.isArray(filteredRecord.externalIds.hubspot) && 
          filteredRecord.externalIds.hubspot.length > 0) {
        
        const hubspotId = filteredRecord.externalIds.hubspot[0].id;
        
        if (hubspotId) {
          console.log(`consolidatePeople - PRE-CHECK: Directly checking for existing record with HubSpot ID ${hubspotId}`);
          
          try {
            existingRecord = await People.findOne({ 'externalIds.hubspot.id': hubspotId }).exec();
            
            if (existingRecord) {
              console.log(`consolidatePeople - PRE-CHECK: Found existing record with ID ${existingRecord._id} matching HubSpot ID ${hubspotId}`);
            } else {
              console.log(`consolidatePeople - PRE-CHECK: No existing record found with HubSpot ID ${hubspotId}`);
            }
          } catch (preCheckError) {
            console.error(`consolidatePeople - PRE-CHECK: Error searching for existing record:`, preCheckError);
            // Continue with normal duplicate detection if pre-check fails
          }
        }
      }

      // Define rules here for use in both findDuplicates and calculateMatchConfidence
      let rules = [];
      
      // If mergeConfig doesn't have a method property, set default
      if (!mergeConfig.method) {
        mergeConfig.method = 'automatic';
      }
      
      // Ensure data property exists
      if (!mergeConfig.data) {
        mergeConfig.data = {};
      }
      
      if (mergeConfig.method === 'automatic') {
        // Handle different possible structures for automatic rules
        if (Array.isArray(mergeConfig.data.rules)) {
          rules = mergeConfig.data.rules;
        } else if (mergeConfig.data.rules && Array.isArray(mergeConfig.data.rules.rules)) {
          rules = mergeConfig.data.rules.rules;
        } else {
          // Fallback to default rules from consolidation config
          rules = consolidationConfig.mergeRules.matchingCriteria.map(field => ({
            field,
            operator: 'equals'
          }));
        }
      } else if (mergeConfig.method === 'manual') {
        // Handle different possible structures for manual rules
        if (Array.isArray(mergeConfig.data.manualRules)) {
          rules = mergeConfig.data.manualRules;
        } else if (mergeConfig.data.manualRules && Array.isArray(mergeConfig.data.manualRules.rules)) {
          rules = mergeConfig.data.manualRules.rules;
        } else {
          // Fallback to default rules
          rules = consolidationConfig.mergeRules.matchingCriteria.map(field => ({
            field,
            operator: 'equals'
          }));
        }
      } else {
        // Fallback to default rules
        rules = consolidationConfig.mergeRules.matchingCriteria.map(field => ({
          field,
          operator: 'equals'
        }));
      }

      // If we already found a match in the pre-check, use that instead of running the full duplicate search
      let duplicates = [];
      let bestMatch = existingRecord;
      let bestMatchConfidence = existingRecord ? 1.0 : 0; // If found in pre-check, confidence is 100%
      
      // Only run the full duplicate search if we didn't find a match in the pre-check
      if (!existingRecord) {
        console.log('consolidatePeople - Running full duplicate detection');
        // Find duplicates using the People model
        duplicates = await findDuplicates(
          People, // Use People model
          filteredRecord,
          mergeConfig || defaultMergeConfig,
          consolidationConfig,
          sourceType,
          rules 
        );
        console.log('consolidatePeople - Duplicate search complete');
        console.log('Found duplicates count:', duplicates ? duplicates.length : 0);

        // Find best matching record if multiple matches exist
        for (const duplicate of duplicates) {
          const confidence = calculateMatchConfidence(
            filteredRecord,
            duplicate,
            rules
          );
          console.log(`Duplicate match confidence: ${confidence} (threshold: ${consolidationConfig.mergeRules.confidenceThreshold})`);

          if (confidence > bestMatchConfidence && 
              confidence >= consolidationConfig.mergeRules.confidenceThreshold) {
            bestMatchConfidence = confidence;
            bestMatch = duplicate;
          }
        }
      }

      const now = new Date();
      let fieldHistory = [];

      if (bestMatch) {
        console.log('consolidatePeople - Merging with existing person record');
        // Pass consolidationConfig to mergeRecords
        const mergedRecord = mergeRecords(
          bestMatch.toObject ? bestMatch.toObject() : bestMatch,
          filteredRecord,
          {
            sourceId: sourceIdObject.toString(),
            sourceType: sourceType
          },
          combineSourcesConfig,
          consolidationConfig
        );
        console.log('consolidatePeople - Updated existing record with ID:', bestMatch._id);

        // Track field changes
        for (const [field, value] of Object.entries(mergedRecord)) {
          if (JSON.stringify(value) !== JSON.stringify(bestMatch[field])) {
            fieldHistory.push(createFieldHistory(
              field,
              bestMatch[field],
              value,
              sourceType,
              now
            ));
          }
        }

        // Update existing externalIds or create new ones
        const existingExternalIds = bestMatch.externalIds || {};
        const externalIdKey = getExternalIdKey(sourceType, sourceConfigsCache);

        // Get the ID dynamically based on the source config
        const recordId = getRecordId(record, sourceType, sourceConfigsCache);

        // Append to existing external IDs instead of overwriting
        const newExternalId = {
          id: recordId,
          label: 'Contact ID',
          type: 'contact',
          timestamp: now
        };

        // Check if this external ID already exists to avoid duplicates
        const existingIds = existingExternalIds[externalIdKey] || [];
        const idExists = existingIds.some(existingId => existingId.id === recordId);

        if (!idExists) {
          existingExternalIds[externalIdKey] = [...existingIds, newExternalId];
        } else {
          // If ID exists, update the timestamp
          existingExternalIds[externalIdKey] = existingIds.map(existingId => 
            existingId.id === recordId 
              ? { ...existingId, timestamp: now }
              : existingId
          );
        }

        // Extract the metadata from mergedRecord to avoid conflicts
        const { metadata, ...mergedRecordWithoutMetadata } = mergedRecord;

        // Update the record using the People model
        await People.updateOne(
          { _id: bestMatch._id },
          {
            $set: {
              ...mergedRecordWithoutMetadata,
              archived: filteredRecord.archived || false, // Respect archived flag from source
              externalIds: existingExternalIds,
              'metadata.sourceId': sourceIdObject,
              'metadata.lastSourceType': sourceType,
              'metadata.updatedAt': now,
              'metadata.lastProcessedAt': now,
              // Add field-level source information
              'metadata.fieldMetadata': metadata.fieldMetadata || {},
              // Add archivedAt if the record is archived
              ...(filteredRecord.archived ? { 'metadata.archivedAt': now, 'metadata.archivedReason': 'person_removed_in_source' } : {})
            },
            $push: {
              'metadata.fieldHistory': {
                $each: fieldHistory
              }
            }
          }
        );
        
        // First set our own listener status to complete
        await People.updateOne(
          { _id: bestMatch._id },
          {
            $set: {
              [`metadata.listeners.${job.attrs.data.listenerId}.status`]: 'complete',
              [`metadata.listeners.${job.attrs.data.listenerId}.lastRun`]: now,
              [`metadata.listeners.${job.attrs.data.listenerId}.jobId`]: job.attrs.id
            }
          }
        );

        // Then get all listeners for this source from the airank database
        try {
          const airankUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
          const airankDb = await mongoose.createConnection(airankUri).asPromise();
          const listenersCollection = airankDb.collection('listeners');
          
          // Find all listeners for this source except the current one
          const otherListeners = await listenersCollection.find({
            'metadata.workspaceId': workspaceId,
            'metadata.sourceId': sourceId,
            _id: { $ne: new mongoose.Types.ObjectId(job.attrs.data.listenerId) }
          }).toArray();
          
          console.log(`consolidatePeople - Found ${otherListeners.length} other listeners to notify about changes`);
          
          // Clear all other listeners' metadata to trigger them
          if (otherListeners.length > 0) {
            console.log(`consolidatePeople - Clearing metadata for all other listeners to trigger downstream processing`);
            
            // Set the entire listeners object to null instead of individual unsets
            await People.updateOne(
              { _id: bestMatch._id },
              { 
                $set: { 
                  'metadata.listeners': null 
                }
              }
            );
            console.log(`consolidatePeople - Cleared metadata for ${otherListeners.length} other listeners to trigger downstream processing`);
          }
          
          await airankDb.close();
        } catch (error) {
          console.error('consolidatePeople - Error updating listeners metadata:', error);
          // Continue processing despite error
        }

        // Gather all external IDs for this person
        const externalIds = [];
        if (mergedRecord.externalIds) {
          // Extract all IDs from the externalIds object
          Object.values(mergedRecord.externalIds).forEach(idArr => {
            if (Array.isArray(idArr)) {
              idArr.forEach(idObj => {
                if (idObj && idObj.id) externalIds.push(idObj.id);
              });
            }
          });
        }
        // Also add the ID from incoming record
        if (record.externalId) externalIds.push(record.externalId);
        if (record.id) externalIds.push(record.id);

        // Call the update function
        await updateRelationshipsForPerson(mergedRecord, workspaceConnection, externalIds);
      } else {
        console.log('consolidatePeople - Creating new record');
        // Create new record using the People model
        const externalIdKey = getExternalIdKey(sourceType, sourceConfigsCache);
        
        // Get the ID dynamically based on the source config
        const recordId = getRecordId(record, sourceType, sourceConfigsCache);
        console.log(`consolidatePeople - Record ID for ${sourceType}: ${recordId}`);
        
        const newPersonData = {
          _id: new mongoose.Types.ObjectId(),
          ...filteredRecord,
          emailAddress: filteredRecord.emailAddress,
          firstName: filteredRecord.firstName,
          lastName: filteredRecord.lastName,
          phoneNumbers: filteredRecord.phoneNumbers || [],
          addresses: filteredRecord.addresses || [],
          socialProfiles: filteredRecord.socialProfiles || [],
          associations: filteredRecord.associations || [],
          externalIds: {
            [externalIdKey]: [{
              id: recordId,
              label: 'Contact ID',
              type: 'contact',
              timestamp: now
            }]
          },
          metadata: {
            sourceId: sourceIdObject,
            objectType: 'contacts',
            sourceType: sourceType,
            createdAt: now,
            updatedAt: now,
            lastProcessedAt: now,
            lastSourceType: sourceType,
            jobHistoryId: record.metadata.jobHistoryId,
            fieldHistory: Object.entries(filteredRecord).map(([field, value]) =>
              createFieldHistory(field, null, value, sourceType, now)
            ),
            // Add archivedAt if the record is archived
            ...(filteredRecord.archived ? { archivedAt: now, archivedReason: 'person_removed_in_source' } : {})
            // Explicitly don't add a listener field on new records
          },
          // Add archived flag if record is archived
          ...(filteredRecord.archived ? { archived: true } : { archived: false })
        };
        
        // Double-check one more time that there's no duplicate before inserting
        const finalCheck = filteredRecord.externalIds?.hubspot?.[0]?.id 
          ? await People.findOne({ 'externalIds.hubspot.id': filteredRecord.externalIds.hubspot[0].id }).exec()
          : null;
          
        if (finalCheck) {
          console.log(`consolidatePeople - FINAL CHECK: Found existing record in final check with ID ${finalCheck._id}, updating instead of creating`);
          
          // Update the existing record instead of creating a new one
          await People.updateOne(
            { _id: finalCheck._id },
            {
              $set: {
                ...newPersonData,
                _id: finalCheck._id, // Keep the original ID
                'metadata.updatedAt': now,
              }
            }
          );
          
          // Separate operation to unset listener
          await People.updateOne(
            { _id: finalCheck._id },
            {
              $unset: {
                [`metadata.listeners.${data.listenerId}`]: ""
              }
            }
          );
          
          console.log(`consolidatePeople - Updated existing record with ID ${finalCheck._id} instead of creating duplicate`);
          
          // Gather all external IDs for this person
          const externalIds = [];
          if (newPersonData.externalIds) {
            // Extract all IDs from the externalIds object
            Object.values(newPersonData.externalIds).forEach(idArr => {
              if (Array.isArray(idArr)) {
                idArr.forEach(idObj => {
                  if (idObj && idObj.id) externalIds.push(idObj.id);
                });
              }
            });
          }
          // Also add the ID from incoming record
          if (record.externalId) externalIds.push(record.externalId);
          if (record.id) externalIds.push(record.id);

          // Call the update function with the finalCheck record
          await updateRelationshipsForPerson(
            { _id: finalCheck._id, ...newPersonData }, 
            workspaceConnection, 
            externalIds
          );
        } else {
          // Proceed with creating the new record
          const newPerson = new People(newPersonData);
          await newPerson.save(); // Use model instance save()
          console.log('consolidatePeople - New record created with ID:', newPerson._id);
          
          // Gather all external IDs for this person
          const externalIds = [];
          if (newPersonData.externalIds) {
            // Extract all IDs from the externalIds object
            Object.values(newPersonData.externalIds).forEach(idArr => {
              if (Array.isArray(idArr)) {
                idArr.forEach(idObj => {
                  if (idObj && idObj.id) externalIds.push(idObj.id);
                });
              }
            });
          }
          // Also add the ID from incoming record
          if (record.externalId) externalIds.push(record.externalId);
          if (record.id) externalIds.push(record.id);

          // Call the update function
          await updateRelationshipsForPerson(newPerson, workspaceConnection, externalIds);
        }
      }

      // Update job history using the JobHistory model
      await JobHistory.create({ 
        _id: new mongoose.Types.ObjectId(),
        name: 'consolidatePeople',
        status: 'complete',
        startTime: jobStartTime,
        endTime: new Date(),
        data: {
          sourceId,
          sourceType,
          recordsProcessed: 1,
          matchConfidence: bestMatchConfidence,
          mergeMethod: mergeConfig.method,
          combineSourcesMethod: combineSourcesConfig.method
        }
      });

    } catch (error) {
      console.error('Error in consolidatePeople job:', error);
      // Log error to job history using JobHistory model
      if (workspaceConnection) {
          try {
              const JobHistory = workspaceConnection.model('JobHistory', JobHistorySchema); // Ensure model is defined
              await JobHistory.create({ 
                _id: new mongoose.Types.ObjectId(),
                name: 'consolidatePeople',
                status: 'failed',
                startTime: jobStartTime,
                endTime: new Date(),
                error: error.message,
                data: { sourceId, sourceType, workspaceId }
              });
          } catch (logError) { /* ... */ }
      }
      job.fail(error);
    } finally {
      if (workspaceConnection) {
        await workspaceConnection.close();
      }
      done();
    }
  }
}; 
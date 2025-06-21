const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs').promises;
// Import JobHistorySchema
const { JobHistorySchema } = require('../../data/models'); 
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
    case 'domain':
      return str1.toLowerCase() === str2.toLowerCase();
    case 'companyName':
      return str1.toLowerCase().trim() === str2.toLowerCase().trim();
    default:
      return str1 === str2;
  }
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
          console.log(`consolidateOrganizations - Found matching external ID for ${provider}, automatic merge with 100% confidence`);
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
      if (isFieldMatch(value1, value2, rule.field)) {
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
    console.warn('Record is undefined or not an object');
    return {};
  }

  if (!fieldMapping || typeof fieldMapping !== 'object') {
    console.warn('Field mapping is undefined or not an object');
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
      // Handle array mappings (for arrays of objects)
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
              // Handle static values
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
    console.error('Error transforming record:', error);
    return {};
  }

  return transformed;
};

// Helper to find duplicates based on workspace configuration
const findDuplicates = async (OrganizationsModel, transformedRecord, mergeConfig, consolidationConfig, sourceType, rules) => {
  const searchCriteria = [];
  
  // Get source-specific unique identifiers from consolidation config
  const sourceUniqueIds = consolidationConfig.sources[sourceType]?.uniqueIdentifiers || [];
  
  // Build criteria from configured rules
  for (const rule of rules) {
    // Only use identifiers that are allowed for this source
    if (sourceUniqueIds.includes(rule.field)) {
      const value = getFieldValue(transformedRecord, rule.field);
      
      if (value) {
        // Handle nested fields
        if (rule.field.includes('.')) {
          const [arrayField, valueField] = rule.field.split('.');
          const array = transformedRecord[arrayField];
          if (Array.isArray(array)) {
            array.forEach(item => {
              if (item[valueField]) {
                searchCriteria.push({ [`${arrayField}.${valueField}`]: item[valueField] });
              }
            });
          }
        } 
        // Handle externalIds special case
        else if (rule.field === 'externalIds') {
          Object.entries(value).forEach(([provider, ids]) => {
            ids.forEach(id => {
              searchCriteria.push({ [`externalIds.${provider}.id`]: id.id });
            });
          });
        }
        // Handle simple fields
        else {
          searchCriteria.push({ [rule.field]: value });
        }
      }
    }
  }

  if (searchCriteria.length === 0) {
    return [];
  }

  // Only match against non-archived records unless the incoming record is also archived
  const isArchived = transformedRecord.archived === true;
  const query = { 
    $or: searchCriteria,
    // Only include this condition for non-archived records
    ...(isArchived ? {} : { archived: { $ne: true } })
  };
  
  console.log('Searching for organizations with query keys:', Object.keys(query.$or[0]));
  console.log('consolidateOrganizations - Only matching non-archived records:', !isArchived);
  
  // Mongoose models use .exec() instead of .toArray()
  try {
    const results = await OrganizationsModel.find(query).exec();
    console.log(`Found ${results.length} matching organization records`);
    return results;
  } catch (err) {
    console.error('Error finding duplicate organizations:', err);
    return [];
  }
};

// Helper to merge records
const mergeRecords = (existing, incoming, sourceInfo, combineSources, consolidationConfig) => {
  const merged = { ...existing };
  const now = new Date();
  
  // Ensure sourceInfo is an object with both id and type
  const sourceData = typeof sourceInfo === 'object' 
    ? sourceInfo 
    : { sourceType: sourceInfo };
  
  // Initialize or get field metadata to track source and timestamp of each field
  merged.metadata = merged.metadata || {};
  merged.metadata.fieldMetadata = merged.metadata.fieldMetadata || {};
  
  // Update scalar fields based on source priority and field-level source information
  for (const [field, value] of Object.entries(incoming)) {
    if (field !== 'externalIds' && field !== 'metadata') {
      // Get field-level metadata for this specific field
      const fieldMetadata = {
        sourceId: merged.metadata?.fieldMetadata?.[field]?.sourceId,
        sourceType: merged.metadata?.fieldMetadata?.[field]?.sourceType
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
  
  // Merge externalIds
  if (incoming.externalIds) {
    merged.externalIds = merged.externalIds || {};
    for (const [provider, ids] of Object.entries(incoming.externalIds)) {
      merged.externalIds[provider] = [...(merged.externalIds[provider] || []), ...ids];
      // Update field metadata for this externalId provider
      merged.metadata.fieldMetadata[`externalIds.${provider}`] = {
        sourceId: sourceData.sourceId,
        sourceType: sourceData.sourceType,
        updatedAt: now
      };
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
  if (sourceConfig.objectTypeMapping?.organizations) {
    const mappedTypes = sourceConfig.objectTypeMapping.organizations;
    
    if (mappedTypes.includes(recordObjectType)) {
      console.log(`Found mapped object type ${recordObjectType} for organizations`);
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
 * Update any relationship documents that reference this organization
 * @param {Object} organization - The consolidated organization record
 * @param {Object} db - MongoDB connection
 * @param {Array} externalIds - Array of external IDs for this organization
 */
async function updateRelationshipsForOrganization(organization, db, externalIds) {
  try {
    if (!organization || !organization._id) {
      console.log('Cannot update relationships: Missing organization record or _id');
      return;
    }

    const organizationId = organization._id.toString();
    const Relationships = db.model('relationships', new mongoose.Schema({}, { strict: false }));
    
    console.log(`Looking for relationships that reference organization with ID: ${organizationId}`);
    console.log(`External IDs to check: ${JSON.stringify(externalIds)}`);
    
    // Build query to find any relationships that reference this organization
    const queries = [];
    
    // Add queries for MongoDB ObjectId (in case it was previously set correctly)
    if (mongoose.Types.ObjectId.isValid(organizationId)) {
      queries.push({ 'source.id': organizationId, 'source.type': 'organization' });
      queries.push({ 'target.id': organizationId, 'target.type': 'organization' });
    }
    
    // Add queries for each external ID
    for (const externalId of externalIds) {
      if (externalId) {
        // Convert externalId to string for consistent handling
        const externalIdStr = String(externalId);
        // Only search in externalId field, not in id field
        queries.push({ 'source.externalId': externalIdStr, 'source.type': 'organization' });
        queries.push({ 'target.externalId': externalIdStr, 'target.type': 'organization' });
      }
    }
    
    if (queries.length === 0) {
      console.log('No external IDs to search for relationships');
      return;
    }
    
    // Find all relationships that reference this organization
    const relationships = await Relationships.find({ $or: queries }).exec();
    console.log(`Found ${relationships.length} relationships referencing this organization`);
    
    // Get display name for the organization
    let displayName = '';
    if (organization.companyName) {
      displayName = organization.companyName;
    } else if (organization.domain) {
      displayName = organization.domain;
    }
    
    // Update each relationship
    let updateCount = 0;
    for (const relationship of relationships) {
      let updated = false;
      
      // Check and update source if it references this organization
      if (relationship.source.type === 'organization' && 
          externalIds.some(id => String(id) === String(relationship.source.externalId))) {
        // Keep the external ID as is, just ensure it's a string
        relationship.source.externalId = String(relationship.source.externalId);
        // Update id to MongoDB ObjectId
        relationship.source.id = organizationId;
        if (displayName) relationship.source.displayName = displayName;
        updated = true;
      }
      
      // Check and update target if it references this organization
      if (relationship.target.type === 'organization' && 
          externalIds.some(id => String(id) === String(relationship.target.externalId))) {
        // Keep the external ID as is, just ensure it's a string
        relationship.target.externalId = String(relationship.target.externalId);
        // Update id to MongoDB ObjectId
        relationship.target.id = organizationId;
        if (displayName) relationship.target.displayName = displayName;
        updated = true;
      }
      
      // Save the relationship if updated
      if (updated) {
        await relationship.save();
        updateCount++;
      }
    }
    
    console.log(`Updated ${updateCount} relationships with organization's MongoDB ObjectId`);
  } catch (error) {
    console.error('Error updating relationships for organization:', error);
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
      // Define Organizations model (inline schema based on expected fields)
      const OrgSchema = new mongoose.Schema({ /* ... fields based on commonFields in config.json ... */ }, { strict: false });
      const Organizations = workspaceConnection.model('organizations', OrgSchema);

      // Safely create ObjectId for sourceId
      let sourceIdObject;
      try {
        if (mongoose.Types.ObjectId.isValid(sourceId)) {
          sourceIdObject = new mongoose.Types.ObjectId(sourceId);
        } else {
          console.warn(`consolidateOrganizations - Invalid ObjectId for sourceId: ${sourceId}, using string as is`);
          sourceIdObject = sourceId;
        }
      } catch (objectIdError) {
        console.error(`consolidateOrganizations - Error creating ObjectId from ${sourceId}:`, objectIdError);
        sourceIdObject = sourceId;
      }

      // Get collections using workspaceConnection
      const consolidatedCollection = workspaceConnection.collection(`source_${sourceId}_consolidated`);
      console.log('consolidateOrganizations - Started processing record with ID:', objectId);
      
      // Try to find the record using different strategies
      let record = null;
      
      // First try MongoDB ObjectId
      if (mongoose.Types.ObjectId.isValid(objectId)) {
        try {
          record = await consolidatedCollection.findOne({ _id: new mongoose.Types.ObjectId(objectId) });
          if (record) {
            console.log('consolidateOrganizations - Found record by MongoDB ObjectId');
          }
        } catch (error) {
          console.error('consolidateOrganizations - Error finding by MongoDB ObjectId:', error);
        }
      }
      
      // If not found and we have externalRecordId, try that
      if (!record && externalRecordId) {
        try {
          record = await consolidatedCollection.findOne({ 'record.id': externalRecordId });
          if (record) {
            console.log('consolidateOrganizations - Found record by external ID');
          }
        } catch (error) {
          console.error('consolidateOrganizations - Error finding by external ID:', error);
        }
      }
      
      // If still not found, try the objectId as an external ID
      if (!record) {
        try {
          record = await consolidatedCollection.findOne({ 'record.id': objectId });
          if (record) {
            console.log('consolidateOrganizations - Found record by objectId as external ID');
          }
        } catch (error) {
          console.error('consolidateOrganizations - Error finding by objectId as external ID:', error);
        }
      }

      if (!record) {
        console.log('consolidateOrganizations - Skipping non-organization record');
        return;
      }

      // Get source config to check object type mapping
      const sourceTypeConfig = sourceConfigsCache[sourceType];
      if (!sourceTypeConfig) {
        throw new Error(`No source config found for source type: ${sourceType}`);
      }

      // Validate that we're only processing organizations based on objectTypeMapping
      const validObjectTypes = sourceTypeConfig.objectTypeMapping?.organizations || [];
      if (!validObjectTypes.includes(record.metadata.objectType)) {
        console.log('consolidateOrganizations - Skipping non-organization record');
        return;
      }

      // Get consolidation config
      const consolidationConfig = require('./config.json');
      const sourceConfig = consolidationConfig.sources[sourceType];
      
      if (!sourceConfig) {
        throw new Error(`No config found for source type: ${sourceType}`);
      }

      // Get workspace-specific configurations
      let [mergeConfig, combineSourcesConfig] = await Promise.all([
        workspaceConnection.collection('config').findOne({ configType: 'dataOrganizationsMergeIdentities' }),
        workspaceConnection.collection('config').findOne({ configType: 'dataOrganizationsCombineSources' })
      ]);

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
        mergeConfig = defaultMergeConfig;
      }

      if (!combineSourcesConfig) {
        combineSourcesConfig = defaultCombineSourcesConfig;
      }

      // Get object config and transform record
      const objectConfig = getObjectConfigForSourceType(sourceConfigsCache, sourceType, record);
      console.log('Transforming organization record');
      
      // IMPORTANT FIX: Pass record.record directly
      const transformedRecord = objectConfig?.organizationsMapping 
        ? transformRecord(record.record, objectConfig.organizationsMapping)
        : {};

      // Validate transformed record only contains approved fields
      const approvedFields = Object.keys(consolidationConfig.commonFields);
      const filteredRecord = {};
      for (const [key, value] of Object.entries(transformedRecord)) {
        if (approvedFields.includes(key)) {
          filteredRecord[key] = value;
        }
      }

      // Check if the record is archived in the source
      if (record.record.archived === true) {
        console.log('consolidateOrganizations - Processing archived record');
        
        // For archived records, set the archived flag in the transformed record
        filteredRecord.archived = true;
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

      // Find duplicates using the Organizations model
      console.log('Searching for duplicate organizations');
      const duplicates = await findDuplicates(
        Organizations,
        filteredRecord,
        mergeConfig || defaultMergeConfig,
        consolidationConfig,
        sourceType,
        rules
      );
      console.log('consolidateOrganizations - Found potential matches:', duplicates.length);

      // Find best matching record if multiple matches exist
      let bestMatch = null;
      let bestMatchConfidence = 0;

      for (const duplicate of duplicates) {
        const confidence = calculateMatchConfidence(
          filteredRecord,
          duplicate,
          rules
        );

        if (confidence > bestMatchConfidence && 
            confidence >= consolidationConfig.mergeRules.confidenceThreshold) {
          bestMatchConfidence = confidence;
          bestMatch = duplicate;
        }
      }

      const now = new Date();
      let fieldHistory = [];

      if (bestMatch) {
        console.log('consolidateOrganizations - Merging with existing organization record');
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
        console.log('Updated existing organization record with ID:', bestMatch._id);

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

        // Extract the metadata from mergedRecord to avoid conflicts
        const { metadata, ...mergedRecordWithoutMetadata } = mergedRecord;

        // Update existing externalIds or create new ones
        const existingExternalIds = bestMatch.externalIds || {};
        // Get external ID key from source config
        const externalIdKey = getExternalIdKey(sourceType, sourceConfigsCache);

        // Get the ID dynamically based on the source config
        const recordId = getRecordId(record, sourceType, sourceConfigsCache);

        // Append to existing external IDs instead of overwriting
        const newExternalId = {
          id: recordId,
          label: 'Company ID',
          type: 'company',
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

        // Update the record
        await Organizations.updateOne(
          { _id: bestMatch._id },
          { 
            $set: {
              ...mergedRecordWithoutMetadata,
              archived: filteredRecord.archived || false, // Respect archived flag
              externalIds: existingExternalIds,
              'metadata.sourceId': sourceIdObject,
              'metadata.lastSourceType': sourceType,
              'metadata.updatedAt': now,
              'metadata.lastProcessedAt': now,
              // Add field-level source information
              'metadata.fieldMetadata': metadata.fieldMetadata || {},
              // Add archivedAt if the record is archived
              ...(filteredRecord.archived ? { 'metadata.archivedAt': now, 'metadata.archivedReason': 'organization_removed_in_source' } : {})
            },
            $push: {
              'metadata.fieldHistory': {
                $each: fieldHistory
              }
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
          
          console.log(`consolidateOrganizations - Found ${otherListeners.length} other listeners to notify about changes`);
          
          await airankDb.close();
        } catch (error) {
          console.error('consolidateOrganizations - Error updating listeners metadata:', error);
          // Continue processing despite error
        }

        // Gather all external IDs for this organization
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
        await updateRelationshipsForOrganization(mergedRecord, workspaceConnection, externalIds);
      } else {
        console.log('Creating new organization record');
        // Create new record using the Organizations model
        const externalIdKey = getExternalIdKey(sourceType, sourceConfigsCache);

        // Get the ID dynamically based on the source config
        const recordId = getRecordId(record, sourceType, sourceConfigsCache);
        console.log(`consolidateOrganizations - Record ID for ${sourceType}: ${recordId}`);

        const newOrgData = {
          _id: new mongoose.Types.ObjectId(),
          ...filteredRecord,
          companyName: filteredRecord.companyName,
          website: filteredRecord.website,
          domain: filteredRecord.domain,
          phoneNumbers: filteredRecord.phoneNumbers || [],
          addresses: filteredRecord.addresses || [],
          externalIds: {
            [externalIdKey]: [{
              id: recordId,
              label: 'Company ID',
              type: 'company',
              timestamp: now
            }]
          },
          metadata: {
            sourceId: sourceIdObject,
            objectType: 'companies',
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
            ...(filteredRecord.archived ? { archivedAt: now, archivedReason: 'organization_removed_in_source' } : {})
          }
        };
        const newOrganization = new Organizations(newOrgData);
        await newOrganization.save();
        console.log('Created new record in organizations collection:', newOrganization._id);

        // Gather all external IDs for this organization
        const externalIds = [];
        if (newOrgData.externalIds) {
          // Extract all IDs from the externalIds object
          Object.values(newOrgData.externalIds).forEach(idArr => {
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
        await updateRelationshipsForOrganization(newOrganization, workspaceConnection, externalIds);
      }

      // Update job history using the JobHistory model
      await JobHistory.create({
        _id: new mongoose.Types.ObjectId(),
        name: 'consolidateOrganizations',
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

      // Create indices with proper error handling
      try {
        await createIndexesForSource(Organizations.collection, sourceType, sourceConfigsCache);
      } catch (indexError) {
        console.error('consolidateOrganizations - Error creating indices:', indexError.message);
        // Continue processing despite index error - don't crash the job
      }

    } catch (error) {
      console.error('Error in consolidateOrganizations job:', error);
      
      if (workspaceConnection) {
        try {
          const JobHistory = workspaceConnection.model('JobHistory', JobHistorySchema);
          await JobHistory.create({
            _id: new mongoose.Types.ObjectId(),
            name: 'consolidateOrganizations',
            status: 'failed',
            startTime: jobStartTime,
            endTime: new Date(),
            error: error.message,
            data: { sourceId, sourceType, workspaceId }
          });
        } catch (logError) {
          console.error('Error logging job history:', logError);
        }
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
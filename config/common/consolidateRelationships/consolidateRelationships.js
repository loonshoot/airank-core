const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs').promises;
// Import JobHistorySchema
const { JobHistorySchema } = require('../../data/models'); 
require('dotenv').config(); // Load environment variables from .env

// Function to load all source configs (reused from consolidateRecord)
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

// Helper to get field value from a path string
const getFieldValue = (obj, path) => {
  return path.split('.').reduce((curr, key) => curr && curr[key], obj);
};

// Helper to calculate match confidence between two records
const calculateMatchConfidence = (record1, record2, rules) => {
  let matchCount = 0;
  let totalCriteria = 0;

  for (const rule of rules) {
    const value1 = getFieldValue(record1, rule.field);
    const value2 = getFieldValue(record2, rule.field);
    
    if (value1 && value2) {
      totalCriteria++;
      if (isFieldMatch(value1, value2, rule.field)) {
        matchCount++;
      }
    }
  }

  return totalCriteria > 0 ? matchCount / totalCriteria : 0;
};

// Helper to check if two values should be considered a match
const isFieldMatch = (value1, value2, field) => {
  if (!value1 || !value2) return false;
  
  // Handle different field types
  if (field === 'externalIds') {
    // For external IDs, check if any ID matches
    if (typeof value1 === 'object' && typeof value2 === 'object') {
      for (const [source, ids1] of Object.entries(value1)) {
        const ids2 = value2[source];
        if (ids2 && Array.isArray(ids1) && Array.isArray(ids2)) {
          for (const id1 of ids1) {
            for (const id2 of ids2) {
              if (id1.id === id2.id) {
                return true;
              }
            }
          }
        }
      }
    }
    return false;
  } else if (field.includes('source.') || field.includes('target.')) {
    // For entity references, direct compare is fine
    return value1 === value2;
  }
  
  // Default comparison
  return value1 === value2;
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

// Helper to find duplicates based on configuration
const findDuplicates = async (RelationshipsModel, transformedRecord, mergeConfig, consolidationConfig, sourceType, rules) => {
  const searchCriteria = [];
  
  console.log('Using merge rules:', rules.map(r => `${r.field} ${r.operator}`));
  
  // Get source-specific unique identifiers from consolidation config
  const sourceUniqueIds = consolidationConfig.sources[sourceType]?.uniqueIdentifiers || [];
  
  // Build criteria from configured rules
  for (const rule of rules) {
    // Only use identifiers that are allowed for this source
    if (sourceUniqueIds.includes(rule.field)) {
      const value = getFieldValue(transformedRecord, rule.field);
      
      if (value) {
        // Handle externalIds special case
        if (rule.field === 'externalIds') {
          if (typeof value === 'object') {
            Object.entries(value).forEach(([provider, ids]) => {
              if (Array.isArray(ids)) {
                ids.forEach(id => {
                  if (id && id.id) {
                    searchCriteria.push({ [`externalIds.${provider}.id`]: id.id });
                  }
                });
              } else if (ids && ids.id) {
                // Handle case where ids is a single object
                searchCriteria.push({ [`externalIds.${provider}.id`]: ids.id });
              }
            });
          }
        }
        // Handle source/target entity references
        else if (rule.field === 'source.id' || rule.field === 'target.id') {
          searchCriteria.push({ [rule.field]: value });
          
          // Also search by externalId which might be used in different formats
          if (rule.field === 'source.id' && transformedRecord.source.externalId) {
            searchCriteria.push({ 'source.externalId': transformedRecord.source.externalId });
          }
          if (rule.field === 'target.id' && transformedRecord.target.externalId) {
            searchCriteria.push({ 'target.externalId': transformedRecord.target.externalId });
          }
        }
        // Handle simple fields
        else {
          searchCriteria.push({ [rule.field]: value });
        }
      }
    }
  }

  if (searchCriteria.length === 0) {
    console.log('No search criteria could be built from the record and rules');
    return [];
  }

  const query = { $or: searchCriteria };
  console.log('Searching for relationships with query criteria:', Object.keys(query.$or[0]).join(', '));
  
  // Mongoose models use .exec() instead of .toArray()
  try {
    const results = await RelationshipsModel.find(query).exec();
    console.log(`Found ${results.length} potential duplicate relationships`);
    return results;
  } catch (err) {
    console.error('Error finding duplicate relationships:', err);
    return [];
  }
};

// Helper to canonicalize a relationship
function canonicalizeRelationship(relationshipData, sourceId, sourceType) {
  // Handle Zoho activity records that need transformation (Notes, Tasks, etc.)
  if (sourceType === 'zohocrm' && relationshipData.record && !relationshipData.source && !relationshipData.target) {
    console.log('Transforming Zoho activity record to relationship format');
    return transformZohoToRelationship(relationshipData, sourceId, sourceType);
  }
  
  // Handle synthetic Zoho relationships that are already in correct format
  if (sourceType === 'zohocrm' && relationshipData.source && relationshipData.target) {
    console.log('Processing synthetic Zoho relationship');
    // Synthetic relationships are already in the correct format, just standardize the relationship type
  }
  
  // Determine standardized relationship type based on source and target types
  let relationshipType = relationshipData.type || relationshipData.relationshipType;
  const originalRelationshipType = relationshipType; // Store original for metadata
  
  // Standardize the relationship type based on source and target types
  const sourceEntityType = relationshipData.source?.type || '';
  const targetEntityType = relationshipData.target?.type || '';
  
  if (sourceEntityType === 'person' && targetEntityType === 'organization') {
    relationshipType = 'people_to_organization';
  } else if (sourceEntityType === 'organization' && targetEntityType === 'person') {
    relationshipType = 'organization_to_people';
  } else if (sourceEntityType === 'person' && targetEntityType === 'person') {
    relationshipType = 'people_to_people';
  }
  
  console.log(`Canonicalizing relationship: ${originalRelationshipType} → ${relationshipType}`);
  
  // Handle source
  const source = {
    type: sourceEntityType,
    // Only use externalId, leave id empty until enrichment
    externalId: relationshipData.source?.externalId || relationshipData.source?.id || '',
    id: '', // Leave empty until enrichment finds the MongoDB ObjectId
    displayName: relationshipData.source?.displayName || ''
  };
  
  // Handle target
  const target = {
    type: targetEntityType,
    // Only use externalId, leave id empty until enrichment
    externalId: relationshipData.target?.externalId || relationshipData.target?.id || '',
    id: '', // Leave empty until enrichment finds the MongoDB ObjectId
    displayName: relationshipData.target?.displayName || ''
  };
  
  // Build metadata with original relationship type
  const metadata = {
    ...relationshipData.metadata || {},
    originalRelationshipType
  };
  
  // Simplify external IDs
  const externalIds = simplifyExternalIds(relationshipData.externalIds || {});
  
  // Build the canonical relationship
  const record = {
    source,
    target,
    relationshipType,
    metadata,
    externalIds
  };
  
  console.log('Canonicalized relationship:', JSON.stringify(record));
  return record;
}

// Helper function to transform Zoho records to relationship format
function transformZohoToRelationship(zohoRecord, sourceId, sourceType) {
  const record = zohoRecord.record;
  const objectType = zohoRecord.objectType;
  
  // Determine relationship type based on the Zoho object type
  const relationshipTypeMapping = {
    'Notes': 'has_note',
    'Tasks': 'has_task', 
    'Events': 'has_event',
    'Calls': 'has_call',
    'Attachments': 'has_attachment',
    'Contacts_Related': 'related_to',
    'Deals_Related': 'related_to'
  };
  
  const relationshipType = relationshipTypeMapping[objectType] || 'related_to';
  
  // Extract source and target from Zoho fields
  let source = null;
  let target = null;
  
  if (record.What_Id) {
    // What_Id is typically the target entity (Account, Deal, etc.)
    target = {
      type: 'organization', // Default, will be refined during enrichment
      externalId: record.What_Id.id,
      id: '',
      displayName: record.What_Id.name || ''
    };
  }
  
  if (record.Who_Id) {
    // Who_Id is typically the source entity (Contact, Lead, etc.)
    source = {
      type: 'person', // Default, will be refined during enrichment
      externalId: record.Who_Id.id,
      id: '',
      displayName: record.Who_Id.name || ''
    };
  }
  
  // If we only have one entity, create a self-referential relationship
  if (!source && target) {
    source = target;
  } else if (source && !target) {
    target = source;
  }
  
  // Fallback if neither exists - shouldn't happen but handle gracefully
  if (!source && !target) {
    console.warn('Zoho record has no What_Id or Who_Id, creating empty relationship');
    source = { type: 'unknown', externalId: '', id: '', displayName: '' };
    target = { type: 'unknown', externalId: '', id: '', displayName: '' };
  }
  
  // Build attributes from the record
  const attributes = {};
  for (const [key, value] of Object.entries(record)) {
    if (!['What_Id', 'Who_Id', 'id'].includes(key)) {
      attributes[key] = value;
    }
  }
  
  const transformed = {
    source,
    target,
    relationshipType,
    attributes,
    metadata: {
      originalRelationshipType: objectType,
      sourceType: sourceType,
      sourceId: sourceId
    },
    externalIds: {
      [sourceType]: zohoRecord.externalId
    }
  };
  
  console.log(`Transformed Zoho ${objectType} to relationship:`, JSON.stringify(transformed));
  return transformed;
}

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
    if (field !== 'externalIds' && field !== 'metadata' && field !== 'associationTypes' && field !== 'attributes') {
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
  
  // Special handling for associationTypes - keep a complete set
  if (incoming.associationTypes) {
    if (!merged.associationTypes) {
      merged.associationTypes = [];
    }
    
    // Add any new association types
    incoming.associationTypes.forEach(incomingType => {
      const exists = merged.associationTypes.some(existingType => 
        existingType.typeId === incomingType.typeId && 
        existingType.category === incomingType.category
      );
      
      if (!exists) {
        merged.associationTypes.push(incomingType);
      }
    });
    
    // Update field metadata for associationTypes
    merged.metadata.fieldMetadata['associationTypes'] = {
      sourceId: sourceData.sourceId,
      sourceType: sourceData.sourceType,
      updatedAt: now
    };
  }
  
  // Merge attributes - take the ones from the higher priority source
  if (incoming.attributes) {
    if (!merged.attributes) {
      merged.attributes = {};
    }
    
    for (const [key, value] of Object.entries(incoming.attributes)) {
      // Get field-level metadata for this specific attribute
      const fieldMetadata = {
        sourceId: merged.metadata?.fieldMetadata?.[`attributes.${key}`]?.sourceId,
        sourceType: merged.metadata?.fieldMetadata?.[`attributes.${key}`]?.sourceType
      };
      
      if (shouldUpdateField(`attributes.${key}`, existing.metadata?.lastSourceType, sourceData, consolidationConfig.sources, combineSources, fieldMetadata)) {
        merged.attributes[key] = value;
        
        // Update field metadata for this attribute
        merged.metadata.fieldMetadata[`attributes.${key}`] = {
          sourceId: sourceData.sourceId,
          sourceType: sourceData.sourceType,
          updatedAt: now
        };
      }
    }
  }
  
  // Merge externalIds if present
  if (incoming.externalIds) {
    merged.externalIds = merged.externalIds || {};
    for (const [provider, ids] of Object.entries(incoming.externalIds)) {
      if (!merged.externalIds[provider]) {
        merged.externalIds[provider] = [];
      }
      
      // Add any new IDs
      ids.forEach(incomingId => {
        const exists = merged.externalIds[provider].some(existingId => 
          existingId.id === incomingId.id
        );
        
        if (!exists) {
          merged.externalIds[provider].push(incomingId);
        }
      });
      
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
  if (sourceConfig.objectTypeMapping?.relationship) {
    const mappedTypes = sourceConfig.objectTypeMapping.relationship;
    
    if (mappedTypes.includes(recordObjectType)) {
      console.log(`Found mapped object type ${recordObjectType} for relationships`);
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

// Add this function before the job definition
/**
 * Checks if a relationship is supported based on config
 * @param {Object} relationship - The relationship object
 * @param {Object} config - The consolidation config
 * @returns {boolean} True if supported, false otherwise
 */
function isRelationshipSupported(relationship, config) {
  if (!relationship || !relationship.source || !relationship.target || !relationship.relationshipType) {
    console.log('Relationship missing required fields');
    return false;
  }

  const sourceType = relationship.source.type;
  const targetType = relationship.target.type;
  let relType = relationship.relationshipType;

  // Normalize relationship type if needed
  if (sourceType === 'person' && targetType === 'person') {
    relType = 'people_to_people';
  } else if (sourceType === 'person' && targetType === 'organization') {
    relType = 'people_to_organization';
  } else if (sourceType === 'organization' && targetType === 'person') {
    relType = 'organization_to_people';
  }

  // Check if this relationship type is in our supported types
  const supportedTypes = config.supportedRelationshipTypes || {};
  const supportedRelType = supportedTypes[relType];

  if (!supportedRelType) {
    console.log(`Relationship type "${relType}" is not supported`);
    return false;
  }

  // Check if the source and target types match what's allowed for this relationship type
  if (supportedRelType.sourceType !== sourceType || supportedRelType.targetType !== targetType) {
    console.log(`Relationship type "${relType}" requires source type "${supportedRelType.sourceType}" and target type "${supportedRelType.targetType}", but got "${sourceType}" and "${targetType}"`);
    return false;
  }

  return true;
}

// Add this function before the job definition
/**
 * Creates an inverse relationship based on the original
 * @param {Object} relationship - The original relationship
 * @param {Object} config - The consolidation config
 * @returns {Object|null} The inverse relationship or null if not applicable
 */
function createInverseRelationship(relationship, config) {
  if (!relationship || !relationship.source || !relationship.target || !relationship.relationshipType) {
    return null;
  }

  const sourceType = relationship.source.type;
  const targetType = relationship.target.type;
  let relType = relationship.relationshipType;
  
  // Normalize the relationship type if needed
  if (sourceType === 'person' && targetType === 'person') {
    relType = 'people_to_people';
  } else if (sourceType === 'person' && targetType === 'organization') {
    relType = 'people_to_organization';
  } else if (sourceType === 'organization' && targetType === 'person') {
    relType = 'organization_to_people';
  }

  const supportedTypes = config.supportedRelationshipTypes || {};
  const supportedRelType = supportedTypes[relType];

  if (!supportedRelType || !supportedRelType.bidirectional) {
    // This relationship type doesn't support bidirectional relationships
    return null;
  }

  // Determine the inverse relationship type
  let inverseRelType = supportedRelType.inverseName || relType;
  
  // Create the inverse relationship
  const inverse = {
    ...relationship,
    source: { ...relationship.target },
    target: { ...relationship.source },
    relationshipType: inverseRelType,
    metadata: {
      ...(relationship.metadata || {}),
      nativeRelationshipType: relationship.metadata?.nativeRelationshipType || relType
    }
  };

  return inverse;
}

module.exports = {
  job: async (job, done) => {
    const { sourceId, sourceType, workspaceId, objectId, externalRecordId } = job.attrs.data;
    const jobStartTime = new Date();
    let workspaceConnection;
    let JobHistory; // Define JobHistory variable at the job function scope

    console.log('consolidateRelationships job started with data:', {
      sourceId: sourceId,
      sourceType: sourceType,
      workspaceId: workspaceId,
      objectId: objectId,
      externalRecordId: externalRecordId,
      time: jobStartTime
    });

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
        console.log('Loading source configs...');
        sourceConfigsCache = await loadSourceConfigs();
        console.log('Source configs loaded successfully');
      }
      
      const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
      console.log('Connecting to MongoDB at URI:', dataLakeUri);
      workspaceConnection = await mongoose.createConnection(dataLakeUri).asPromise();
      console.log('Connected to MongoDB successfully');

      // Define models on the workspace connection
      JobHistory = workspaceConnection.model('JobHistory', JobHistorySchema);
      // Define Relationships model (inline schema based on expected fields)
      const RelationshipSchema = new mongoose.Schema({ /* ... fields based on commonFields in config.json ... */ }, { strict: false });
      const Relationships = workspaceConnection.model('relationships', RelationshipSchema);

      // Get a list of all collections in the workspace
      const collections = await workspaceConnection.db.listCollections().toArray();
      const collectionNames = collections.map(col => col.name);
      console.log('Available collections:', collectionNames.join(', '));
      
      // Create collection if it doesn't exist
      if (!collectionNames.includes('relationships')) {
        await workspaceConnection.createCollection('relationships');
        console.log('Created relationships collection');
      }

      // Create indices with proper error handling
      try {
        await createIndexesForSource(Relationships.collection, sourceType, sourceConfigsCache);
      } catch (indexError) {
        console.error('consolidateRelationships - Error creating indices:', indexError.message);
        // Continue processing despite index error - don't crash the job
      }

      // Safely create ObjectId for sourceId
      let sourceIdObject;
      try {
        if (mongoose.Types.ObjectId.isValid(sourceId)) {
          sourceIdObject = new mongoose.Types.ObjectId(sourceId);
        } else {
          console.warn(`consolidateRelationships - Invalid ObjectId for sourceId: ${sourceId}, using string as is`);
          sourceIdObject = sourceId;
        }
      } catch (objectIdError) {
        console.error(`consolidateRelationships - Error creating ObjectId from ${sourceId}:`, objectIdError);
        sourceIdObject = sourceId;
      }

      // Get the CONSOLIDATED collection using workspaceConnection
      const consolidatedCollection = workspaceConnection.collection(`source_${sourceId}_consolidated`);
      
      console.log('consolidateRelationships - Looking for record with objectId:', objectId);
      
      // Try to find the record using different strategies
      let record = null;
      
      // First try MongoDB ObjectId
      if (mongoose.Types.ObjectId.isValid(objectId)) {
        try {
          // For Zoho, also search relationship object types (Tasks, Notes, Events, etc.)
          const relationshipQuery = sourceType === 'zohocrm' 
            ? { 
                _id: new mongoose.Types.ObjectId(objectId),
                $or: [
                  { 'metadata.objectType': 'relationship' },
                  { objectType: { $in: ['Notes', 'Tasks', 'Events', 'Calls', 'Attachments', 'Contacts_Related', 'Deals_Related'] } }
                ]
              }
            : { 
                _id: new mongoose.Types.ObjectId(objectId),
                'metadata.objectType': 'relationship'
              };
              
          record = await consolidatedCollection.findOne(relationshipQuery);
          if (record) {
            console.log('consolidateRelationships - Found record by MongoDB ObjectId');
          }
        } catch (error) {
          console.error('consolidateRelationships - Error finding by MongoDB ObjectId:', error);
        }
      }
      
      // If not found and we have externalRecordId, try that
      if (!record && externalRecordId) {
        try {
          const relationshipQuery = sourceType === 'zohocrm' 
            ? { 
                'record.id': externalRecordId,
                $or: [
                  { 'metadata.objectType': 'relationship' },
                  { objectType: { $in: ['Notes', 'Tasks', 'Events', 'Calls', 'Attachments', 'Contacts_Related', 'Deals_Related'] } }
                ]
              }
            : { 
                'record.id': externalRecordId,
                'metadata.objectType': 'relationship'
              };
              
          record = await consolidatedCollection.findOne(relationshipQuery);
          if (record) {
            console.log('consolidateRelationships - Found record by external ID');
          }
        } catch (error) {
          console.error('consolidateRelationships - Error finding by external ID:', error);
        }
      }
      
      // If still not found, try the objectId as an external ID
      if (!record) {
        try {
          const relationshipQuery = sourceType === 'zohocrm' 
            ? { 
                'record.id': objectId,
                $or: [
                  { 'metadata.objectType': 'relationship' },
                  { objectType: { $in: ['Notes', 'Tasks', 'Events', 'Calls', 'Attachments', 'Contacts_Related', 'Deals_Related'] } }
                ]
              }
            : { 
                'record.id': objectId,
                'metadata.objectType': 'relationship'
              };
              
          record = await consolidatedCollection.findOne(relationshipQuery);
          if (record) {
            console.log('consolidateRelationships - Found record by objectId as external ID');
          }
        } catch (error) {
          console.error('consolidateRelationships - Error finding by objectId as external ID:', error);
        }
      }
      
      // Last resort: try finding by externalId field directly
      if (!record) {
        try {
          const relationshipQuery = sourceType === 'zohocrm' 
            ? { 
                externalId: objectId,
                $or: [
                  { 'metadata.objectType': 'relationship' },
                  { objectType: { $in: ['Notes', 'Tasks', 'Events', 'Calls', 'Attachments', 'Contacts_Related', 'Deals_Related'] } }
                ]
              }
            : { 
                externalId: objectId,
                'metadata.objectType': 'relationship'
              };
              
          record = await consolidatedCollection.findOne(relationshipQuery);
          if (record) {
            console.log('consolidateRelationships - Found record by externalId field');
          }
        } catch (error) {
          console.error('consolidateRelationships - Error finding by externalId field:', error);
        }
      }
      
      if (!record) {
        console.error(`Relationship record not found in CONSOLIDATED collection using any available identifier`);
        throw new Error(`Relationship record not found in CONSOLIDATED collection`);
      }

      console.log('consolidateRelationships - Found record:', {
        id: record.id,
        relationshipType: record.relationshipType,
        source: { type: record.source?.type, id: record.source?.id },
        target: { type: record.target?.type, id: record.target?.id }
      });

      // Perform basic validation of the record structure
      // For Zoho records, the relationship structure is different - they need to be transformed OR they might be synthetic
      if (sourceType === 'zohocrm' && 
          (['Notes', 'Tasks', 'Events', 'Calls', 'Attachments', 'Contacts_Related', 'Deals_Related'].includes(record.objectType) ||
           ['ContactOrganizationRelationship', 'ContactContactRelationship', 'OrganizationOrganizationRelationship', 'OrganizationContactRelationship'].includes(record.objectType))) {
        // Zoho relationship records (activity-based or synthetic) are valid - they will be transformed later if needed
        console.log('consolidateRelationships - Zoho relationship record found (activity-based or synthetic), will process');
      } else if (!record.record || !record.record.source || !record.record.target) {
        console.error('Relationship record is missing required structure');
        console.log('Record structure:', JSON.stringify(record, null, 2));
        throw new Error('Invalid relationship record structure');
      }

      // Get consolidation config
      const consolidationConfig = require('./config.json');
      const sourceConfig = consolidationConfig.sources[sourceType];
      
      if (!sourceConfig) {
        throw new Error(`No config found for source type: ${sourceType}`);
      }

      // Get workspace-specific configurations
      console.log('Fetching workspace configurations...');
      let mergeConfig, combineSourcesConfig;
      
      try {
        [mergeConfig, combineSourcesConfig] = await Promise.all([
          workspaceConnection.collection('config').findOne({ configType: 'dataRelationshipsMergeIdentities' }),
          workspaceConnection.collection('config').findOne({ configType: 'dataRelationshipsCombineSources' })
        ]);
      } catch (configError) {
        console.error('Error fetching workspace configurations:', configError.message);
        // Continue with defaults
      }
      
      console.log('consolidateRelationships - Workspace configurations loaded');

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
        console.log('consolidateRelationships - Using default merge config');
        mergeConfig = defaultMergeConfig;
      }

      if (!combineSourcesConfig) {
        console.log('consolidateRelationships - Using default combine sources config');
        combineSourcesConfig = defaultCombineSourcesConfig;
      }

      // Check if the record is archived
      if (record.record.archived === true) {
        console.log('consolidateRelationships - Processing archived relationship');
      }

      // Get object config based on actual record type
      const objectConfig = getObjectConfigForSourceType(sourceConfigsCache, sourceType, record);
      console.log('Relationship object config loaded:', objectConfig ? 'success' : 'not found');

      // If we have an object config, use its mapping for the record
      if (objectConfig && objectConfig.relationshipMapping) {
        console.log('Using relationship mapping from config');
        // The relationship data is already in record.record, we'll use that with the canonicalization
      }

      // Canonicalize the relationship (ensure consistent direction)
      // For Zoho activity records, pass the full record structure; for synthetic relationships and others, pass just the record.record
      const relationshipData = (sourceType === 'zohocrm' && ['Notes', 'Tasks', 'Events', 'Calls', 'Attachments', 'Contacts_Related', 'Deals_Related'].includes(record.objectType)) 
        ? record 
        : record.record;
      const canonicalized = canonicalizeRelationship(relationshipData, sourceId, sourceType);
      console.log('consolidateRelationships - Canonicalization complete');
      
      // Check if this relationship type is supported
      if (!isRelationshipSupported(canonicalized, consolidationConfig)) {
        console.log(`Skipping unsupported relationship: ${canonicalized.relationshipType} between ${canonicalized.source.type} and ${canonicalized.target.type}`);
        
        // Update job history to mark as complete (skipped)
        try {
          await JobHistory.create({
            _id: new mongoose.Types.ObjectId(),
            name: 'consolidateRelationships',
            status: 'complete',
            startTime: jobStartTime,
            endTime: new Date(),
            data: {
              sourceId,
              sourceType,
              recordsProcessed: 0,
              skipped: true,
              reason: 'Unsupported relationship type'
            }
          });
        } catch (historyError) {
          console.error('Error updating job history:', historyError.message);
        }
        
        // Close the connection and finish the job
        if (workspaceConnection) {
          await workspaceConnection.close();
        }
        
        console.log('Skipping unsupported relationship - job complete');
        done();
        return; // Exit early without processing this relationship
      }
      
      // Use the canonicalized record for matching and merging
      const filteredRecord = canonicalized;
      
      // Augment the record with more details from the referenced entities
      // This is important for better display in the UI and linking entities
      await enrichRelationship(filteredRecord, workspaceConnection, sourceId, sourceType);

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

      // Find duplicates
      console.log('Finding duplicate relationships...');
      let duplicates = [];
      try {
        duplicates = await findDuplicates(
          Relationships,
          filteredRecord,
          mergeConfig || defaultMergeConfig,
          consolidationConfig,
          sourceType,
          rules
        );
      } catch (duplicateError) {
        console.error('Error finding duplicates:', duplicateError.message);
        // Continue with empty duplicates array
      }
      console.log('consolidateRelationships - Found potential matches');

      // Find best matching record if multiple matches exist
      let bestMatch = null;
      let bestMatchConfidence = 0;

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

      const now = new Date();
      let fieldHistory = [];

      if (bestMatch) {
        console.log('consolidateRelationships - Merging with existing relationship');
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
        console.log('Updated existing relationship record');

        // Ensure externalIds are preserved for source and target
        if (mergedRecord.source && mergedRecord.source.id) {
          // When updating an existing record, make sure we preserve or set the external ID
          if (!mergedRecord.source.externalId) {
            // If externalId doesn't exist in the merged record, use either:
            if (filteredRecord.source.externalId) {
              // 1. The externalId from the incoming record
              mergedRecord.source.externalId = filteredRecord.source.externalId;
            } else if (bestMatch.source && bestMatch.source.externalId) {
              // 2. The externalId from the existing record
              mergedRecord.source.externalId = bestMatch.source.externalId;
            } else {
              // 3. The original ID as fallback (before it got replaced with ObjectId)
              mergedRecord.source.externalId = filteredRecord.source.id;
            }
            console.log(`Set source.externalId to ${mergedRecord.source.externalId}`);
          }
        }

        if (mergedRecord.target && mergedRecord.target.id) {
          // Similar logic for target entity
          if (!mergedRecord.target.externalId) {
            if (filteredRecord.target.externalId) {
              mergedRecord.target.externalId = filteredRecord.target.externalId;
            } else if (bestMatch.target && bestMatch.target.externalId) {
              mergedRecord.target.externalId = bestMatch.target.externalId;
            } else {
              mergedRecord.target.externalId = filteredRecord.target.id;
            }
            console.log(`Set target.externalId to ${mergedRecord.target.externalId}`);
          }
        }

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
        
        // Get the ID dynamically based on the source config
        const recordId = getRecordId(record, sourceType, sourceConfigsCache);

        existingExternalIds[sourceType] = [{
          id: recordId,
          label: 'Relationship ID',
          type: 'relationship',
          timestamp: now
        }];

        // Update the record
        try {
          await Relationships.updateOne(
            { _id: bestMatch._id },
            { 
              $set: {
                ...mergedRecordWithoutMetadata,
                archived: filteredRecord.archived || false,
                externalIds: simplifyExternalIds(existingExternalIds),
                'metadata.sourceId': sourceIdObject,
                'metadata.lastSourceType': sourceType,
                'metadata.updatedAt': now,
                'metadata.lastProcessedAt': now,
                // Add field-level source information
                'metadata.fieldMetadata': metadata.fieldMetadata || {},
                // Store native relationship type if available
                'metadata.nativeRelationshipType': filteredRecord.metadata?.nativeRelationshipType,
                // Add archivedAt if the record is archived
                ...(filteredRecord.archived ? { 'metadata.archivedAt': now, 'metadata.archivedReason': 'relationship_removed_in_source' } : {})
              },
              $push: {
                'metadata.fieldHistory': {
                  $each: fieldHistory
                }
              }
            }
          );
          
          // Update the source (consolidated) collection with listener metadata
          try {
            // Update the original record in the consolidated collection to mark it as processed
            await consolidatedCollection.updateOne(
              { _id: record._id },
              {
                $set: {
                  [`metadata.listeners.${job.attrs.data.listenerId}.status`]: 'complete',
                  [`metadata.listeners.${job.attrs.data.listenerId}.lastRun`]: now,
                  [`metadata.listeners.${job.attrs.data.listenerId}.jobId`]: job.attrs.id
                }
              }
            );
            console.log(`Updated consolidated record with listener metadata for listenerId: ${job.attrs.data.listenerId}`);
          } catch (listenerError) {
            console.error('Error updating consolidated record with listener metadata:', listenerError);
            // Continue processing despite error
          }
          
          console.log('Relationship record updated successfully');
        } catch (updateError) {
          console.error('Error updating relationship record:', updateError.message);
          throw updateError;
        }

        // Check if we should create an inverse relationship
        const inverseRelationship = createInverseRelationship(mergedRecord, consolidationConfig);
        
        if (inverseRelationship) {
          console.log('Creating inverse relationship');
          
          try {
            // Check if the inverse relationship already exists
            const inverseQuery = { 
              'source.id': inverseRelationship.source.id,
              'target.id': inverseRelationship.target.id,
              'relationshipType': inverseRelationship.relationshipType
            };
            
            const existingInverse = await Relationships.findOne(inverseQuery).exec();
            
            if (existingInverse) {
              console.log(`Inverse relationship already exists with ID: ${existingInverse._id}`);
            } else {
              // Set appropriate metadata for the inverse
              inverseRelationship.metadata = {
                ...inverseRelationship.metadata,
                createdAt: now,
                updatedAt: now,
                lastProcessedAt: now,
                bidirectionalParent: bestMatch._id // Reference to original relationship
              };
              
              // Create a new external ID specifically for this inverse relationship
              const inverseId = `inverse_${inverseRelationship.source.id}_${inverseRelationship.target.id}_${inverseRelationship.relationshipType}`;
              
              // Set the external IDs
              inverseRelationship.externalIds = {
                ...(inverseRelationship.externalIds || {}),
                [sourceType]: [{
                  id: inverseId,
                  label: 'Inverse Relationship ID',
                  type: 'relationship',
                  timestamp: now
                }]
              };
              
              // Generate a new MongoDB ObjectId for the inverse
              inverseRelationship._id = new mongoose.Types.ObjectId();
              
              // Create the inverse relationship
              const inverseRelationshipModel = new Relationships(inverseRelationship);
              await inverseRelationshipModel.save();
              console.log(`Created inverse relationship with ID: ${inverseRelationshipModel._id}`);
            }
          } catch (inverseError) {
            console.error('Error creating inverse relationship:', inverseError);
            // Continue despite error - we don't want to fail the main job if the inverse fails
          }
        }

      } else {
        console.log('Creating new relationship record');
        // Create new record using the Relationships model
        // Get the external ID key from the source config
        const externalIdKey = getExternalIdKey(sourceType, sourceConfigsCache);
        console.log(`Using externalIdKey from config: ${externalIdKey}`);
        
        // Get the ID dynamically based on the source config
        const recordId = getRecordId(record, sourceType, sourceConfigsCache);
        console.log(`consolidateRelationships - Record ID for ${sourceType}: ${recordId}`);
        
        // Ensure source and target have externalId preserved
        if (filteredRecord.source && filteredRecord.source.id && !filteredRecord.source.externalId) {
          filteredRecord.source.externalId = filteredRecord.source.id;
        }

        if (filteredRecord.target && filteredRecord.target.id && !filteredRecord.target.externalId) {
          filteredRecord.target.externalId = filteredRecord.target.id;
        }

        const newRelationshipData = {
          _id: new mongoose.Types.ObjectId(),
          ...filteredRecord,
          archived: record.record.archived || false,
          externalIds: simplifyExternalIds({
            [externalIdKey]: [{
              id: recordId,
              label: 'Relationship ID',
              type: 'relationship',
              timestamp: now
            }]
          }),
          metadata: {
            sourceId: sourceIdObject,
            objectType: 'relationship',
            sourceType: sourceType,
            createdAt: now,
            updatedAt: now,
            lastProcessedAt: now,
            lastSourceType: sourceType,
            jobHistoryId: record.metadata.jobHistoryId,
            // Store native relationship type if available
            nativeRelationshipType: filteredRecord.metadata?.nativeRelationshipType,
            fieldHistory: Object.entries(filteredRecord).map(([field, value]) =>
              createFieldHistory(field, null, value, sourceType, now)
            ),
            ...(record.record.archived ? { archivedAt: now, archivedReason: 'relationship_removed_in_source' } : {})
          }
        };
        console.log('consolidateRelationships - New record prepared');
        try {
          const newRelationship = new Relationships(newRelationshipData);
          await newRelationship.save();
          console.log('New relationship record created successfully with ID:', newRelationship._id);
        } catch (insertError) {
          console.error('Error creating new relationship record:', insertError.message);
          throw insertError;
        }

        // Check if we should create an inverse relationship
        const inverseRelationship = createInverseRelationship(newRelationshipData, consolidationConfig);
        
        if (inverseRelationship) {
          console.log('Creating inverse relationship');
          
          try {
            // Check if the inverse relationship already exists
            const inverseQuery = { 
              'source.id': inverseRelationship.source.id,
              'target.id': inverseRelationship.target.id,
              'relationshipType': inverseRelationship.relationshipType
            };
            
            const existingInverse = await Relationships.findOne(inverseQuery).exec();
            
            if (existingInverse) {
              console.log(`Inverse relationship already exists with ID: ${existingInverse._id}`);
            } else {
              // Set appropriate metadata for the inverse
              inverseRelationship.metadata = {
                ...inverseRelationship.metadata,
                createdAt: now,
                updatedAt: now,
                lastProcessedAt: now,
                bidirectionalParent: newRelationship._id // Reference to original relationship
              };
              
              // Create a new external ID specifically for this inverse relationship
              const inverseId = `inverse_${inverseRelationship.source.id}_${inverseRelationship.target.id}_${inverseRelationship.relationshipType}`;
              
              // Set the external IDs
              inverseRelationship.externalIds = {
                ...(inverseRelationship.externalIds || {}),
                [sourceType]: [{
                  id: inverseId,
                  label: 'Inverse Relationship ID',
                  type: 'relationship',
                  timestamp: now
                }]
              };
              
              // Generate a new MongoDB ObjectId for the inverse
              inverseRelationship._id = new mongoose.Types.ObjectId();
              
              // Create the inverse relationship
              const inverseRelationshipModel = new Relationships(inverseRelationship);
              await inverseRelationshipModel.save();
              console.log(`Created inverse relationship with ID: ${inverseRelationshipModel._id}`);
            }
          } catch (inverseError) {
            console.error('Error creating inverse relationship:', inverseError);
            // Continue despite error - we don't want to fail the main job if the inverse fails
          }
        }

        // Update source consolidated record with listener metadata (for new record case)
        try {
          // Update the original record in the consolidated collection to mark it as processed
          await consolidatedCollection.updateOne(
            { _id: record._id },
            {
              $set: {
                [`metadata.listeners.${job.attrs.data.listenerId}.status`]: 'complete',
                [`metadata.listeners.${job.attrs.data.listenerId}.lastRun`]: now,
                [`metadata.listeners.${job.attrs.data.listenerId}.jobId`]: job.attrs.id
              }
            }
          );
          console.log(`Updated consolidated record with listener metadata for listenerId: ${job.attrs.data.listenerId}`);
        } catch (listenerError) {
          console.error('Error updating consolidated record with listener metadata:', listenerError);
          // Continue processing despite error
        }

      }

      // Update job history using the JobHistory model
      try {
        console.log(`Creating JobHistory record in workspace_${workspaceId} database`);
        await JobHistory.create({
          _id: new mongoose.Types.ObjectId(),
          name: 'consolidateRelationships',
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
        console.log('Job history updated successfully');
      } catch (historyError) {
        console.error('Error updating job history:', historyError.message);
        console.error('Error stack:', historyError.stack);
        // Continue despite history error
      }
      
      // Mark the CONSOLIDATED record as processed? (Or maybe this isn't needed anymore?)
      // This might need rethinking - the concept of marking as processed applies more to stream->consolidated
      // For consolidated->final, the existence of the final record is the indicator.
      // Let's comment this out for now.
      /*
      try {
        await consolidatedCollection.updateOne(
          { _id: record._id },
          { 
            $set: { 
              'metadata.postProcessing.consolidatedRelationship': 'complete', // Example field
              'metadata.postProcessing.completedAt': new Date()
            } 
          }
        );
        console.log('Consolidated record marked as processed for relationship consolidation');
      } catch (markError) {
        console.error('Error marking consolidated record:', markError.message);
      }
      */

    } catch (error) {
      console.error('Error in consolidateRelationships job:', error);
      console.error('Error stack:', error.stack);
      
      if (workspaceConnection) {
        try {
          // Check if JobHistory model is defined
          if (JobHistory) {
            console.log(`Creating error JobHistory record in workspace_${workspaceId} database`);
            try {
              // Convert data to strings to avoid BSON version conflicts
              const jobData = {
                sourceId: sourceId ? String(sourceId) : undefined,
                sourceType: sourceType,
                workspaceId: workspaceId ? String(workspaceId) : undefined,
                objectId: objectId ? String(objectId) : undefined
              };
              
              await JobHistory.create({
                _id: new mongoose.Types.ObjectId(),
                name: 'consolidateRelationships',
                status: 'failed',
                startTime: jobStartTime,
                endTime: new Date(),
                error: error.message,
                stack: error.stack,
                data: jobData
              });
              console.log('Error job history created successfully');
            } catch (creationError) {
              console.error('Failed to create job history:', creationError.message);
            }
          } else {
            console.error('JobHistory model not defined, cannot log error');
            // Try to create the model here as a fallback
            if (workspaceConnection) {
              try {
                const fallbackJobHistory = workspaceConnection.model('JobHistory', JobHistorySchema);
                
                // Convert data to strings to avoid BSON version conflicts
                const jobData = {
                  sourceId: sourceId ? String(sourceId) : undefined,
                  sourceType: sourceType,
                  workspaceId: workspaceId ? String(workspaceId) : undefined,
                  objectId: objectId ? String(objectId) : undefined
                };
                
                await fallbackJobHistory.create({
                  _id: new mongoose.Types.ObjectId(),
                  name: 'consolidateRelationships',
                  status: 'failed',
                  startTime: jobStartTime,
                  endTime: new Date(),
                  error: error.message,
                  stack: error.stack,
                  data: jobData
                });
                console.log('Created error log with fallback JobHistory model');
              } catch (fallbackError) {
                console.error('Failed to create fallback JobHistory model:', fallbackError.message);
              }
            }
          }
        } catch (logError) {
          console.error('Failed to log error to job history:', logError.message);
          console.error('Error stack:', logError.stack);
        }
      } else {
        console.error('Cannot log to job history: No workspace connection available');
        // Try to create a new connection for error logging
        try {
          const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
          console.log('Attempting to reconnect to MongoDB for error logging at URI:', dataLakeUri);
          const errorConnection = await mongoose.createConnection(dataLakeUri).asPromise();
          const ErrorJobHistory = errorConnection.model('JobHistory', JobHistorySchema);
          
          // Convert data to strings to avoid BSON version conflicts
          const jobData = {
            sourceId: sourceId ? String(sourceId) : undefined,
            sourceType: sourceType,
            workspaceId: workspaceId ? String(workspaceId) : undefined,
            objectId: objectId ? String(objectId) : undefined
          };
          
          await ErrorJobHistory.create({
            _id: new mongoose.Types.ObjectId(),
            name: 'consolidateRelationships',
            status: 'failed',
            startTime: jobStartTime,
            endTime: new Date(),
            error: error.message,
            stack: error.stack,
            data: jobData
          });
          console.log('Created error log with new connection');
          await errorConnection.close();
        } catch (reconnectError) {
          console.error('Failed to reconnect for error logging:', reconnectError.message);
        }
      }

      job.fail(error);
    } finally {
      if (workspaceConnection) {
        await workspaceConnection.close();
      }
      console.log('consolidateRelationships job completed at:', new Date());
      done();
    }
  }
};

/**
 * Enriches a relationship record with more detailed entity information
 * @param {Object} relationship - The relationship record to enrich
 * @param {Object} connection - MongoDB connection
 * @param {string} sourceId - Source ID
 * @param {string} sourceType - Source type (e.g., 'salesforce', 'hubspotSource')
 */
async function enrichRelationship(relationship, connection, sourceId, sourceType) {
  // Define models on the connection passed in
  const PeopleSchema = new mongoose.Schema({}, { strict: false });
  const OrganizationsSchema = new mongoose.Schema({}, { strict: false });
  const DealsSchema = new mongoose.Schema({}, { strict: false });
  const EventsSchema = new mongoose.Schema({}, { strict: false });
  const People = connection.model('people', PeopleSchema);
  const Organizations = connection.model('organizations', OrganizationsSchema);
  const Deals = connection.model('deals', DealsSchema);
  const Events = connection.model('events', EventsSchema);

  const modelMap = {
    'person': People,
    'organization': Organizations,
    'deal': Deals,
    'event': Events
  };

  try {
    console.log('Enriching relationship:', JSON.stringify({
      sourceType: relationship.source.type,
      sourceExternalId: relationship.source.externalId,
      targetType: relationship.target.type, 
      targetExternalId: relationship.target.externalId,
      crmType: sourceType,
      relationshipType: relationship.relationshipType
    }));

    // Get provider base name (e.g., 'salesforce' from 'salesforce')
    const baseSourceType = sourceType.replace(/V\d+$/, '');

    // Create a comprehensive set of query conditions for different ID formats
    const createEntityQuery = (externalId) => {
      if (!externalId) {
        console.warn('Empty external ID passed to createEntityQuery');
        return { _id: { $exists: false } }; // Query that will return no results
      }

      // Always convert externalId to string for consistent handling
      const externalIdStr = String(externalId);
      console.log(`Creating query for ID: ${externalIdStr}`);
      
      // Start with the exact source type external ID
      const query = [
        { [`externalIds.${sourceType}.id`]: externalIdStr },
        { [`externalIds.${sourceType}`]: { $elemMatch: { id: externalIdStr } } }
      ];

      // Add base source type (for providers like salesforce/salesforce)
      if (baseSourceType !== sourceType) {
        query.push(
          { [`externalIds.${baseSourceType}.id`]: externalIdStr },
          { [`externalIds.${baseSourceType}`]: { $elemMatch: { id: externalIdStr } } }
        );
      }

      // Add flattened versions (some sources might store external IDs differently)
      query.push(
        { [`externalIds.${sourceType.toLowerCase()}.id`]: externalIdStr },
        { [`externalIds.${baseSourceType.toLowerCase()}.id`]: externalIdStr }
      );

      // Add generic fallbacks
      query.push(
        { ['id']: externalIdStr },
        { ['externalId']: externalIdStr }
      );

      // Get source-specific field mappings from source configs if available
      if (sourceConfigsCache && sourceConfigsCache[sourceType]) {
        const sourceConfig = sourceConfigsCache[sourceType];
        
        // Add any extra ID fields specified in the source configuration
        if (sourceConfig.idFields && Array.isArray(sourceConfig.idFields)) {
          for (const idField of sourceConfig.idFields) {
            query.push({ [idField]: externalIdStr });
          }
        }
      }

      // Add MongoDB ObjectId query if the ID looks like one
      if (mongoose.Types.ObjectId.isValid(externalIdStr) && externalIdStr.length === 24) {
        try {
          query.push({ '_id': new mongoose.Types.ObjectId(externalIdStr) });
        } catch (err) {
          console.warn(`Failed to create ObjectId from ${externalIdStr}: ${err.message}`);
        }
      }

      // Add a case-insensitive query as a fallback (sometimes IDs are stored with different casing)
      if (typeof externalIdStr === 'string') {
        query.push({ [`externalIds.${baseSourceType}.id`]: { $regex: `^${externalIdStr}$`, $options: 'i' } });
      }

      return { $or: query };
    };

    // Source entity
    const sourceEntityType = relationship.source.type;
    const SourceModel = modelMap[sourceEntityType];
    if (SourceModel) {
      // Ensure externalId is always a string
      const sourceExternalId = relationship.source.externalId ? String(relationship.source.externalId) : null;
      if (!sourceExternalId) {
        console.warn(`Missing external ID for source entity of type ${sourceEntityType}`);
      } else {
        console.log(`Searching for ${sourceEntityType} with external ID ${sourceExternalId}`);
        
        // First try direct MongoDB ObjectId lookup if ID looks like one
        let sourceEntity = null;
        if (mongoose.Types.ObjectId.isValid(sourceExternalId) && sourceExternalId.length === 24) {
          try {
            sourceEntity = await SourceModel.findById(sourceExternalId).exec();
            if (sourceEntity) {
              console.log(`Found source entity by direct ObjectId lookup: ${sourceEntity._id}`);
            }
          } catch (err) {
            console.error(`Error during direct ObjectId lookup: ${err.message}`);
          }
        }
        
        // If not found by direct lookup, try the complex query
        if (!sourceEntity) {
          const query = createEntityQuery(sourceExternalId);
          console.log(`Source query: ${JSON.stringify(query)}`);
          
          try {
            sourceEntity = await SourceModel.findOne(query).exec();
            if (sourceEntity) {
              console.log(`Found source entity with complex query: ${sourceEntity._id}`);
            }
          } catch (err) {
            console.error(`Error during complex query: ${err.message}`);
          }
          
          // Try simpler queries one by one if still not found
          if (!sourceEntity) {
            // Try individual queries from the array to see which one works
            const individualQueries = [
              { [`externalIds.${sourceType}.id`]: sourceExternalId },
              { [`externalIds.${baseSourceType}.id`]: sourceExternalId },
              { [`externalIds.${baseSourceType.toLowerCase()}.id`]: sourceExternalId }
            ];
            
            for (const individualQuery of individualQueries) {
              if (!sourceEntity) {
                try {
                  console.log(`Trying individual query: ${JSON.stringify(individualQuery)}`);
                  sourceEntity = await SourceModel.findOne(individualQuery).exec();
                  if (sourceEntity) {
                    console.log(`Found source entity with query: ${JSON.stringify(individualQuery)}`);
                    break;
                  }
                } catch (err) {
                  console.error(`Error with query ${JSON.stringify(individualQuery)}: ${err.message}`);
                }
              }
            }
          }
        }
        
        if (sourceEntity) {
          console.log(`Found source entity (${sourceEntityType}):`, sourceEntity._id.toString());
          // Preserve original external ID as string
          relationship.source.externalId = sourceExternalId;
          // Set the display name for better UI presentation
          relationship.source.displayName = getDisplayName(sourceEntity, sourceEntityType);
          // Update the ID to use MongoDB ObjectId
          relationship.source.id = sourceEntity._id.toString();
        } else {
          console.warn(`Could not find source entity of type ${sourceEntityType} with ID ${sourceExternalId}`);
          // Keep the original external ID but leave id empty
          relationship.source.externalId = sourceExternalId;
          relationship.source.id = ""; // Clear ID if no MongoDB entity found
          
          // Log current count of entities to help debug
          try {
            const count = await SourceModel.countDocuments({}).exec();
            console.log(`Total ${sourceEntityType} count in database: ${count}`);
            
            // Log sample entities to see their structure
            if (count > 0) {
              const samples = await SourceModel.find({}).limit(3).exec();
              console.log(`Sample ${sourceEntityType} structures:`, 
                samples.map(sample => JSON.stringify({
                  _id: sample._id,
                  externalIds: sample.externalIds
                })).join('\n'));
              
              // Try a more aggressive search for similar IDs
              if (typeof sourceExternalId === 'string') {
                const firstChars = sourceExternalId.substring(0, 6);
                const similarIdQuery = { 
                  $or: [
                    { [`externalIds.${baseSourceType}.id`]: { $regex: `^${firstChars}`, $options: 'i' } },
                    { [`externalIds.${sourceType}.id`]: { $regex: `^${firstChars}`, $options: 'i' } }
                  ]
                };
                
                console.log(`Searching for similar IDs starting with: ${firstChars}`);
                const similarEntities = await SourceModel.find(similarIdQuery).limit(5).exec();
                if (similarEntities.length > 0) {
                  console.log(`Found ${similarEntities.length} entities with similar IDs:`, 
                    similarEntities.map(e => JSON.stringify({
                      _id: e._id,
                      externalIds: e.externalIds
                    })).join('\n'));
                }
              }
            }
          } catch (err) {
            console.error(`Error counting entities: ${err.message}`);
          }
        }
      }
    }
    
    // Target entity
    const targetEntityType = relationship.target.type;
    const TargetModel = modelMap[targetEntityType];
    if (TargetModel) {
      // Ensure externalId is always a string
      const targetExternalId = relationship.target.externalId ? String(relationship.target.externalId) : null;
      if (!targetExternalId) {
        console.warn(`Missing external ID for target entity of type ${targetEntityType}`);
      } else {
        console.log(`Searching for ${targetEntityType} with external ID ${targetExternalId}`);
        
        // First try direct MongoDB ObjectId lookup if ID looks like one
        let targetEntity = null;
        if (mongoose.Types.ObjectId.isValid(targetExternalId) && targetExternalId.length === 24) {
          try {
            targetEntity = await TargetModel.findById(targetExternalId).exec();
            if (targetEntity) {
              console.log(`Found target entity by direct ObjectId lookup: ${targetEntity._id}`);
            }
          } catch (err) {
            console.error(`Error during direct ObjectId lookup: ${err.message}`);
          }
        }
        
        // If not found by direct lookup, try the complex query
        if (!targetEntity) {
          const query = createEntityQuery(targetExternalId);
          console.log(`Target query: ${JSON.stringify(query)}`);
          
          try {
            targetEntity = await TargetModel.findOne(query).exec();
            if (targetEntity) {
              console.log(`Found target entity with complex query: ${targetEntity._id}`);
            }
          } catch (err) {
            console.error(`Error during complex query: ${err.message}`);
          }
          
          // Try simpler queries one by one if still not found
          if (!targetEntity) {
            // Try individual queries from the array to see which one works
            const individualQueries = [
              { [`externalIds.${sourceType}.id`]: targetExternalId },
              { [`externalIds.${baseSourceType}.id`]: targetExternalId },
              { [`externalIds.${baseSourceType.toLowerCase()}.id`]: targetExternalId }
            ];
            
            for (const individualQuery of individualQueries) {
              if (!targetEntity) {
                try {
                  console.log(`Trying individual query: ${JSON.stringify(individualQuery)}`);
                  targetEntity = await TargetModel.findOne(individualQuery).exec();
                  if (targetEntity) {
                    console.log(`Found target entity with query: ${JSON.stringify(individualQuery)}`);
                    break;
                  }
                } catch (err) {
                  console.error(`Error with query ${JSON.stringify(individualQuery)}: ${err.message}`);
                }
              }
            }
          }
        }
        
        if (targetEntity) {
          console.log(`Found target entity (${targetEntityType}):`, targetEntity._id.toString());
          // Preserve original external ID as string
          relationship.target.externalId = targetExternalId;
          // Set the display name for better UI presentation
          relationship.target.displayName = getDisplayName(targetEntity, targetEntityType);
          // Update the ID to use MongoDB ObjectId
          relationship.target.id = targetEntity._id.toString();
        } else {
          console.warn(`Could not find target entity of type ${targetEntityType} with ID ${targetExternalId}`);
          // Keep the original external ID but leave id empty
          relationship.target.externalId = targetExternalId;
          relationship.target.id = ""; // Clear ID if no MongoDB entity found
          
          // Log current count of entities to help debug
          try {
            const count = await TargetModel.countDocuments({}).exec();
            console.log(`Total ${targetEntityType} count in database: ${count}`);
            
            // Log sample entities to see their structure
            if (count > 0) {
              const samples = await TargetModel.find({}).limit(3).exec();
              console.log(`Sample ${targetEntityType} structures:`, 
                samples.map(sample => JSON.stringify({
                  _id: sample._id,
                  externalIds: sample.externalIds
                })).join('\n'));
              
              // Try a more aggressive search for similar IDs
              if (typeof targetExternalId === 'string') {
                const firstChars = targetExternalId.substring(0, 6);
                const similarIdQuery = { 
                  $or: [
                    { [`externalIds.${baseSourceType}.id`]: { $regex: `^${firstChars}`, $options: 'i' } },
                    { [`externalIds.${sourceType}.id`]: { $regex: `^${firstChars}`, $options: 'i' } }
                  ]
                };
                
                console.log(`Searching for similar IDs starting with: ${firstChars}`);
                const similarEntities = await TargetModel.find(similarIdQuery).limit(5).exec();
                if (similarEntities.length > 0) {
                  console.log(`Found ${similarEntities.length} entities with similar IDs:`, 
                    similarEntities.map(e => JSON.stringify({
                      _id: e._id,
                      externalIds: e.externalIds
                    })).join('\n'));
                }
              }
            }
          } catch (err) {
            console.error(`Error counting entities: ${err.message}`);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error enriching relationship:', error);
    // Continue without enrichment rather than failing
  }
}

/**
 * Gets a display name for an entity to use in the relationship record
 * @param {Object} entity - The entity (person, organization, etc.)
 * @param {string} entityType - The type of entity
 * @returns {string} A display name for the entity
 */
function getDisplayName(entity, entityType) {
  if (!entity) return '';
  
  switch (entityType.toLowerCase()) {
    case 'person':
      // For people, use name or email
      if (entity.name && (entity.name.firstName || entity.name.lastName)) {
        const firstName = entity.name.firstName || '';
        const lastName = entity.name.lastName || '';
        return `${firstName} ${lastName}`.trim();
      } else if (entity.emailAddress) {
        return entity.emailAddress;
      }
      break;
    
    case 'organization':
      // For organizations, use company name or domain
      if (entity.companyName) {
        return entity.companyName;
      } else if (entity.domain) {
        return entity.domain;
      }
      break;
    
    case 'deal':
      // For deals, use the deal name or description
      if (entity.name) {
        return entity.name;
      } else if (entity.description) {
        return entity.description;
      }
      break;
    
    case 'event':
      // For events, use event title, name, or description
      if (entity.title) {
        return entity.title;
      } else if (entity.name) {
        return entity.name;
      } else if (entity.description) {
        return entity.description;
      }
      break;
  }
  
  // Fallback to entity ID if no better display name is found
  return entity._id.toString();
}

/**
 * Helper function to simplify externalIds structure
 * @param {Object} externalIds - The complex externalIds object
 * @returns {Object} Simplified externalIds where values are strings instead of arrays of objects
 */
function simplifyExternalIds(externalIds) {
  if (!externalIds) return {};
  
  return Object.fromEntries(
    Object.entries(externalIds).map(([key, value]) => {
      if (Array.isArray(value) && value.length > 0) {
        return [key, value[0].id];
      }
      return [key, value];
    })
  );
}
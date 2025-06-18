const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs').promises;
const { JobHistorySchema, ConsolidatedRecordSchema } = require('../../data/models');
require('dotenv').config();

// Function to load source configs
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

// Helper to check if two date ranges overlap
const dateRangesOverlap = (range1, range2) => {
  if (!range1 || !range2) return false;
  
  const from1 = new Date(range1.from);
  const to1 = new Date(range1.to);
  const from2 = new Date(range2.from);
  const to2 = new Date(range2.to);
  
  return (from1 <= to2 && from2 <= to1);
};

// Helper to check if two objects are equal (for dimensions comparison)
const areObjectsEqual = (obj1, obj2) => {
  if (!obj1 || !obj2) return false;
  
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);
  
  if (keys1.length !== keys2.length) return false;
  
  return keys1.every(key => {
    if (typeof obj1[key] === 'object' && typeof obj2[key] === 'object') {
      return areObjectsEqual(obj1[key], obj2[key]);
    }
    return obj1[key] === obj2[key];
  });
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

      // Handle simple string mappings
      if (typeof mapping === 'string') {
        const value = getFieldValue(record, mapping);
        if (value !== undefined) {
          transformed[commonField] = value;
        }
      } 
      // Handle nested object mappings
      else if (typeof mapping === 'object' && !Array.isArray(mapping)) {
        transformed[commonField] = {};
        for (const [key, path] of Object.entries(mapping)) {
          if (typeof path === 'string') {
            const value = getFieldValue(record, path);
            if (value !== undefined) {
              transformed[commonField][key] = value;
            }
          } else if (typeof path === 'object' && !Array.isArray(path)) {
            // Handle deeper nesting
            transformed[commonField][key] = transformRecord(record, path);
          }
        }
      }
      // Handle array mappings
      else if (Array.isArray(mapping)) {
        // Try each path until we find a value
        for (const path of mapping) {
          const value = getFieldValue(record, path);
          if (value !== undefined) {
            transformed[commonField] = value;
            break;
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

// Helper to find duplicate facts
const findDuplicates = async (FactsModel, transformedRecord, consolidationConfig, sourceType) => {
  const searchCriteria = [];
  
  // Get matching criteria from config
  const matchingCriteria = consolidationConfig.mergeRules.matchingCriteria;
  const confidenceThreshold = consolidationConfig.mergeRules.confidenceThreshold;
  
  // Build search query - use broader search and filter with confidence later
  const query = {};
  
  // Match by core fact attributes
  if (transformedRecord.factType) query.factType = transformedRecord.factType;
  if (transformedRecord.property) query.property = transformedRecord.property;
  if (transformedRecord.entityId) query.entityId = transformedRecord.entityId;
  if (transformedRecord.entityType) query.entityType = transformedRecord.entityType;
  if (transformedRecord.period) query.period = transformedRecord.period;
  
  try {
    // Find potential matches
    const results = await FactsModel.find(query).exec();
    
    // Filter results using confidence calculation
    return results.filter(fact => {
      // Check date range overlap (existing logic)
      const dateRangeMatch = dateRangesOverlap(
        transformedRecord.dateRange,
        fact.dateRange
      );
      
      // If date ranges don't overlap, skip
      if (!dateRangeMatch) return false;
      
      // Calculate confidence based on all matching criteria
      const confidence = calculateMatchConfidence(
        transformedRecord,
        fact,
        matchingCriteria
      );
      
      console.log(`Facts confidence score: ${confidence} (threshold: ${confidenceThreshold})`);
      
      return confidence >= confidenceThreshold;
    });
  } catch (err) {
    console.error('Error finding duplicate facts:', err);
    return [];
  }
};

// Helper function to merge records
const mergeRecords = (existing, incoming, sourceInfo, consolidationConfig) => {
  // Start with a copy of the existing record
  const merged = { ...existing };
  const now = new Date();
  
  // Ensure sourceInfo is an object with both id and type
  const sourceData = typeof sourceInfo === 'object' 
    ? sourceInfo 
    : { sourceType: sourceInfo };
    
  // Initialize or get field metadata to track source and timestamp of each field
  merged.metadata = merged.metadata || {};
  merged.metadata.fieldMetadata = merged.metadata.fieldMetadata || {};
  
  // Check if this is from the same source instance or a higher priority source
  const fieldMetadata = {
    sourceId: merged.metadata.fieldMetadata?.value?.sourceId,
    sourceType: merged.metadata.fieldMetadata?.value?.sourceType || merged.metadata.lastSourceType
  };
  
  const shouldUpdate = shouldUpdateField("value", fieldMetadata, sourceData, consolidationConfig);
  
  // If source types are the same or new source has higher priority, update the value
  if (shouldUpdate) {
    merged.value = incoming.value;
    merged.source = incoming.source || sourceData.sourceType;
    
    // Update field metadata with source and timestamp
    merged.metadata.fieldMetadata.value = {
      sourceId: sourceData.sourceId,
      sourceType: sourceData.sourceType,
      updatedAt: now
    };
    
    // Update metadata at record level too
    merged.metadata.lastSourceType = sourceData.sourceType;
    merged.metadata.updatedAt = now;
  }
  
  return merged;
};

// Helper to check if a field should be updated based on source priorities
const shouldUpdateField = (field, currentSourceInfo, newSourceInfo, consolidationConfig) => {
  // If the field was never set before, always update it
  if (!currentSourceInfo || !currentSourceInfo.sourceType) {
    return true;
  }

  // If specific source IDs are available and they match, always update (allow self-override)
  if (currentSourceInfo.sourceId && newSourceInfo.sourceId && 
      currentSourceInfo.sourceId === newSourceInfo.sourceId) {
    return true;
  }
  
  // Fallback to sourceType comparison if IDs aren't available or don't match
  if (currentSourceInfo.sourceType === newSourceInfo.sourceType) {
    return true;
  }

  // Otherwise, check priorities
  const currentSourcePriority = consolidationConfig.sources[currentSourceInfo.sourceType]?.priority || Infinity;
  const newSourcePriority = consolidationConfig.sources[newSourceInfo.sourceType]?.priority || Infinity;
  
  return newSourcePriority <= currentSourcePriority;
};

// Helper to calculate match confidence between two records
const calculateMatchConfidence = (record1, record2, matchingCriteria) => {
  let matchCount = 0;
  let totalCriteria = 0;

  for (const criteria of matchingCriteria) {
    const value1 = getFieldValue(record1, criteria);
    const value2 = getFieldValue(record2, criteria);
    
    // Skip comparison if both values are blank/empty
    if ((!value1 || value1.length === 0) && (!value2 || value2.length === 0)) {
      continue;
    }
    
    // Only count fields where at least one record has a value
    if (value1 || value2) {
      totalCriteria++;
      
      // Special handling for different field types
      if (criteria.startsWith('dateRange.')) {
        // For date fields, check if they match exactly
        if (value1 && value2 && new Date(value1).getTime() === new Date(value2).getTime()) {
          matchCount++;
        }
      } else if (criteria === 'dimensions') {
        // For dimensions, use the existing areObjectsEqual function
        if (areObjectsEqual(value1, value2)) {
          matchCount++;
        }
      } else {
        // For other fields, direct comparison
        if (value1 === value2) {
          matchCount++;
        }
      }
    }
  }

  return totalCriteria > 0 ? matchCount / totalCriteria : 0;
};

module.exports = {
  job: async (job, done) => {
    // Define JobHistory at function scope to ensure availability in catch/finally blocks
    let JobHistory;
    
    const { sourceId, sourceType, workspaceId, objectId, externalRecordId } = job.attrs.data;
    console.log('FACTS JOB STARTING with params:', { sourceId, sourceType, workspaceId, objectId });
    const jobStartTime = new Date();
    let workspaceConnection;

    try {
      // Validate required fields
      if (!sourceId || !sourceType || !workspaceId) {
        throw new Error('Missing required fields');
      }

      // Load configs if not cached
      if (!sourceConfigsCache) {
        sourceConfigsCache = await loadSourceConfigs();
        console.log('FACTS JOB: Loaded configs for sources:', Object.keys(sourceConfigsCache));
      }
      
      // Connect to workspace database
      const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
      console.log('FACTS JOB: Connecting to database:', dataLakeUri);
      workspaceConnection = await mongoose.createConnection(dataLakeUri).asPromise();

      // Define models using imported schemas
      JobHistory = workspaceConnection.model('jobhistories', JobHistorySchema);
      
      // Use the ConsolidatedRecordSchema for the Facts model
      const Facts = workspaceConnection.model('facts', ConsolidatedRecordSchema);
      
      // Ensure the facts collection exists
      try {
        await workspaceConnection.db.createCollection('facts');
        console.log('FACTS JOB: Created facts collection');
      } catch (err) {
        // Collection likely already exists
        console.log('FACTS JOB: Facts collection already exists or error creating:', err.message);
      }

      // Create job history
      const savedJobHistory = await JobHistory.create({
        name: 'consolidateFacts',
        status: 'in_progress',
        startTime: jobStartTime,
        jobId: job.attrs.id,
        sourceId
      });

      // Get stream collection
      const streamCollection = workspaceConnection.collection(`source_${sourceId}_stream`);
      
      // Query to fetch fact records from stream collection
      const query = {};
      if (objectId) {
        query._id = new mongoose.Types.ObjectId(objectId);
      }
      
      // Find fact records
      console.log('FACTS JOB: Looking for records in collection', `source_${sourceId}_stream`);
      const streamRecords = await streamCollection.find(query).toArray();
      console.log(`FACTS JOB: Found ${streamRecords.length} fact records to process`);
      
      if (streamRecords.length > 0) {
        console.log('FACTS JOB: First record sample:', JSON.stringify(streamRecords[0]).substring(0, 500));
      }
      
      let processedCount = 0;
      let createdCount = 0;
      let updatedCount = 0;
      
      // Process each record
      for (const record of streamRecords) {
        try {
          // Record is already in the expected format
          const factRecord = record;
          
          // Ensure _id is a proper ObjectId
          if (factRecord._id && typeof factRecord._id === 'string') {
            factRecord._id = new mongoose.Types.ObjectId(factRecord._id);
          }
          
          // Look for existing fact with same attributes
          const existingFacts = await findDuplicates(Facts, factRecord, sourceConfigsCache[sourceType], sourceType);
          
          if (existingFacts.length > 0) {
            // Update existing fact
            const merged = mergeRecords(existingFacts[0], factRecord, {
              sourceId: sourceId,
              sourceType: sourceType
            }, sourceConfigsCache[sourceType]);
            
            // Update the existing fact without listener metadata
            await Facts.findByIdAndUpdate(
              existingFacts[0]._id, 
              {
                $set: {
                  ...merged
                }
              }
            );
            
            // Update the source stream record with listener metadata
            try {
              // Find the original record in the stream collection
              const streamRecord = await streamCollection.findOne({ _id: record._id });
              
              if (streamRecord) {
                // Update the original record with listener metadata
                await streamCollection.updateOne(
                  { _id: record._id },
                  {
                    $set: {
                      [`metadata.listeners.${job.attrs.data.listenerId}.status`]: 'complete',
                      [`metadata.listeners.${job.attrs.data.listenerId}.lastRun`]: new Date(),
                      [`metadata.listeners.${job.attrs.data.listenerId}.jobId`]: job.attrs.id
                    }
                  }
                );
                console.log(`Updated stream record with listener metadata for listenerId: ${job.attrs.data.listenerId}`);
              } else {
                console.log(`Couldn't find original stream record for ${record._id}`);
              }
            } catch (listenerError) {
              console.error('Error updating stream record with listener metadata:', listenerError);
              // Continue processing despite error
            }
            
            updatedCount++;
          } else {
            // Create new fact
            factRecord.metadata = factRecord.metadata || {};
            factRecord.metadata.createdAt = new Date();
            factRecord.metadata.updatedAt = new Date();
            factRecord.metadata.lastSourceType = sourceType;
            
            // Add field-level metadata for new records
            factRecord.metadata.fieldMetadata = {
              value: {
                sourceId: sourceId,
                sourceType: sourceType,
                updatedAt: new Date()
              }
            };
            
            // Create new fact without listener metadata
            await Facts.create(factRecord);
            
            // Update the source stream record with listener metadata
            try {
              // Find the original record in the stream collection
              const streamRecord = await streamCollection.findOne({ _id: record._id });
              
              if (streamRecord) {
                // Update the original record with listener metadata
                await streamCollection.updateOne(
                  { _id: record._id },
                  {
                    $set: {
                      [`metadata.listeners.${job.attrs.data.listenerId}.status`]: 'complete',
                      [`metadata.listeners.${job.attrs.data.listenerId}.lastRun`]: new Date(),
                      [`metadata.listeners.${job.attrs.data.listenerId}.jobId`]: job.attrs.id
                    }
                  }
                );
                console.log(`Updated stream record with listener metadata for listenerId: ${job.attrs.data.listenerId}`);
              } else {
                console.log(`Couldn't find original stream record for ${record._id}`);
              }
            } catch (listenerError) {
              console.error('Error updating stream record with listener metadata:', listenerError);
              // Continue processing despite error
            }
            
            createdCount++;
          }
          
          processedCount++;
        } catch (err) {
          console.error(`Error processing fact record: ${err.message}`);
          // Continue processing other records
        }
      }
      
      // Update job history
      await JobHistory.findByIdAndUpdate(savedJobHistory._id, {
        status: 'complete',
        endTime: new Date(),
        data: {
          processedCount,
          createdCount,
          updatedCount
        }
      });
      
      console.log(`Completed consolidation: ${processedCount} processed, ${createdCount} created, ${updatedCount} updated`);
      
    } catch (err) {
      console.error(`Error in consolidateFacts job: ${err.message}`);
      if (JobHistory && savedJobHistory) {
        await JobHistory.findByIdAndUpdate(savedJobHistory._id, {
          status: 'failed',
          endTime: new Date(),
          $push: { errors: { error: err.message } }
        });
      }
    } finally {
      if (workspaceConnection) {
        await workspaceConnection.close();
      }
      done();
    }
  }
}; 
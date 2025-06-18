const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs').promises;
// Import JobHistorySchema and SourceSchema
const { JobHistorySchema, SourceSchema } = require('../../data/models'); 
require('dotenv').config(); // Load environment variables from .env

// Load relationship extractor for Zoho CRM
let zohoRelationshipExtractor;
try {
    zohoRelationshipExtractor = require('../../sources/zohocrm/relationshipExtractor.js');
} catch (error) {
    console.warn('Zoho relationship extractor not found, synthetic relationships will not be created');
    zohoRelationshipExtractor = null;
}

// Helper function to get Zoho API base URL from token
function getZohoApiBaseUrlFromToken(token, decryptApiTokenDetails) {
    if (!token.encryptedApiDomain) {
        console.warn("encryptedApiDomain not found in token, using default");
        return 'https://www.zohoapis.com';
    }
    try {
        const decryptedValue = decryptApiTokenDetails(token.encryptedApiDomain);
        if (decryptedValue.includes('accounts.zoho')) {
            return decryptedValue.replace('accounts.zoho', 'www.zohoapis');
        } else if (decryptedValue.includes('zohoapis')) {
            return decryptedValue;
        } else {
            return `https://www.${decryptedValue}`;
        }
    } catch (e) {
        console.error("Failed to decrypt api_domain from token", e);
        return 'https://www.zohoapis.com';
    }
}

// Function to load all source configs
const loadSourceConfigs = async () => {
  const sourcesDir = path.join(__dirname, '../../sources');
  const configs = {};

  try {
    const dirs = await fs.readdir(sourcesDir);
    console.log('consolidateRecord - Loading source directories');
    
    for (const dir of dirs) {
      const configPath = path.join(sourcesDir, dir, 'config.json');
      try {
        // Delete cache first to ensure we get fresh configs
        delete require.cache[require.resolve(configPath)];
        const config = require(configPath);
        
        // Map both versioned and unversioned names to the same config
        const baseSourceType = config.provider;
        configs[baseSourceType] = config;
        configs[dir] = config;
        
        console.log('consolidateRecord - Source config loaded');
      } catch (err) {
        console.error(`consolidateRecord - Error loading config for ${dir}:`, err);
      }
    }

    console.log('consolidateRecord - All source configs loaded');
  } catch (err) {
    console.error('consolidateRecord - Error loading source configs:', err);
    console.error('consolidateRecord - Attempted sources directory:', sourcesDir);
  }

  return configs;
};

// Cache for source configs
let sourceConfigsCache = null;

module.exports = {
    job: async (job, done) => {
        // Destructure data with defaults to avoid undefined errors
        const {
            sourceId,
            sourceType,
            workspaceId,
            objectId,
            sourceConfig,
            change,
            externalRecordId
        } = job.attrs.data || {};
        
        // Extract objectType separately with let to allow reassignment
        let objectType = job.attrs.data?.objectType || 'record'; // Default to 'record' if not present

        // Log that we are starting processing this record
        console.log('consolidateRecord - Starting processing for Doc ID:', objectId, 'Type:', objectType);

        // Reduce verbosity of job data logging
        console.log('consolidateRecord - Received job data:', {
            sourceId: sourceId,
            objectType: objectType,
            type: sourceType || 'unknown',
            workspaceId: workspaceId
        });

        // Validate required fields
        if (!sourceId || !sourceType || !workspaceId || !objectId) {
            console.error('Error in consolidation job: Error: Missing sourceId, sourceType, workspaceId, or objectId. Got:', job.attrs.data);
            // Log detailed error with actual data passed
            job.fail(new Error(`Missing essential fields. Got: ${JSON.stringify(job.attrs.data)}`));
            done();
            return;
        }

        // If objectType is missing, we'll try to determine it from the record itself later
        const needToFindObjectType = !objectType;
        if (needToFindObjectType) {
            console.log('consolidateRecord - Warning: objectType not provided in job data, will attempt to determine from record');
        }

        const jobStartTime = new Date();
        let workspaceConnection; // Use workspaceConnection instead of connection
        
        try {
            // Load configs if not cached
            if (!sourceConfigsCache) {
                sourceConfigsCache = await loadSourceConfigs();
            }

            // Handle sourceId conversion properly
            let sourceIdStr;
            try {
                // Check if sourceId is already an ObjectId
                if (sourceId instanceof mongoose.Types.ObjectId) {
                    sourceIdStr = sourceId.toString();
                } 
                // Check if it's a valid ObjectId string
                else if (mongoose.Types.ObjectId.isValid(sourceId)) {
                    sourceIdStr = sourceId;
                }
                // If not, it might be an external ID - log this situation
                else {
                    console.log(`consolidateRecord - Warning: sourceId ${sourceId} is not a valid ObjectId, will search by other fields`);
                    sourceIdStr = sourceId;
                }
            } catch (e) {
                console.error(`consolidateRecord - Error processing sourceId: ${e.message}`);
                sourceIdStr = String(sourceId); // Fallback to string conversion
            }

            // Connect to the workspace database using env variables
            const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
            workspaceConnection = await mongoose.createConnection(dataLakeUri).asPromise(); // Use asPromise()

            // Define models on the workspace connection
            const JobHistory = workspaceConnection.model('JobHistory', JobHistorySchema);
            const Source = workspaceConnection.model('Source', SourceSchema); // Define Source model

            // Verify source exists using the scoped Source model
            console.log('consolidateRecord - About to find Source. sourceIdStr type: string, value:', sourceIdStr);
            
            // Find the source, using multiple strategies
            let source;
            try {
                if (mongoose.Types.ObjectId.isValid(sourceIdStr)) {
                    source = await Source.findById(sourceIdStr);
                }
                
                // If not found by direct ID, try looking up by name or other identifiers
                if (!source) {
                    console.log(`consolidateRecord - Source not found by ID, trying alternative lookups`);
                    source = await Source.findOne({ 
                        $or: [
                            { name: sourceType },
                            { type: sourceType }
                        ]
                    });
                }

                if (!source) {
                    throw new Error(`consolidateRecord - Source not found for ID: ${sourceIdStr} or type: ${sourceType} in workspace ${workspaceId}`);
                }
            } catch (findError) {
                console.error(`consolidateRecord - Error finding source: ${findError.message}`);
                throw findError;
            }

            console.log('consolidateRecord - Starting consolidation job with sourceId:', sourceId);

            // Get source configuration
            const config = sourceConfigsCache[sourceType];
            if (!config) {
                throw new Error(`consolidateRecord - No config found for source type: ${sourceType}. Available types: ${Object.keys(sourceConfigsCache).join(', ')}`);
            }

            // Get object config, falling back to default if not found
            const objectConfig = config.objects[objectType] || config.defaultConfig;
            if (!objectConfig) {
                throw new Error(`consolidateRecord - No object config or default config found for type: ${objectType}`);
            }

            // Get collections using workspaceConnection
            const streamCollection = workspaceConnection.collection(`source_${sourceIdStr}_stream`);
            const consolidatedCollection = workspaceConnection.collection(
                `source_${sourceIdStr}_consolidated`
            );

            // First try to find the record by MongoDB ObjectId
            let record = null;
            
            try {
                // First try using the MongoDB ObjectId
                if (mongoose.Types.ObjectId.isValid(objectId)) {
                    console.log('consolidateRecord - Looking for record with MongoDB ObjectId:', objectId);
                    const query = { 
                        _id: new mongoose.Types.ObjectId(objectId),
                        'metadata.sourceType': sourceType,
                        'metadata.postProcessing.consolidatedRecord': { $ne: 'complete' }
                    };
                    record = await streamCollection.findOne(query);
                    
                    if (record) {
                        console.log(`consolidateRecord - Found record with sourceType: ${record.metadata.sourceType}`);
                    }
                }
                
                // If not found and we have an external record ID, try that
                if (!record && externalRecordId) {
                    console.log(`consolidateRecord - Record not found by ObjectId, trying external ID: ${externalRecordId}`);
                    // Create a sourceType condition to handle both sourceType and sourceTypeSource patterns
                    const sourceTypeCondition = sourceType.endsWith('Source') 
                        ? { $in: [sourceType, sourceType.replace('Source', '')] }
                        : { $in: [sourceType, `${sourceType}Source`] };
                    
                    record = await streamCollection.findOne({ 
                        'record.id': externalRecordId,
                        'metadata.sourceType': sourceTypeCondition,
                        'metadata.postProcessing.consolidatedRecord': { $ne: 'complete' }
                    });
                    
                    if (record) {
                        console.log(`consolidateRecord - Found record with sourceType: ${record.metadata.sourceType}`);
                    }
                }
                
                // If still not found, try any unprocessed record
                if (!record) {
                    console.log(`consolidateRecord - Record not found with either ID, looking for any unprocessed records`);
                    // Create a sourceType condition to handle both sourceType and sourceTypeSource patterns
                    const sourceTypeCondition = sourceType.endsWith('Source') 
                        ? { $in: [sourceType, sourceType.replace('Source', '')] }
                        : { $in: [sourceType, `${sourceType}Source`] };
                    
                    record = await streamCollection.findOne({
                        'metadata.sourceType': sourceTypeCondition,
                        'metadata.postProcessing.consolidatedRecord': { $ne: 'complete' }
                    });
                    
                    if (record) {
                        console.log(`consolidateRecord - Found record with sourceType: ${record.metadata.sourceType}`);
                    }
                }
            } catch (recordError) {
                console.error(`consolidateRecord - Error finding record:`, recordError);
                throw recordError;
            }

            if (!record) {
                console.log(`consolidateRecord - No records found to process`);
                return;
            }

            try {
                if (!record.record) {
                    console.warn(`consolidateRecord - Skipping record without record field: ${record._id}`);
                    return;
                }

                // Get the objectType from the metadata if not provided in job data
                let recordObjectType = objectType || record.metadata?.objectType;
                
                // If we still don't have an objectType, we can't proceed
                if (!recordObjectType) {
                    console.error(`consolidateRecord - Unable to determine objectType from record: ${record._id}`);
                    job.fail(new Error(`Could not determine objectType for record: ${record._id}`));
                    done();
                    return;
                }
                
                // If we had to find the objectType, update the local objectType variable
                if (needToFindObjectType) {
                    objectType = recordObjectType;
                    console.log(`consolidateRecord - Determined objectType from record: ${objectType}`);
                }
                
                // Find matching type in mapping
                let mappedObjectType;
                
                // Special case handling for relationship records
                if (recordObjectType === 'relationship') {
                    mappedObjectType = 'relationship';
                    console.log('consolidateRecord - Found relationship record, special handling applied');
                } else {
                    // Regular handling for non-relationship records
                    mappedObjectType = Object.entries(config.objectTypeMapping)
                        .find(([_, possibleTypes]) => possibleTypes.includes(recordObjectType))?.[0];
                }

                if (!mappedObjectType) {
                    console.warn(`consolidateRecord - Unknown object type: ${recordObjectType}`);
                    return;
                }

                // Get primary ID from the record using the configured path
                let primaryId;
                
                // Special handling for relationship records which might have a different ID field
                if (recordObjectType === 'relationship') {
                    primaryId = record.record.id || record.record.externalId;
                    if (!primaryId) {
                        console.warn(`consolidateRecord - Skipping relationship record without ID: ${record._id}`);
                        return;
                    }
                } else {
                    // Regular path-based ID extraction for non-relationship records
                    primaryId = objectConfig.primaryId.split('.').reduce((obj, key) => {
                        return obj && obj[key];
                    }, record.record);
                    
                    if (!primaryId) {
                        console.warn(`consolidateRecord - Skipping record without primary ID: ${record._id}`);
                        return;
                    }
                }

                // Convert any ObjectId strings to actual ObjectIds
                const recordWithObjectIds = JSON.parse(JSON.stringify(record.record), (key, value) => {
                    if (typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value)) {
                        return new mongoose.Types.ObjectId(value);
                    }
                    return value;
                });

                // Get existing document to preserve createdAt if it exists
                const existingDoc = await consolidatedCollection.findOne({ 
                    externalId: primaryId 
                });
                const now = new Date();

                // Structure the record properly
                let structuredRecord;
                
                // Check if we should preserve the source structure
                const consolidationOptions = config.consolidationOptions || {};
                const preserveSourceStructure = consolidationOptions.preserveSourceStructure !== false; // Default to true if not set
                
                // If preserveSourceStructure is true, just use the original record structure
                if (preserveSourceStructure) {
                    structuredRecord = recordWithObjectIds;
                    console.log(`consolidateRecord - Preserving original source structure for ${recordObjectType}`);
                }
                // Special case for relationship records or when not preserving structure
                else if (recordObjectType === 'relationship') {
                    structuredRecord = { ...recordWithObjectIds };
                } else {
                    // Check if there's a consolidation mapping for this source type and object type
                    const sourceConfig = sourceConfigsCache[record.metadata.sourceType];
                    
                    if (sourceConfig && sourceConfig.consolidationMapping && sourceConfig.consolidationMapping[recordObjectType]) {
                        // Use the consolidation mapping from the config
                        const mapping = sourceConfig.consolidationMapping[recordObjectType];
                        structuredRecord = {};
                        
                        // Apply all the mappings defined in the config
                        for (const [targetField, sourcePath] of Object.entries(mapping)) {
                            try {
                                // Get value from the path in record.record (source document)
                                const value = sourcePath.split('.').reduce((obj, key) => {
                                    return obj && obj[key] !== undefined ? obj[key] : undefined;
                                }, record.record);
                                
                                structuredRecord[targetField] = value !== undefined ? value : null;
                            } catch (e) {
                                console.warn(`consolidateRecord - Error extracting ${sourcePath} for ${targetField}:`, e.message);
                                structuredRecord[targetField] = null;
                            }
                        }
                        
                        // Ensure properties exists
                        structuredRecord.properties = record.record.properties || {};
                    } else {
                        // Standard structure for regular records
                        structuredRecord = {
                            id: recordWithObjectIds.id,
                            properties: recordWithObjectIds.properties || {},
                            createdAt: recordWithObjectIds.createdAt,
                            updatedAt: recordWithObjectIds.updatedAt,
                            archived: recordWithObjectIds.archived
                        };
                    }
                }

                // Safely create ObjectId for sourceId
                let sourceIdObject;
                try {
                    if (mongoose.Types.ObjectId.isValid(sourceIdStr)) {
                        sourceIdObject = new mongoose.Types.ObjectId(sourceIdStr);
                    } else {
                        console.warn(`consolidateRecord - Invalid ObjectId for sourceId: ${sourceIdStr}, using string as is`);
                        sourceIdObject = sourceIdStr;
                    }
                } catch (objectIdError) {
                    console.error(`consolidateRecord - Error creating ObjectId from ${sourceIdStr}:`, objectIdError);
                    sourceIdObject = sourceIdStr;
                }

                // Prepare consolidated document
                const consolidatedDoc = {
                    _id: existingDoc?._id || new mongoose.Types.ObjectId(),
                    externalId: primaryId,
                    sourceId: sourceIdObject,
                    objectType: recordObjectType,
                    record: structuredRecord,
                    metadata: {
                        sourceId: record.metadata.sourceId,
                        objectType: record.metadata.objectType,
                        sourceType: record.metadata.sourceType,
                        createdAt: existingDoc?.metadata?.createdAt || now,
                        updatedAt: now,
                        jobHistoryId: record.metadata.jobHistoryId
                    }
                };
                
                // Add extra metadata for relationship records
                if (recordObjectType === 'relationship') {
                    consolidatedDoc.metadata.relationshipType = record.metadata.relationshipType;
                    consolidatedDoc.metadata.sourceEntityType = record.metadata.sourceEntityType;
                    consolidatedDoc.metadata.targetEntityType = record.metadata.targetEntityType;
                }

                // Upsert the consolidated document
                await consolidatedCollection.updateOne(
                    { externalId: primaryId },
                    { $set: consolidatedDoc },
                    { upsert: true }
                );

                // First set our own listener status to complete
                await consolidatedCollection.updateOne(
                    { externalId: primaryId },
                    {
                        $set: {
                            [`metadata.listeners.${job.attrs.data.listenerId}`]: {
                                status: 'complete',
                                lastRun: new Date(),
                                jobId: job.attrs.id
                            }
                        }
                    }
                );

                // Then get all listeners for this source from the outrun database
                try {
                    const outrunUri = `${process.env.MONGODB_URI}/outrun?${process.env.MONGODB_PARAMS}`;
                    const outrunDb = await mongoose.createConnection(outrunUri).asPromise();
                    const listenersCollection = outrunDb.collection('listeners');
                    
                    // Find all listeners for this source except the current one
                    const otherListeners = await listenersCollection.find({
                        'metadata.workspaceId': workspaceId,
                        'metadata.sourceId': sourceId,
                        _id: { $ne: new mongoose.Types.ObjectId(job.attrs.data.listenerId) }
                    }).toArray();
                    
                    console.log(`consolidateRecord - Found ${otherListeners.length} other listeners to notify about changes`);
                    
                    // Clear all other listeners' metadata to trigger them
                    if (otherListeners.length > 0) {
                        console.log(`consolidateRecord - Clearing metadata for all other listeners to trigger downstream processing`);
                        
                        // Set the entire listeners object to null instead of individual unsets
                        await consolidatedCollection.updateOne(
                            { externalId: primaryId },
                            { 
                                $set: { 
                                    'metadata.listeners': null 
                                }
                            }
                        );
                        console.log(`consolidateRecord - Cleared metadata for ${otherListeners.length} other listeners to trigger downstream processing`);
                    }
                    
                    await outrunDb.close();
                } catch (error) {
                    console.error('consolidateRecord - Error updating listeners metadata:', error);
                    // Continue processing despite error
                }

                // Mark the stream record as processed
                await streamCollection.updateOne(
                    { _id: record._id },
                    { 
                        $set: { 
                            'metadata.postProcessing.consolidatedRecord': 'complete',
                            'metadata.postProcessing.completedAt': new Date()
                        } 
                    }
                );

                console.log('consolidateRecord - Consolidated record', objectId);

                // *** NEW: Inject synthetic relationships for Zoho CRM ***
                if (sourceType === 'zohocrm' && zohoRelationshipExtractor) {
                    try {
                        console.log('consolidateRecord - Checking for extractable Zoho relationships');
                        
                        // Check if this record has extractable relationship data
                        if (zohoRelationshipExtractor.hasExtractableRelationships(consolidatedDoc.record)) {
                            console.log(`consolidateRecord - Extracting relationships from ${consolidatedDoc.objectType} record`);
                            
                            // Prepare API config for fetching related records (only for Account records)
                            let apiConfig = null;
                            if (consolidatedDoc.objectType === 'Accounts') {
                                try {
                                    // Get API credentials from the source token
                                    const TokenModel = workspaceConnection.model('Token', require('../../data/models').Token.schema);
                                    const token = await TokenModel.findOne({ provider: 'zoho', workspaceId });
                                    
                                    if (token) {
                                        const { getValidToken } = require('../../providers/zoho/api.js');
                                        const { decryptToken: decryptApiTokenDetails } = require('../../providers/zoho/api.js');
                                        
                                        const accessToken = await getValidToken(TokenModel, token, workspaceId);
                                        const apiDomain = getZohoApiBaseUrlFromToken(token, decryptApiTokenDetails);
                                        
                                        apiConfig = {
                                            accessToken,
                                            apiDomain,
                                            rateLimiter: null // We'll handle rate limiting separately for related records
                                        };
                                        
                                        console.log('consolidateRecord - API config prepared for fetching related records');
                                    } else {
                                        console.warn('consolidateRecord - No Zoho token found, skipping related records fetch');
                                    }
                                } catch (apiError) {
                                    console.error('consolidateRecord - Error preparing API config:', apiError.message);
                                    // Continue without API config
                                }
                            }
                            
                            // Extract synthetic relationships from this single record
                            const syntheticRelationships = await zohoRelationshipExtractor.extractRelationships(
                                [consolidatedDoc.record], 
                                sourceIdStr,
                                apiConfig
                            );
                            
                            if (syntheticRelationships.length > 0) {
                                console.log(`consolidateRecord - Injecting ${syntheticRelationships.length} synthetic relationships`);
                                
                                for (const syntheticRel of syntheticRelationships) {
                                    // Validate the synthetic relationship
                                    if (!zohoRelationshipExtractor.validateSyntheticRelationship(syntheticRel)) {
                                        console.warn('consolidateRecord - Skipping invalid synthetic relationship');
                                        continue;
                                    }
                                    
                                    // Create a consolidated document for the synthetic relationship
                                    const relationshipDoc = {
                                        _id: syntheticRel._id,
                                        externalId: syntheticRel.externalIds.zohocrm[0].id,
                                        sourceId: sourceIdObject,
                                        objectType: syntheticRel.objectType,
                                        record: {
                                            id: syntheticRel.externalIds.zohocrm[0].id,
                                            source: syntheticRel.source,
                                            target: syntheticRel.target,
                                            relationshipType: syntheticRel.relationshipType,
                                            relationshipRole: syntheticRel.relationshipRole,
                                            properties: {},
                                            createdAt: now,
                                            updatedAt: now,
                                            archived: false
                                        },
                                        metadata: {
                                            sourceId: sourceIdObject,
                                            objectType: syntheticRel.objectType,
                                            sourceType: sourceType,
                                            createdAt: now,
                                            updatedAt: now,
                                            jobHistoryId: record.metadata.jobHistoryId,
                                            synthetic: true,
                                            extractedFrom: syntheticRel.metadata.extractedFrom,
                                            relationshipType: syntheticRel.relationshipType,
                                            sourceEntityType: syntheticRel.source.type,
                                            targetEntityType: syntheticRel.target.type
                                        }
                                    };
                                    
                                    // Upsert the synthetic relationship
                                    await consolidatedCollection.updateOne(
                                        { externalId: relationshipDoc.externalId },
                                        { $set: relationshipDoc },
                                        { upsert: true }
                                    );
                                    
                                    console.log(`consolidateRecord - Injected synthetic ${syntheticRel.objectType}: ${relationshipDoc.externalId}`);
                                }
                                
                                console.log(`consolidateRecord - Successfully injected ${syntheticRelationships.length} synthetic relationships`);
                            } else {
                                console.log('consolidateRecord - No extractable relationships found in record');
                            }
                        } else {
                            console.log('consolidateRecord - Record has no extractable relationship data');
                        }
                    } catch (relationshipError) {
                        console.error('consolidateRecord - Error extracting/injecting synthetic relationships:', relationshipError);
                        // Don't fail the main job for relationship extraction errors
                    }
                }

            } catch (recordError) {
                console.error(`consolidateRecord - Error processing record ${record._id}:`, recordError);
                throw recordError;
            }

            // Update job history using the JobHistory model
            const jobEndTime = new Date();
            const runtimeMilliseconds = jobEndTime - jobStartTime;
            await JobHistory.create({ // Use JobHistory model
                _id: new mongoose.Types.ObjectId(), // Mongoose handles default _id
                name: 'consolidateRecord',
                status: 'complete',
                startTime: jobStartTime,
                endTime: jobEndTime,
                runtimeMilliseconds,
                data: {
                    sourceId: sourceIdStr,
                    sourceType,
                    source: source._id, // Use source document _id
                    objectType,
                    recordsProcessed: 1
                }
            });

        } catch (error) {
            console.error('consolidateRecord - Error in consolidation job:', error);
            
            // Log error to job history if we have a connection and model
            if (workspaceConnection) {
                 try {
                    // Define model here too in case connection succeeded but later steps failed
                    const JobHistory = workspaceConnection.model('JobHistory', JobHistorySchema);
                    await JobHistory.create({ 
                        name: 'consolidateRecord',
                        status: 'failed',
                        startTime: jobStartTime,
                        endTime: new Date(),
                        error: error.message, // Use error.message
                        data: {
                            sourceId: sourceId, // Use original sourceId from job data
                            sourceType,
                            objectType,
                            workspaceId // Include workspaceId for context
                        }
                    });
                 } catch (logError) {
                     console.error("consolidateRecord - Failed to write error to job history:", logError);
                 }
            }

            // Rethrow or handle as needed, calling done() in finally
            // throw error; // Re-throwing might prevent done() call
            job.fail(error); // Use agenda's fail mechanism

        } finally {
            if (workspaceConnection) {
                await workspaceConnection.close();
            }
            done(); // Ensure done() is called
        }
    }
}; 
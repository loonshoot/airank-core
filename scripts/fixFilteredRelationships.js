// Script to fix relationships by filtering unsupported types and updating to use MongoDB ObjectIDs
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs').promises;
require('dotenv').config();

const workspaceId = process.argv[2] || '1'; // Default to workspace 1
const batchSize = 50; // Process relationships in batches to avoid memory issues

// Connect to MongoDB
async function run() {
  console.log(`Connecting to database for workspace ${workspaceId}...`);
  const connection = await mongoose.createConnection(
    `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`
  ).asPromise();

  try {
    // Define schemas
    const Schema = mongoose.Schema;
    const PeopleSchema = new Schema({}, { strict: false });
    const OrganizationsSchema = new Schema({}, { strict: false });
    const RelationshipsSchema = new Schema({}, { strict: false });

    // Create models
    const People = connection.model('people', PeopleSchema);
    const Organizations = connection.model('organizations', OrganizationsSchema);
    const Relationships = connection.model('relationships', RelationshipsSchema);

    // Load consolidation config to get supported relationship types
    const configPath = path.join(__dirname, '../config/common/consolidateRelationships/config.json');
    let consolidationConfig;
    try {
      const configContent = await fs.readFile(configPath, 'utf8');
      consolidationConfig = JSON.parse(configContent);
      console.log('Loaded consolidation config');
    } catch (configError) {
      console.error('Error loading consolidation config:', configError);
      return;
    }

    // Count total number of relationships
    const totalRelationships = await Relationships.countDocuments({}).exec();
    console.log(`Found ${totalRelationships} total relationships to process`);

    // Build a map of external IDs to MongoDB ObjectIDs for fast lookups
    console.log('Building id mapping for people...');
    const peopleIdMap = new Map();
    const personCursor = People.find({}, { _id: 1, 'externalIds': 1 }).cursor();
    
    let personCount = 0;
    for (let person = await personCursor.next(); person != null; person = await personCursor.next()) {
      // Add direct MongoDB ObjectId mapping
      peopleIdMap.set(person._id.toString(), person._id.toString());
      
      if (person.externalIds) {
        // Extract all IDs from all provider types
        Object.values(person.externalIds).forEach(idArr => {
          if (Array.isArray(idArr)) {
            idArr.forEach(idObj => {
              if (idObj && idObj.id) {
                peopleIdMap.set(idObj.id, person._id.toString());
              }
            });
          }
        });
      }
      personCount++;
      if (personCount % 1000 === 0) {
        console.log(`Processed ${personCount} people records...`);
      }
    }
    console.log(`Built id map for ${personCount} people with ${peopleIdMap.size} external IDs`);

    console.log('Building id mapping for organizations...');
    const organizationsIdMap = new Map();
    const orgCursor = Organizations.find({}, { _id: 1, 'externalIds': 1 }).cursor();
    
    let orgCount = 0;
    for (let org = await orgCursor.next(); org != null; org = await orgCursor.next()) {
      // Add direct MongoDB ObjectId mapping
      organizationsIdMap.set(org._id.toString(), org._id.toString());
      
      if (org.externalIds) {
        // Extract all IDs from all provider types
        Object.values(org.externalIds).forEach(idArr => {
          if (Array.isArray(idArr)) {
            idArr.forEach(idObj => {
              if (idObj && idObj.id) {
                organizationsIdMap.set(idObj.id, org._id.toString());
              }
            });
          }
        });
      }
      orgCount++;
      if (orgCount % 1000 === 0) {
        console.log(`Processed ${orgCount} organization records...`);
      }
    }
    console.log(`Built id map for ${orgCount} organizations with ${organizationsIdMap.size} external IDs`);

    // Function to check if a relationship is supported
    function isRelationshipSupported(relationship, config) {
      if (!relationship || !relationship.source || !relationship.target || !relationship.relationshipType) {
        console.log('Relationship missing required fields');
        return false;
      }

      const sourceType = relationship.source.type;
      const targetType = relationship.target.type;
      const relType = relationship.relationshipType;

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

    // Function to create an inverse relationship
    function createInverseRelationship(relationship, config) {
      if (!relationship || !relationship.source || !relationship.target || !relationship.relationshipType) {
        return null;
      }

      const supportedTypes = config.supportedRelationshipTypes || {};
      const supportedRelType = supportedTypes[relationship.relationshipType];

      if (!supportedRelType || !supportedRelType.bidirectional) {
        // This relationship type doesn't support bidirectional relationships
        return null;
      }

      console.log(`Creating inverse for: ${relationship._id} (${relationship.relationshipType}: ${relationship.source.type} -> ${relationship.target.type})`);
      
      // Create the inverse relationship
      const inverse = JSON.parse(JSON.stringify(relationship)); // Deep clone
      
      // Swap source and target
      const tempSource = inverse.source;
      inverse.source = inverse.target;
      inverse.target = tempSource;
      
      // Set the inverse relationship type
      inverse.relationshipType = supportedRelType.inverseName || inverse.relationshipType;
      
      // Generate a new ObjectId
      inverse._id = new mongoose.Types.ObjectId();
      
      // Create or update metadata
      if (!inverse.metadata) {
        inverse.metadata = {};
      }
      
      // Set bidirectionalParent to refer to the original relationship
      inverse.metadata.bidirectionalParent = relationship._id;
      inverse.metadata.createdAt = new Date();
      inverse.metadata.updatedAt = new Date();
      
      console.log(`Created inverse with ID ${inverse._id} (${inverse.relationshipType}: ${inverse.source.type} -> ${inverse.target.type}) - parent: ${relationship._id}`);
      
      return inverse;
    }

    // Function to get display name
    async function getDisplayName(id, type, model) {
      try {
        if (!mongoose.Types.ObjectId.isValid(id)) return '';
        
        const entity = await model.findById(id).exec();
        if (!entity) return '';
        
        if (type === 'person') {
          if (entity.name && (entity.name.firstName || entity.name.lastName)) {
            const firstName = entity.name.firstName || '';
            const lastName = entity.name.lastName || '';
            return `${firstName} ${lastName}`.trim();
          } else if (entity.emailAddress) {
            return entity.emailAddress;
          }
        } else if (type === 'organization') {
          if (entity.companyName) {
            return entity.companyName;
          } else if (entity.domain) {
            return entity.domain;
          }
        }
        return '';
      } catch (err) {
        console.error(`Error getting display name: ${err.message}`);
        return '';
      }
    }

    // Process relationships in batches
    let skip = 0;
    let updated = 0;
    let deleted = 0;
    let createdInverse = 0;
    let total = 0;

    while (true) {
      const relationships = await Relationships.find({})
        .skip(skip)
        .limit(batchSize)
        .exec();
      
      if (relationships.length === 0) break;
      
      console.log(`Processing batch of ${relationships.length} relationships (${skip} to ${skip + relationships.length})`);
      
      for (const relationship of relationships) {
        let needsUpdate = false;
        total++;
        
        // Check if this relationship is a supported type
        if (!isRelationshipSupported(relationship.toObject(), consolidationConfig)) {
          console.log(`Deleting unsupported relationship: ${relationship._id} - ${relationship.relationshipType} between ${relationship.source?.type} and ${relationship.target?.type}`);
          try {
            await Relationships.deleteOne({ _id: relationship._id });
            deleted++;
            continue; // Skip to next relationship
          } catch (deleteErr) {
            console.error(`Error deleting relationship: ${deleteErr.message}`);
          }
        }
        
        // Process source entity
        if (relationship.source && relationship.source.type) {
          const sourceType = relationship.source.type;
          const sourceId = relationship.source.id;
          const sourceExternalId = relationship.source.externalId || sourceId;
          
          // Find the MongoDB ObjectId for this entity
          let mongoObjectId = null;
          
          if (sourceType === 'person' && peopleIdMap.has(sourceExternalId)) {
            mongoObjectId = peopleIdMap.get(sourceExternalId);
          } else if (sourceType === 'organization' && organizationsIdMap.has(sourceExternalId)) {
            mongoObjectId = organizationsIdMap.get(sourceExternalId);
          }
          
          // Only update if we found a MongoDB ObjectId and it's different from the current one
          if (mongoObjectId && mongoObjectId !== sourceId) {
            console.log(`Updating source reference: ${sourceExternalId} -> ${mongoObjectId}`);
            
            // Use the updateOne method directly for more reliable updates
            await Relationships.updateOne(
              { _id: relationship._id },
              { 
                $set: {
                  'source.externalId': sourceExternalId,
                  'source.id': mongoObjectId
                }
              }
            );
            
            // Also update the display name if possible
            if (!relationship.source.displayName) {
              const modelToUse = sourceType === 'person' ? People : Organizations;
              const displayName = await getDisplayName(mongoObjectId, sourceType, modelToUse);
              if (displayName) {
                await Relationships.updateOne(
                  { _id: relationship._id },
                  { $set: { 'source.displayName': displayName } }
                );
              }
            }
            
            needsUpdate = true;
          }
        }
        
        // Process target entity
        if (relationship.target && relationship.target.type) {
          const targetType = relationship.target.type;
          const targetId = relationship.target.id;
          const targetExternalId = relationship.target.externalId || targetId;
          
          // Find the MongoDB ObjectId for this entity
          let mongoObjectId = null;
          
          if (targetType === 'person' && peopleIdMap.has(targetExternalId)) {
            mongoObjectId = peopleIdMap.get(targetExternalId);
          } else if (targetType === 'organization' && organizationsIdMap.has(targetExternalId)) {
            mongoObjectId = organizationsIdMap.get(targetExternalId);
          }
          
          // Only update if we found a MongoDB ObjectId and it's different from the current one
          if (mongoObjectId && mongoObjectId !== targetId) {
            console.log(`Updating target reference: ${targetExternalId} -> ${mongoObjectId}`);
            
            // Use the updateOne method directly for more reliable updates
            await Relationships.updateOne(
              { _id: relationship._id },
              { 
                $set: {
                  'target.externalId': targetExternalId,
                  'target.id': mongoObjectId
                }
              }
            );
            
            // Also update the display name if possible
            if (!relationship.target.displayName) {
              const modelToUse = targetType === 'person' ? People : Organizations;
              const displayName = await getDisplayName(mongoObjectId, targetType, modelToUse);
              if (displayName) {
                await Relationships.updateOne(
                  { _id: relationship._id },
                  { $set: { 'target.displayName': displayName } }
                );
              }
            }
            
            needsUpdate = true;
          }
        }
        
        if (needsUpdate) {
          updated++;
          
          // Reload the updated relationship for inverse creation
          const updatedRelationship = await Relationships.findById(relationship._id).exec();
          
          // Check if we need to create an inverse relationship
          const inverseRelationship = createInverseRelationship(updatedRelationship.toObject(), consolidationConfig);
          if (inverseRelationship) {
            // Check if the inverse already exists
            const existingInverse = await Relationships.findOne({
              'source.id': inverseRelationship.source.id,
              'target.id': inverseRelationship.target.id,
              'relationshipType': inverseRelationship.relationshipType
            });
            
            if (!existingInverse) {
              console.log(`Creating inverse relationship for ${relationship._id}`);
              await Relationships.create(inverseRelationship);
              createdInverse++;
            }
          }
        } else {
          // Even if relationship doesn't need ID updates, check if it needs an inverse
          const inverseRelationship = createInverseRelationship(relationship.toObject(), consolidationConfig);
          if (inverseRelationship) {
            // Check if the inverse already exists
            const existingInverse = await Relationships.findOne({
              'source.id': inverseRelationship.source.id,
              'target.id': inverseRelationship.target.id,
              'relationshipType': inverseRelationship.relationshipType
            });
            
            if (!existingInverse) {
              console.log(`Creating inverse relationship for ${relationship._id}`);
              await Relationships.create(inverseRelationship);
              createdInverse++;
            }
          }
        }
      }
      
      skip += batchSize;
      console.log(`Progress: ${total}/${totalRelationships} processed, ${updated} updated, ${deleted} deleted, ${createdInverse} inverse relationships created`);
    }

    console.log(`Complete! Processed ${total} relationships, updated ${updated}, deleted ${deleted}, created ${createdInverse} inverse relationships`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await connection.close();
    console.log('Connection closed');
  }
}

run().catch(console.error); 
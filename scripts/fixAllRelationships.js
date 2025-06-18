// Script to fix all relationships by updating source.id and target.id to use MongoDB ObjectIDs
const mongoose = require('mongoose');
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

    // Count total number of relationships
    const totalRelationships = await Relationships.countDocuments({}).exec();
    console.log(`Found ${totalRelationships} total relationships to process`);

    // Build a map of external IDs to MongoDB ObjectIDs for fast lookups
    console.log('Building id mapping for people...');
    const peopleIdMap = new Map();
    const personCursor = People.find({}, { _id: 1, 'externalIds': 1 }).cursor();
    
    let personCount = 0;
    for (let person = await personCursor.next(); person != null; person = await personCursor.next()) {
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
            relationship.source.externalId = sourceExternalId;
            relationship.source.id = mongoObjectId;
            
            // Get display name if not already set
            if (!relationship.source.displayName) {
              const modelToUse = sourceType === 'person' ? People : Organizations;
              relationship.source.displayName = await getDisplayName(mongoObjectId, sourceType, modelToUse);
            }
            
            needsUpdate = true;
            console.log(`Updating source reference: ${sourceExternalId} -> ${mongoObjectId}`);
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
            relationship.target.externalId = targetExternalId;
            relationship.target.id = mongoObjectId;
            
            // Get display name if not already set
            if (!relationship.target.displayName) {
              const modelToUse = targetType === 'person' ? People : Organizations;
              relationship.target.displayName = await getDisplayName(mongoObjectId, targetType, modelToUse);
            }
            
            needsUpdate = true;
            console.log(`Updating target reference: ${targetExternalId} -> ${mongoObjectId}`);
          }
        }
        
        // Save the updated relationship
        if (needsUpdate) {
          try {
            await relationship.save();
            updated++;
          } catch (err) {
            console.error(`Error saving relationship ${relationship._id}: ${err.message}`);
          }
        }
      }
      
      skip += batchSize;
      console.log(`Progress: ${total}/${totalRelationships} processed, ${updated} updated`);
    }

    console.log(`Complete! Processed ${total} relationships, updated ${updated}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await connection.close();
    console.log('Connection closed');
  }
}

run().catch(console.error); 
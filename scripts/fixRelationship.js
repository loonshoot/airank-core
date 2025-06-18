// Script to fix a relationship by updating its source.id and target.id to use MongoDB ObjectIDs
const mongoose = require('mongoose');
require('dotenv').config();

const relationshipId = process.argv[2]; // Accept relationship ID as argument
const workspaceId = process.argv[3] || '1'; // Default to workspace 1

if (!relationshipId) {
  console.error('Usage: node scripts/fixRelationship.js <relationshipId> [workspaceId]');
  process.exit(1);
}

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

    // Find the relationship
    console.log(`Looking for relationship with ID: ${relationshipId}`);
    let relationship;
    
    if (mongoose.Types.ObjectId.isValid(relationshipId)) {
      // Try to find by MongoDB ObjectId
      relationship = await Relationships.findById(relationshipId).exec();
    }
    
    if (!relationship) {
      // Try to find by external ID fields
      relationship = await Relationships.findOne({
        $or: [
          { 'source.id': relationshipId },
          { 'target.id': relationshipId },
          { 'source.externalId': relationshipId },
          { 'target.externalId': relationshipId },
          { 'externalIds.salesforce.id': relationshipId },
          { 'externalIds.hubspot.id': relationshipId }
        ]
      }).exec();
    }

    if (!relationship) {
      console.error('Relationship not found');
      return;
    }

    console.log('Found relationship:', JSON.stringify(relationship, null, 2));

    // Function to get display name
    function getDisplayName(entity, entityType) {
      if (!entity) return '';
      
      switch (entityType.toLowerCase()) {
        case 'person':
          if (entity.name && (entity.name.firstName || entity.name.lastName)) {
            const firstName = entity.name.firstName || '';
            const lastName = entity.name.lastName || '';
            return `${firstName} ${lastName}`.trim();
          } else if (entity.emailAddress) {
            return entity.emailAddress;
          }
          break;
        case 'organization':
          if (entity.companyName) {
            return entity.companyName;
          } else if (entity.domain) {
            return entity.domain;
          }
          break;
      }
      
      return entity._id.toString();
    }

    // Check and fix source entity
    const sourceType = relationship.source.type;
    const sourceId = relationship.source.externalId || relationship.source.id;
    let sourceUpdated = false;
    
    console.log(`Finding source entity (${sourceType}) with external ID: ${sourceId}`);
    
    // Choose the right model based on entity type
    const SourceModel = sourceType === 'person' ? People : 
                        sourceType === 'organization' ? Organizations : null;
    
    if (SourceModel && sourceId) {
      // Try to find the entity using various query combinations
      const sourceQueries = [
        { [`externalIds.salesforce.id`]: sourceId },
        { [`externalIds.salesforce`]: { $elemMatch: { id: sourceId } } },
        { [`externalIds.hubspot.id`]: sourceId },
        { [`externalIds.hubspot`]: { $elemMatch: { id: sourceId } } },
        { 'id': sourceId },
        { 'externalId': sourceId }
      ];
      
      let sourceEntity = null;
      
      // Try each query until we find a match
      for (const query of sourceQueries) {
        if (!sourceEntity) {
          try {
            sourceEntity = await SourceModel.findOne(query).exec();
            if (sourceEntity) {
              console.log(`Found source entity with query:`, query);
              break;
            }
          } catch (err) {
            console.error(`Error with query ${JSON.stringify(query)}:`, err.message);
          }
        }
      }
      
      if (sourceEntity) {
        console.log(`Found source entity: ${sourceEntity._id}`);
        // Update the relationship with the MongoDB ObjectId
        relationship.source.externalId = sourceId; // Keep the original ID as externalId
        relationship.source.id = sourceEntity._id.toString(); // Set the MongoDB ObjectId
        relationship.source.displayName = getDisplayName(sourceEntity, sourceType);
        sourceUpdated = true;
      } else {
        console.log(`Source entity not found. Sample source records:`);
        const samples = await SourceModel.find().limit(3).exec();
        console.log(JSON.stringify(samples.map(s => ({
          _id: s._id,
          externalIds: s.externalIds
        })), null, 2));
      }
    }

    // Check and fix target entity
    const targetType = relationship.target.type;
    const targetId = relationship.target.externalId || relationship.target.id;
    let targetUpdated = false;
    
    console.log(`Finding target entity (${targetType}) with external ID: ${targetId}`);
    
    // Choose the right model based on entity type
    const TargetModel = targetType === 'person' ? People : 
                        targetType === 'organization' ? Organizations : null;
    
    if (TargetModel && targetId) {
      // Try to find the entity using various query combinations
      const targetQueries = [
        { [`externalIds.salesforce.id`]: targetId },
        { [`externalIds.salesforce`]: { $elemMatch: { id: targetId } } },
        { [`externalIds.hubspot.id`]: targetId },
        { [`externalIds.hubspot`]: { $elemMatch: { id: targetId } } },
        { 'id': targetId },
        { 'externalId': targetId }
      ];
      
      let targetEntity = null;
      
      // Try each query until we find a match
      for (const query of targetQueries) {
        if (!targetEntity) {
          try {
            targetEntity = await TargetModel.findOne(query).exec();
            if (targetEntity) {
              console.log(`Found target entity with query:`, query);
              break;
            }
          } catch (err) {
            console.error(`Error with query ${JSON.stringify(query)}:`, err.message);
          }
        }
      }
      
      if (targetEntity) {
        console.log(`Found target entity: ${targetEntity._id}`);
        // Update the relationship with the MongoDB ObjectId
        relationship.target.externalId = targetId; // Keep the original ID as externalId
        relationship.target.id = targetEntity._id.toString(); // Set the MongoDB ObjectId
        relationship.target.displayName = getDisplayName(targetEntity, targetType);
        targetUpdated = true;
      } else {
        console.log(`Target entity not found. Sample target records:`);
        const samples = await TargetModel.find().limit(3).exec();
        console.log(JSON.stringify(samples.map(s => ({
          _id: s._id,
          externalIds: s.externalIds
        })), null, 2));
      }
    }

    // Save the relationship if any updates were made
    if (sourceUpdated || targetUpdated) {
      console.log('Saving updated relationship...');
      await relationship.save();
      console.log('Relationship updated successfully:', JSON.stringify({
        source: relationship.source,
        target: relationship.target
      }, null, 2));
    } else {
      console.log('No updates made to the relationship.');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await connection.close();
    console.log('Connection closed');
  }
}

run().catch(console.error); 
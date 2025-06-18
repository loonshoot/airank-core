// mutations/createSource/index.js
const mongoose = require('mongoose');
const crypto = require('crypto');
const { Member } = require('../../queries/member');
const { uuid } = require('uuidv4'); // Import UUID library
const path = require('path');
const fs = require('fs/promises');

// Define the source schema 
const sourceSchema = new mongoose.Schema({
  name: String,
  status: String,
  whitelistedIp: [String],
  bearerToken: String,
  tokenId: String,
  sourceType: String,
  datalakeCollection: String,
  matchingField: String,
  batchConfig: { type: mongoose.Schema.Types.Mixed, default: {} } // Open schema for batchConfig
});

// Async function to establish the database connection
async function createConnection(workspaceId) {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  try {
    const datalake = mongoose.createConnection(dataLakeUri);

    // Register the model on this connection 
    datalake.model('Source', sourceSchema); 

    await datalake.asPromise(); // Wait for connection to establish
    console.log(`Connected to workspace database: ${dataLakeUri}`); 
    return datalake;
  } catch (error) {
    console.error('Error connecting to workspace database:', error);
    throw error; // Re-throw the error to let the mutation handle it 
  }
}

// Function to encrypt the bearer token
function encryptToken(token) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(process.env.CRYPTO_SECRET, 'hex'), iv);
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return {
    iv: iv.toString('hex'),
    encryptedData: encrypted
  };
}

// Function to create a listener for the source
async function createSourceListener(workspaceId, sourceId, sourceType) {
    try {
        const outrunUri = `${process.env.MONGODB_URI}/outrun?${process.env.MONGODB_PARAMS}`;
        const outrunDb = mongoose.createConnection(outrunUri);
        await outrunDb.asPromise();

        const listenersCollection = outrunDb.collection('listeners');
        
        // Load source config to get object type mappings
        const sourceTypePath = sourceType; // Use sourceType directly - it maps 1:1 to folder names now
        let objectTypeMapping = {};
        
        try {
            // Only look in the exact path for config file
            const configPath = path.resolve(__dirname, `../../../config/sources/${sourceTypePath}/config.json`);
            
            console.log(`Looking for config file at: ${configPath}`);
            // Check if file exists
            await fs.access(configPath);
            
            // Read and parse the config
            const configData = await fs.readFile(configPath, 'utf8');
            const sourceConfig = JSON.parse(configData);
            objectTypeMapping = sourceConfig.objectTypeMapping || {};
            console.log(`Loaded source config for ${sourceType} with mappings:`, objectTypeMapping);
        } catch (err) {
            // Don't fall back to default - just fail the job
            console.error(`Failed to load config for ${sourceType}: ${err.message}`);
            throw new Error(`Config file not found for source type: ${sourceTypePath}`);
        }

        // Stream listener for consolidateRecord
        const streamListener = {
            collection: `source_${sourceId}_stream`,
            filter: {},
            operationType: ['insert', 'update'],
            jobName: 'consolidateRecord',
            isActive: true,
            metadata: {
                type: 'stream',
                workspaceId,
                sourceId,
                sourceType,
                handleAnyObjectType: true  // Use handleAnyObjectType instead of dynamic=true
            },
            createdAt: new Date(),
            updatedAt: new Date()
        };

        // Consolidation listener for consolidatePeople
        const consolidatePeopleListener = {
            collection: `source_${sourceId}_consolidated`,
            filter: {},
            operationType: ['insert', 'update'],
            jobName: 'consolidatePeople',
            isActive: true,
            metadata: {
                type: 'consolidate',
                workspaceId,
                sourceId,
                sourceType,
                objectType: 'people',
                mappedSourceTypes: objectTypeMapping.people || ['contacts', 'person']
            },
            createdAt: new Date(),
            updatedAt: new Date()
        };

        // Consolidation listener for consolidateOrganizations
        const consolidateOrganizationsListener = {
            collection: `source_${sourceId}_consolidated`,
            filter: {},
            operationType: ['insert', 'update'],
            jobName: 'consolidateOrganizations',
            isActive: true,
            metadata: {
                type: 'consolidate',
                workspaceId,
                sourceId,
                sourceType,
                objectType: 'organizations',
                mappedSourceTypes: objectTypeMapping.organizations || ['companies', 'organization']
            },
            createdAt: new Date(),
            updatedAt: new Date()
        };

        // Relationship listener for consolidateRelationships
        const relationshipListener = {
            collection: `source_${sourceId}_consolidated`,
            filter: {},
            operationType: ['insert', 'update'],
            jobName: 'consolidateRelationships',
            isActive: true,
            metadata: {
                type: 'consolidate',
                workspaceId,
                sourceId,
                sourceType,
                objectType: 'relationship',
                mappedSourceTypes: objectTypeMapping.relationship || ['relationship', 'contactCompanyRelationship']
            },
            createdAt: new Date(),
            updatedAt: new Date()
        };

        // Facts listener for consolidateFacts
        const factsListener = {
            collection: `source_${sourceId}_consolidated`,
            filter: {},
            operationType: ['insert', 'update'],
            jobName: 'consolidateFacts',
            isActive: true,
            metadata: {
                type: 'consolidate',
                workspaceId,
                sourceId,
                sourceType,
                objectType: 'fact',
                mappedSourceTypes: objectTypeMapping.facts || ['searchAnalytics']
            },
            createdAt: new Date(),
            updatedAt: new Date()
        };

        // Create collections if they don't exist
        const workspaceDb = await mongoose.createConnection(
            `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`
        );

        await Promise.all([
            workspaceDb.createCollection(streamListener.collection),
            workspaceDb.createCollection(consolidatePeopleListener.collection),
            workspaceDb.createCollection(consolidateOrganizationsListener.collection)
        ]).catch(err => {
            // Ignore collection exists error
            if (err.code !== 48) throw err;
        });

        // Insert all listeners
        await Promise.all([
            listenersCollection.insertOne(streamListener),
            listenersCollection.insertOne(consolidatePeopleListener),
            listenersCollection.insertOne(consolidateOrganizationsListener),
            listenersCollection.insertOne(relationshipListener),
            listenersCollection.insertOne(factsListener)
        ]);

        console.log(`Created stream, consolidate, relationship, and facts listeners for source ${sourceId}`);

        await Promise.all([
            outrunDb.close(),
            workspaceDb.close()
        ]);
        
        return true;
    } catch (err) {
        console.error('Error creating source listeners:', err);
        throw err;
    }
}

// Async function to create a new source
async function createSource(parent, args, { user }) {
  if (user && (user.sub)) {
    const workspaceId = args.workspaceId; 
    try {
      // Find member with the user's email and permission
      const member = await Member.findOne({ 
        workspaceId: workspaceId, 
        userId: user.sub,
        permissions: "mutation:createSource" // Check for "mutation:createSource" permission
      });

      if (member) { // If member found and has permission
        // Validate the input data
        if (!args.name || !args.sourceType) {
          throw new Error('Missing required fields: name, sourceType');
        }

        // Handle bearer token encryption for webhook sources
        let bearerToken = null;
        if (args.sourceType === 'webhook') {
          bearerToken = crypto.randomBytes(32).toString('hex'); // Generate a random bearer token
          const encryptedToken = encryptToken(bearerToken);
          bearerToken = encryptedToken.encryptedData;
        }

        // Connect to the database
        const datalake = await createConnection(workspaceId);

        // Create the source object
        const newSource = datalake.model('Source')({ 
          name: args.name,
          status: "new",
          whitelistedIp: args.whitelistedIp || [], // Handle whitelisted IP addresses
          bearerToken: bearerToken, 
          tokenId: args.tokenId,
          sourceType: args.sourceType,
          matchingField: args.matchingField,
          batchConfig: args.batchConfig || {} // Assign batchConfig from arguments
        });

        // Save the source document
        await newSource.save();

        // Create the listener for this source
        await createSourceListener(workspaceId, newSource._id.toString(), args.sourceType);

        // Disconnect from the database
        await datalake.close();

        // Return the newly created source
        return { 
          _id: newSource._id,
          name: newSource.name,
          status: newSource.status,
          whitelistedIp: newSource.whitelistedIp,
          bearerToken: newSource.bearerToken,
          sourceType: newSource.sourceType,
          tokenId: newSource.tokenId,
          datalakeCollection: newSource.datalakeCollection,
          matchingField: newSource.matchingField,
          batchConfig: newSource.batchConfig
        };
      } else {
        console.error('User not authorized to create sources');
        return null; // Return null if user doesn't have permission
      }
    } catch (error) {
      console.error('Error creating source:', error);
      throw error;
    }
  } else {
    console.error('User not authenticated');
    return null;
  }
}

// Export the createSource function
module.exports = { createSource };
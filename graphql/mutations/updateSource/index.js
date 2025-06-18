// mutations/updateSource/index.js
const { Member } = require('../../queries/member');
const mongoose = require('mongoose');

// Define the source schema 
const sourceSchema = new mongoose.Schema({
  name: String,
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

// Async function to update a source
async function updateSource(parent, args, { user }) {
  if (user && (user.sub)) {
    const workspaceId = args.workspaceId; 
    try {
      // Find member with the user's email and permission
      const member = await Member.findOne({ workspaceId: workspaceId, userId: user.sub,
        permissions: "mutation:updateSource" // Check for "mutation:updateSource" permission
      });

      if (member) { // If member found and has permission
        // Validate inputs
        if (!args.id) {
          throw new Error('Missing required field: id');
        }

        // Connect to the workspace database
        const datalake = await createConnection(workspaceId);
        const workspaceSourceModel = datalake.model('Source'); 

        // Convert the string ID to an ObjectId
        const objectId = new mongoose.Types.ObjectId(args.id);

        // Update the source document
        const updatedSource = await workspaceSourceModel.findOneAndUpdate(
          { _id: objectId }, // Find the source
          { 
            name: args.name || undefined, // Allow updating name
            whitelistedIp: args.whitelistedIp || undefined, // Allow updating whitelisted IPs
            bearerToken: args.bearerToken || undefined, // Allow updating bearerToken
            tokenId: args.tokenId || undefined, // Allow updating tokenId
            sourceType: args.sourceType || undefined, // Allow updating sourceType
            datalakeCollection: args.datalakeCollection || undefined, // Default collection
            matchingField: args.matchingField || undefined, // Allow updating matchingField
            batchConfig: args.batchConfig || undefined // Allow updating batchConfig
          },
          { new: true } // Return the updated document
        );

        await datalake.close();

        if (updatedSource) {
          return updatedSource; // Return the updated source
        } else {
          return null; // If no source found with that ID, return null
        }

      } else {
        console.error('User not authorized to update sources');
        return null; // Return null if user doesn't have permission
      }
    } catch (error) {
      console.error('Error updating source:', error);
      throw error;
    }
  } else {
    console.error('User not authenticated');
    return null;
  }
}

// Export the updateSource function
module.exports = { updateSource };
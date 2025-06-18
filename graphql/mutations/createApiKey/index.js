const mongoose = require('mongoose');
const crypto = require('crypto');
const { Member } = require('../../queries/member');

// Define the API key schema 
const apiKeySchema = new mongoose.Schema({
  bearer: { type: String, required: true, unique: true },
  permissions: { type: [String], required: true },
  name: { type: String, required: true },
  allowedIps: { type: [String], default: [] },
  allowedDomains: { type: [String], default: [] },
  workspace: { type: String, required: true },
  createdBy: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Async function to establish the database connection
async function createConnection(workspaceId) {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  try {
    const datalake = mongoose.createConnection(dataLakeUri);

    // Register the model on this connection 
    datalake.model('ApiKey', apiKeySchema, 'apiKeys'); 

    await datalake.asPromise(); // Wait for connection to establish
    console.log(`Connected to workspace database: ${dataLakeUri}`); 
    return datalake;
  } catch (error) {
    console.error('Error connecting to workspace database:', error);
    throw error; // Re-throw the error to let the mutation handle it 
  }
}

// Async function to create a new API key
async function createApiKey(parent, args, { user }) {
  if (user && (user.sub)) {
    const workspaceId = args.workspaceId; 
    try {
      // Find member with the user's userId and permission
      const member = await Member.findOne({ 
        workspaceId: workspaceId, 
        userId: user.sub,
        permissions: "mutation:createApiKey" // Reuse existing permission for now
      });

      if (member) { // If member found and has permission
        // Validate the input data
        if (!args.name || !args.permissions || args.permissions.length === 0) {
          throw new Error('Missing required fields: name, permissions');
        }

        // Generate a bearer token
        const bearerToken = crypto.randomBytes(20).toString('hex');

        // Connect to the database
        const datalake = await createConnection(workspaceId);

        // Create the API key object
        const newApiKey = datalake.model('ApiKey')({ 
          bearer: bearerToken,
          permissions: args.permissions,
          name: args.name,
          allowedIps: args.allowedIps || [],
          allowedDomains: args.allowedDomains || [],
          workspace: workspaceId,
          createdBy: user.sub
        });

        // Save the API key document
        await newApiKey.save();

        // Disconnect from the database
        await datalake.close();

        // Return the newly created API key
        return { 
          _id: newApiKey._id.toString(),
          bearer: newApiKey.bearer,
          permissions: newApiKey.permissions,
          name: newApiKey.name,
          allowedIps: newApiKey.allowedIps,
          allowedDomains: newApiKey.allowedDomains,
          workspace: newApiKey.workspace,
          createdBy: newApiKey.createdBy,
          createdAt: newApiKey.createdAt.toISOString()
        };
      } else {
        console.error('User not authorized to create API keys');
        return null; // Return null if user doesn't have permission
      }
    } catch (error) {
      console.error('Error creating API key:', error);
      throw error;
    }
  } else {
    console.error('User not authenticated');
    return null;
  }
}

// Export the createApiKey function
module.exports = { createApiKey }; 
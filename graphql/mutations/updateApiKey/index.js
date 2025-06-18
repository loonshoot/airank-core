const mongoose = require('mongoose');
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

// Async function to update an API key
async function updateApiKey(parent, args, { user }) {
  if (user && (user.sub)) {
    const workspaceId = args.workspaceId; 
    try {
      // Find member with the user's userId and permission
      const member = await Member.findOne({ 
        workspaceId: workspaceId, 
        userId: user.sub,
        permissions: "mutation:updateApiKey" // Reuse existing permission for now
      });

      if (member) { // If member found and has permission
        // Validate the input data
        if (!args.id) {
          throw new Error('Missing required field: id');
        }

        // Connect to the database
        const datalake = await createConnection(workspaceId);
        const ApiKeyModel = datalake.model('ApiKey');

        // Find the API key by ID
        const existingApiKey = await ApiKeyModel.findById(args.id);
        if (!existingApiKey) {
          throw new Error('API key not found');
        }

        // Update the API key with provided fields
        const updateFields = {};
        if (args.name !== undefined) updateFields.name = args.name;
        if (args.permissions !== undefined) updateFields.permissions = args.permissions;
        if (args.allowedIps !== undefined) updateFields.allowedIps = args.allowedIps;
        if (args.allowedDomains !== undefined) updateFields.allowedDomains = args.allowedDomains;

        // Update the API key
        const updatedApiKey = await ApiKeyModel.findByIdAndUpdate(
          args.id,
          updateFields,
          { new: true }
        );

        // Disconnect from the database
        await datalake.close();

        // Return the updated API key
        return { 
          _id: updatedApiKey._id.toString(),
          bearer: updatedApiKey.bearer,
          permissions: updatedApiKey.permissions,
          name: updatedApiKey.name,
          allowedIps: updatedApiKey.allowedIps,
          allowedDomains: updatedApiKey.allowedDomains,
          workspace: updatedApiKey.workspace,
          createdBy: updatedApiKey.createdBy,
          createdAt: updatedApiKey.createdAt.toISOString()
        };
      } else {
        console.error('User not authorized to update API keys');
        return null; // Return null if user doesn't have permission
      }
    } catch (error) {
      console.error('Error updating API key:', error);
      throw error;
    }
  } else {
    console.error('User not authenticated');
    return null;
  }
}

// Export the updateApiKey function
module.exports = { updateApiKey }; 
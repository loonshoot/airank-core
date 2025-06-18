// mutations/deleteExternalCredentials/index.js
const { Member } = require('../../queries/member');
const mongoose = require('mongoose'); 

// Duplicate the Token schema
const tokenSchema = new mongoose.Schema({
  email: String,
  encryptedAuthToken: String,
  encryptedRefreshToken: String,
  service: String,
  issueTime: Number, // Store as milliseconds
  expiryTime: Number, // Store as milliseconds
  tokenType: String,
  scopes: [String],
  errorMessages: [String]
});

// Async function to establish the database connection (embedded)
async function createConnection(workspaceId) {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  try {
    const datalake = mongoose.createConnection(dataLakeUri);
    datalake.model('Token', tokenSchema); // Register the model on this connection
    await datalake.asPromise(); // Wait for connection to establish
    console.log(`Connected to workspace database: ${dataLakeUri}`); 
    return datalake;
  } catch (error) {
    console.error('Error connecting to workspace database:', error);
    throw error; // Re-throw the error to let the mutation handle it 
  }
}

// Async function to delete external credentials
async function deleteExternalCredentials(parent, args, { user }) {
  if (user && (user.sub)) {
    // Find member with the user's email
    const member = await Member.findOne({ 
      workspaceId: args.workspaceId, 
      userId: user.sub,
      permissions: "mutation:deleteExternalCredentials" 
    });

    if (member) { 
      try {
        // Validate inputs
        if (!args.id) {
          throw new Error('Missing required field: id');
        }

        // Establish connection to the workspace database
        const datalake = await createConnection(args.workspaceId);

        // Get a reference to the Token model within the workspace database
        const workspaceTokenModel = datalake.model('Token'); 

        // Convert the string ID to an ObjectId
        const objectId = new mongoose.Types.ObjectId(args.id); 

        // Delete the token document
        const deletedToken = await workspaceTokenModel.findOneAndDelete({ 
          _id: objectId
        });

        // Fetch remaining tokens of the same service type after deletion
        const remainingTokens = deletedToken 
          ? await workspaceTokenModel.find({ service: deletedToken.service })
          : []; 

        await datalake.close(); // Close the connection after use

        if (deletedToken) {
          return { 
            message: 'External credential deleted successfully',
            remainingTokens: remainingTokens.map(token => ({
              _id: token._id,
              scopes: token.scopes,
              email: token.email,
              service: token.service,
              errorMessages: token.errorMessages
            }))
          }; 
        } else {
          return null; 
        }
        
      } catch (error) {
        console.error('Error deleting external credentials:', error);
        throw error;
      }
    } else {
      console.error('User not authorized to delete external credentials');
      return null;
    }
  } else {
    console.error('User not authenticated or userId not found');
    return null;
  }
}

// Export the deleteExternalCredentials function
module.exports = { deleteExternalCredentials };
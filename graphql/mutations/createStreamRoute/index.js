// mutations/createStreamRoute/index.js
const mongoose = require('mongoose');
const crypto = require('crypto');
const { Member } = require('../../queries/member');
const { uuid } = require('uuidv4'); // Import UUID library

// Define the StreamRoute schema 
const streamRouteSchema = new mongoose.Schema({
  service: String,
  sourceId: String,
  workspaceId: String,
  data: { type: mongoose.Schema.Types.Mixed, default: {} } // Open schema for batchConfig
});

// Async function to establish the database connection
async function createConnection(workspaceId) {
  const mongoUri = `${process.env.MONGODB_URI}/outrun?${process.env.MONGODB_PARAMS}`;
  try {
    const datalake = mongoose.createConnection(mongoUri);

    // Register the model on this connection 
    datalake.model('StreamRoute', streamRouteSchema, 'streamRoutes'); 

    await datalake.asPromise(); // Wait for connection to establish
    console.log(`Connected to workspace database: ${mongoUri}`); 
    return datalake;
  } catch (error) {
    console.error('Error connecting to workspace database:', error);
    throw error; // Re-throw the error to let the mutation handle it 
  }
}

// Async function to create a new StreamRoute
async function createStreamRoute(parent, args, { user }) {
  if (user && (user.sub)) {
    const workspaceId = args.workspaceId; 
    try {
      // Find member with the user's email and permission
      const member = await Member.findOne({ workspaceId: workspaceId, userId: user.sub,
        permissions: "mutation:createStreamRoute" // Check for "mutation:createStreamRoute" permission
      });

      if (member) { // If member found and has permission
        // Validate the input data
        if (!args.data || !args.service || !args.sourceId) {
          throw new Error('Missing required fields: data, service, sourceId');
        }

        // Connect to the database
        const datalake = await createConnection(workspaceId);

        // Get the StreamRoute model that was already registered in createConnection
        const StreamRoute = datalake.model('StreamRoute');

        // Create a new instance of the StreamRoute model
        const newStreamRoute = new StreamRoute({
          service: args.service,
          sourceId: args.sourceId,
          workspaceId: args.workspaceId,
          data: typeof args.data === 'string' ? JSON.parse(args.data) : args.data
        });

        // Save the StreamRoute document
        await newStreamRoute.save();

        // Disconnect from the database
        await datalake.close();

        // Return the newly created StreamRoute
        return { 
          _id: newStreamRoute._id,
          service: newStreamRoute.service,
          sourceId: newStreamRoute.sourceId,
          workspaceId: newStreamRoute.workspaceId,
          data: newStreamRoute.data
        };
      } else {
        console.error('User not authorized to create StreamRoutes');
        return null; // Return null if user doesn't have permission
      }
    } catch (error) {
      console.error('Error creating StreamRoute:', error);
      throw error;
    }
  } else {
    console.error('User not authenticated');
    return null;
  }
}

// Export the createStreamRoute function
module.exports = { createStreamRoute };
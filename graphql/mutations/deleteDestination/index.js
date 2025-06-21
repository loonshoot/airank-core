const mongoose = require('mongoose');
const { Member } = require('../../queries/member');

// Define the destination schema (should match the one in createDestination)
const destinationSchema = new mongoose.Schema({
  name: String,
  status: { type: String, default: 'active' },
  tokenId: String,
  destinationType: String,
  targetSystem: String,
  rateLimits: {
    requestsPerInterval: Number,
    intervalMs: Number
  },
  mappings: {
    people: {
      enabled: Boolean,
      fields: [String]
    },
    organizations: {
      enabled: Boolean,
      fields: [String]
    }
  },
  listenerIds: [String],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Async function to establish the database connection
async function createConnection(workspaceId) {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  try {
    const datalake = mongoose.createConnection(dataLakeUri);
    datalake.model('Destination', destinationSchema);
    await datalake.asPromise();
    return datalake;
  } catch (error) {
    console.error('Error connecting to workspace database:', error);
    throw error;
  }
}

// Function to delete destination listeners
async function deleteDestinationListeners(listenerIds) {
  if (!listenerIds || listenerIds.length === 0) {
    return;
  }
  
  try {
    const airankUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
    const airankDb = mongoose.createConnection(airankUri);
    await airankDb.asPromise();

    const listenersCollection = airankDb.collection('listeners');
    
    // Delete the listeners
    await listenersCollection.deleteMany({
      _id: { 
        $in: listenerIds.map(id => new mongoose.Types.ObjectId(id)) 
      }
    });

    await airankDb.close();
  } catch (error) {
    console.error('Error deleting destination listeners:', error);
    throw error;
  }
}

// Async function to delete a destination
async function deleteDestination(parent, args, { user }) {
  if (user && (user.sub)) {
    const workspaceId = args.workspaceId;
    try {
      // Find member with the user's email and permission
      const member = await Member.findOne({ workspaceId: workspaceId, userId: user.sub,
        permissions: "mutation:deleteDestination" // Check for "mutation:deleteDestination" permission
      });

      if (member) { // If member found and has permission
        // Validate input
        if (!args.id) {
          throw new Error('Missing required field: id');
        }

        // Connect to the database
        const datalake = await createConnection(workspaceId);
        const DestinationModel = datalake.model('Destination');

        // Find the destination to delete
        const destination = await DestinationModel.findById(args.id);
        if (!destination) {
          throw new Error(`Destination with ID ${args.id} not found`);
        }

        // Delete associated listeners
        await deleteDestinationListeners(destination.listenerIds);

        // Delete the destination
        await DestinationModel.findByIdAndDelete(args.id);

        // Get remaining destinations
        const remainingDestinations = await DestinationModel.find();

        // Disconnect from the database
        await datalake.close();

        // Return response
        return {
          message: 'Destination deleted successfully',
          remainingDestinations
        };
      } else {
        console.error('User not authorized to delete destinations');
        return null;
      }
    } catch (error) {
      console.error('Error deleting destination:', error);
      throw error;
    }
  } else {
    console.error('User not authenticated');
    return null;
  }
}

// Export the deleteDestination function
module.exports = { deleteDestination }; 
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

// Function to update listeners for a destination
async function updateDestinationListeners(workspaceId, destinationId, destinationType, mappings, rateLimits, existingListenerIds) {
  try {
    const outrunUri = `${process.env.MONGODB_URI}/outrun?${process.env.MONGODB_PARAMS}`;
    const outrunDb = mongoose.createConnection(outrunUri);
    await outrunDb.asPromise();

    const listenersCollection = outrunDb.collection('listeners');
    
    // Delete existing listeners
    if (existingListenerIds && existingListenerIds.length > 0) {
      await listenersCollection.deleteMany({
        _id: { 
          $in: existingListenerIds.map(id => new mongoose.Types.ObjectId(id)) 
        }
      });
    }
    
    const createdListenerIds = [];

    // Load config to get field mappings
    const config = require('@outrun/config');
    const sourceConfigs = await config.loadSourceConfigs();
    
    // Generate the job name dynamically from the destinationType
    // This ensures different destination types use their corresponding job handlers
    // Format: "hubspotDestination" for destinationType "hubspot"
    const formatJobName = (type) => {
      // Extract just the platform name if there are multiple words
      const platformName = type.split(/\s+/)[0];
      
      // Format in camelCase - lowercase first letter, remove spaces
      const formattedName = platformName.toLowerCase().replace(/\s+/g, '');
      return `${formattedName}Destination`;
    };
    
    // Create job name from the destinationType
    const jobName = formatJobName(destinationType);
    console.log(`Using job name: ${jobName} for destination type: ${destinationType}`);

    // Create people listener if enabled
    if (mappings.people && mappings.people.enabled) {
      const peopleListener = {
        collection: `people`,
        filter: {
          "updateDescription.updatedFields": {
            $in: mappings.people.fields.map(field => `${field}`)
          }
        },
        operationType: ['update'],
        jobName: jobName,
        isActive: true,
        metadata: {
          type: 'destination',
          workspaceId,
          destinationId,
          destinationType,
          objectType: 'people',
          fields: mappings.people.fields,
          rateLimits
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await listenersCollection.insertOne(peopleListener);
      createdListenerIds.push(result.insertedId.toString());
    }

    // Create organizations listener if enabled
    if (mappings.organizations && mappings.organizations.enabled) {
      const orgsListener = {
        collection: `organizations`,
        filter: {
          "updateDescription.updatedFields": {
            $in: mappings.organizations.fields.map(field => `${field}`)
          }
        },
        operationType: ['update'],
        jobName: jobName,
        isActive: true,
        metadata: {
          type: 'destination',
          workspaceId,
          destinationId,
          destinationType,
          objectType: 'organizations',
          fields: mappings.organizations.fields,
          rateLimits
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await listenersCollection.insertOne(orgsListener);
      createdListenerIds.push(result.insertedId.toString());
    }

    await outrunDb.close();
    return createdListenerIds;
  } catch (error) {
    console.error('Error updating destination listeners:', error);
    throw error;
  }
}

// Async function to update a destination
async function updateDestination(parent, args, { user }) {
  if (user && (user.sub)) {
    const workspaceId = args.workspaceId;
    try {
      // Find member with the user's email and permission
      const member = await Member.findOne({ workspaceId: workspaceId, userId: user.sub,
        permissions: "mutation:updateDestination" // Check for "mutation:updateDestination" permission
      });

      if (member) { // If member found and has permission
        // Validate input
        if (!args.id) {
          throw new Error('Missing required field: id');
        }

        // Connect to the database
        const datalake = await createConnection(workspaceId);
        const DestinationModel = datalake.model('Destination');

        // Find the destination to update
        const destination = await DestinationModel.findById(args.id);
        if (!destination) {
          throw new Error(`Destination with ID ${args.id} not found`);
        }

        // Prepare update object
        const updates = {
          ...(args.name && { name: args.name }),
          ...(args.status && { status: args.status }),
          ...(args.mappings && { mappings: args.mappings }),
          updatedAt: new Date()
        };
        
        // If targetSystem is being updated, derive the destinationType from it
        if (args.targetSystem) {
          // Extract the platform name directly from targetSystem
          // For example, "HubSpot CRM" -> "hubspot"
          const targetSystemParts = args.targetSystem.split(/\s+/);
          const platformName = targetSystemParts[0]; // Take the first part as the platform name
          
          // Keep everything lowercase and remove any spaces
          const destinationType = platformName.toLowerCase().replace(/\s+/g, '');
          
          console.log(`Updating destinationType to "${destinationType}" from targetSystem "${args.targetSystem}"`);
          
          updates.destinationType = destinationType;
        }

        // Update the listeners if mappings have changed
        if (args.mappings) {
          const listenerIds = await updateDestinationListeners(
            workspaceId,
            args.id,
            updates.destinationType || destination.destinationType,
            args.mappings,
            destination.rateLimits,
            destination.listenerIds
          );
          updates.listenerIds = listenerIds;
        }

        // Update the destination
        const updatedDestination = await DestinationModel.findByIdAndUpdate(
          args.id,
          { $set: updates },
          { new: true }
        );

        // Disconnect from the database
        await datalake.close();

        // Return the updated destination
        return updatedDestination;
      } else {
        console.error('User not authorized to update destinations');
        return null;
      }
    } catch (error) {
      console.error('Error updating destination:', error);
      throw error;
    }
  } else {
    console.error('User not authenticated');
    return null;
  }
}

// Export the updateDestination function
module.exports = { updateDestination }; 
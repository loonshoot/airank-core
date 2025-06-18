const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const { Member } = require('../member');

// Define the destination schema
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

const typeDefs = gql`
  type FieldMapping {
    enabled: Boolean
    fields: [String]
  }

  type DestinationMappings {
    people: FieldMapping
    organizations: FieldMapping
  }

  type RateLimits {
    requestsPerInterval: Int
    intervalMs: Int
  }

  type Destination {
    _id: ID!
    name: String!
    status: String!
    tokenId: String!
    destinationType: String!
    targetSystem: String!
    rateLimits: RateLimits!
    mappings: DestinationMappings!
    listenerIds: [String]
    createdAt: String
    updatedAt: String
  }

  input RateLimitsInput {
    requestsPerInterval: Int
    intervalMs: Int
  }

  input FieldMappingInput {
    enabled: Boolean
    fields: [String]
  }

  input DestinationMappingsInput {
    people: FieldMappingInput
    organizations: FieldMappingInput
  }

  extend type Query {
    destinations(workspaceId: String, workspaceSlug: String, id: ID): [Destination]
  }
`;

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

// Resolver for the destinations query
const resolvers = {
  destinations: async (_, { workspaceId, id }, { user }) => {
    console.log('Destination query params:', { workspaceId, id });
    
    try {
      if (user && (user.sub)) {
        console.log('User authenticated:', user.sub);
        
        const member = await Member.findOne({ workspaceId, userId: user.sub,
          permissions: "query:destinations"
        });

        if (member) {
          console.log('User authorized to query destinations');
          
          const datalake = await createConnection(workspaceId);
          const DestinationModel = datalake.model('Destination');
          
          let destinations;
          if (id) {
            console.log('Fetching specific destination with ID:', id);
            // If ID is provided, fetch a specific destination
            const destination = await DestinationModel.findOne({ _id: id });
            destinations = destination ? [destination] : [];
          } else {
            console.log('Fetching all destinations');
            // Fetch all destinations for this workspace
            destinations = await DestinationModel.find();
          }

          console.log(`Found ${destinations.length} destinations`);
          
          // Format dates as ISO strings for all destinations
          destinations = destinations.map(dest => {
            // Convert to plain object if it's a Mongoose document
            const plainDest = dest.toObject ? dest.toObject() : { ...dest };
            
            // Format dates as ISO strings
            if (plainDest.createdAt) {
              plainDest.createdAt = new Date(plainDest.createdAt).toISOString();
            }
            if (plainDest.updatedAt) {
              plainDest.updatedAt = new Date(plainDest.updatedAt).toISOString();
            }
            
            return plainDest;
          });
          
          await datalake.close();
          return destinations;
        } else {
          console.error('User not authorized to query destinations');
          return [];
        }
      } else {
        console.error('User not authenticated');
        return [];
      }
    } catch (error) {
      console.error('Error fetching destinations:', error);
      throw error;
    }
  }
};

module.exports = { typeDefs, resolvers }; 
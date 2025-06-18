const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const { Member } = require('../member');

// Define the typeDefs (schema)
const typeDefs = gql`
  type Collection {
    name: String!
    storageSize: Float!
    size: Float!
    avgObjSize: Float!
    documentCount: Int!
  }
`;

// Define the resolvers
const resolvers = {
  collections: async (_, { workspaceId }, { user }) => {
    if (user && (user.sub)) {
      // Get the user's ID from available properties
      const userId = user.sub;
      
      const member = await Member.findOne({
        workspaceId,
        userId: userId,
        permissions: "query:collections"
      });

      if (member) {
        try {
          // Connect to workspace database
          const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
          const datalake = mongoose.createConnection(dataLakeUri);
          await datalake.asPromise();

          // Get all collections
          const collections = await datalake.db.listCollections().toArray();
          
          // Get stats for each collection using aggregation
          const collectionStats = await Promise.all(
            collections.map(async (collection) => {
              const stats = await datalake.db.collection(collection.name).aggregate([
                { $collStats: { storageStats: {} } }
              ]).toArray();
              const storageStats = stats[0]?.storageStats || {};
              return {
                name: collection.name,
                storageSize: storageStats.storageSize || 0,
                size: storageStats.size || 0,
                avgObjSize: storageStats.avgObjSize || 0,
                documentCount: storageStats.count || 0
              };
            })
          );

          await datalake.close();
          return collectionStats;
        } catch (error) {
          console.error('Error fetching collections:', error);
          throw error;
        }
      } else {
        console.error('User not authorized to query collections');
        return null;
      }
    } else {
      console.error('User not authenticated or userId not found');
      return null;
    }
  }
};

module.exports = { typeDefs, resolvers }; 
const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const { Member } = require('../member');

// Define the typeDefs (schema)
const typeDefs = gql`
  type Object {
    _id: ID!
    data: JSON
  }

  type PaginatedObjects {
    objects: [Object!]!
    totalCount: Int!
    hasNextPage: Boolean!
  }
`;

// Define the resolvers
const resolvers = {
  objects: async (_, { workspaceId, collectionName, objectId, page = 1, limit = 20 }, { user }) => { 
    if (user && (user.sub)) {
      let hasPermission = false;
      let effectiveWorkspaceId = workspaceId;
      
      // For API key requests, bypass member check since permissions are validated by API gateway
      if (user.bypassMemberCheck) {
        // For API keys, enforce the workspace restriction
        if (user.restrictedWorkspaceId) {
          if (workspaceId && workspaceId !== user.restrictedWorkspaceId) {
            console.error(`API key attempted to access workspace ${workspaceId} but is restricted to ${user.restrictedWorkspaceId}`);
            return null;
          }
          // Always use the restricted workspace ID for API keys
          effectiveWorkspaceId = user.restrictedWorkspaceId;
        }
        hasPermission = true;
      } else {
        // Find member with the user's email
        const member = await Member.findOne({ workspaceId, userId: user.sub,
          permissions: "query:objects" // Check if permissions include 'query:objects'
        });
        hasPermission = !!member;
      }

      if (hasPermission) {
        const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${effectiveWorkspaceId}?${process.env.MONGODB_PARAMS}`;
        const datalake = mongoose.createConnection(dataLakeUri);

        try {
          await datalake.asPromise();
          const db = datalake.getClient().db(`workspace_${effectiveWorkspaceId}`);
          const collection = db.collection(collectionName);

          if (objectId) {
            // Query for a single object
            const object = await collection.findOne(
              { _id: new mongoose.Types.ObjectId(objectId) }
            );

            await datalake.close();
            return {
              objects: object ? [{ _id: object._id, data: object }] : [],
              totalCount: object ? 1 : 0,
              hasNextPage: false
            };
          } else {
            // Query for paginated objects
            const skip = (page - 1) * limit;
            
            const [objects, totalCount] = await Promise.all([
              collection
                .find({})
                .skip(skip)
                .limit(limit)
                .toArray(),
              collection.countDocuments()
            ]);

            const formattedObjects = objects.map(obj => ({
              _id: obj._id,
              data: obj
            }));

            await datalake.close();
            return {
              objects: formattedObjects,
              totalCount,
              hasNextPage: skip + limit < totalCount
            };
          }
        } catch (error) {
          console.error('Error fetching objects:', error);
          await datalake.close();
          return null;
        }
      } else {
        console.error('User not authorized to query objects');
        return null;
      }
    } else {
      console.error('User not authenticated or userId not found');
      return null;
    }
  }
};

module.exports = { typeDefs, resolvers }; 
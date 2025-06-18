const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const { Member } = require('../member');

// Define the typeDefs (schema)
const typeDefs = gql`
  type Log {
    _id: ID!
    type: String!
    userId: String
    request: LogRequest!
    response: LogResponse!
    timestamp: String!
  }

  type LogRequest {
    method: String!
    path: String!
    headers: JSON
    body: String
  }

  type LogResponse {
    statusCode: Int!
    error: String
    body: String
  }

  type PaginatedLogs {
    logs: [Log!]!
    totalCount: Int!
    hasNextPage: Boolean!
  }
`;

// Define the resolvers
const resolvers = {
  logs: async (_, { workspaceId, logId, page = 1, limit = 20, type, startDate, endDate }, { user }) => { 
    if (user && (user.sub)) {
      // Find member with the user's email
      const member = await Member.findOne({ workspaceId, userId: user.sub,
        permissions: "query:logs" // Check if permissions include 'query:logs'
      });

      if (member) {
        const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
        const datalake = mongoose.createConnection(dataLakeUri);

        try {
          await datalake.asPromise();
          const db = datalake.getClient().db(`workspace_${workspaceId}`);
          const collection = db.collection('logs');

          // Build query based on filters
          const query = {};
          if (type) query.type = type;
          if (startDate || endDate) {
            query.timestamp = {};
            if (startDate) query.timestamp.$gte = new Date(startDate);
            if (endDate) query.timestamp.$lte = new Date(endDate);
          }

          if (logId) {
            // Query for a single log
            const log = await collection.findOne(
              { _id: new mongoose.Types.ObjectId(logId) }
            );

            await datalake.close();
            return {
              logs: log ? [log] : [],
              totalCount: log ? 1 : 0,
              hasNextPage: false
            };
          } else {
            // Query for paginated logs
            const skip = (page - 1) * limit;
            
            const [logs, totalCount] = await Promise.all([
              collection
                .find(query)
                .sort({ timestamp: -1 }) // Sort by timestamp descending
                .skip(skip)
                .limit(limit)
                .toArray(),
              collection.countDocuments(query)
            ]);

            await datalake.close();
            return {
              logs,
              totalCount,
              hasNextPage: skip + limit < totalCount
            };
          }
        } catch (error) {
          console.error('Error fetching logs:', error);
          await datalake.close();
          return null;
        }
      } else {
        console.error('User not authorized to query logs');
        return null;
      }
    } else {
      console.error('User not authenticated or userId not found');
      return null;
    }
  }
};

module.exports = { typeDefs, resolvers }; 
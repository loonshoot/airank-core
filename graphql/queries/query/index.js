const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const { Member } = require('../member');

// Define the Query Model
const Query = (workspaceId) => {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  const datalake = mongoose.createConnection(dataLakeUri);

  return datalake.model('Query', new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    description: { type: String },
    query: { type: String, required: true },
    schedule: { type: String }, // Optional cron schedule
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    createdBy: { type: String, required: true },
    lastModifiedBy: { type: String, required: true }
  }));
};

// Define the typeDefs (schema)
const typeDefs = gql`
  type StoredQuery {
    _id: ID!
    name: String!
    description: String
    query: String!
    schedule: String
    createdAt: String!
    updatedAt: String!
    createdBy: String!
    lastModifiedBy: String!
  }

  type PaginatedQueries {
    queries: [StoredQuery]!
    totalCount: Int!
    hasMore: Boolean!
  }
`;

// Define the resolvers
const resolvers = {
  queries: async (_, { workspaceId, queryId, page = 1, limit = 15 }, { user }) => {
    if (user && (user.sub)) {
      // Find member with the user's email
      const member = await Member.findOne({ workspaceId, userId: user.sub,
        permissions: "query:query"
      });

      if (member) {
        const QueryModel = Query(workspaceId);
        
        if (queryId) {
          // Find a specific query by id
          const query = await QueryModel.findOne({ _id: queryId });
          return {
            queries: query ? [query] : [],
            totalCount: query ? 1 : 0,
            hasMore: false
          };
        } else {
          // Find all queries with pagination
          const skip = (page - 1) * limit;
          const [queries, totalCount] = await Promise.all([
            QueryModel.find().sort({ updatedAt: -1 }).skip(skip).limit(limit),
            QueryModel.countDocuments()
          ]);
          
          return {
            queries,
            totalCount,
            hasMore: skip + queries.length < totalCount
          };
        }
      } else {
        console.error('User not authorized to query stored queries');
        return null;
      }
    } else {
      console.error('User not authenticated or userId not found');
      return null;
    }
  }
};

module.exports = { typeDefs, resolvers, Query }; 
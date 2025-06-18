// src/source/index.js
const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const { Member } = require('../member');

// Define the Source Model
const Source = (workspaceId) => {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  const datalake = mongoose.createConnection(dataLakeUri);

  return datalake.model('Source', new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, required: true },
    status: { type: String, required: true, default: 'active' },
    name: { type: String, required: true },
    whitelistedIp: { type: [String], required: true },
    bearerToken: { type: String, required: true },
    streamRoute: { type: Boolean },
    sourceType: { type: String, required: true },
    datalakeCollection: { type: String, required: true },
    matchingField: { type: String, default: '' },
    batchConfig: { type: mongoose.Schema.Types.Mixed }
  }));
};

// Define the typeDefs (schema)
const typeDefs = gql`
  type Source {
    _id: String!
    status: String!
    name: String!
    whitelistedIp: [String]
    streamRoute: Boolean
    tokenId: String
    sourceType: String!
    datalakeCollection: String
    matchingField: String
    batchConfig: JSON
  }
`;

// Define the resolvers
const resolvers = {
  sources: async (_, { workspaceId, sourceId }, { user }) => { 
    if (user && (user.sub)) {
      // Get the user's ID from available properties
      const userId = user.sub;
      
      // Find member with the user's userId
      const member = await Member.findOne({ 
        workspaceId, 
        userId: userId,
        permissions: "query:sources" // Check if permissions include 'query:sources'
      });
      
      if (member) { // If member found and has permission
        const SourceModel = Source(workspaceId);
        if (sourceId) {
          // Find a specific source by id
          const source = await SourceModel.findOne({ _id: sourceId });
          return source ? [ source ] : []; 
        } else {
          // Find all sources
          const sources = await SourceModel.find();
          return sources;
        }
      } else {
        console.error('User not authorized to query sources');
        return null;
      }
    } else {
      console.error('User not authenticated or userId not found');
      return null;
    }
  }
};

module.exports = { typeDefs, resolvers };
const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const { Member } = require('../member');

// Define the ApiKey Model
const ApiKey = (workspaceId) => {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  const datalake = mongoose.createConnection(dataLakeUri);

  return datalake.model('ApiKey', new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, required: true },
    bearer: { type: String, required: true, unique: true },
    permissions: { type: [String], required: true },
    name: { type: String, required: true },
    allowedIps: { type: [String], default: [] },
    allowedDomains: { type: [String], default: [] },
    workspace: { type: String, required: true },
    createdBy: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }), 'apiKeys');
};

// Define the typeDefs (schema)
const typeDefs = gql`
  type ApiKey {
    _id: String!
    bearer: String!
    permissions: [String!]!
    name: String!
    allowedIps: [String!]!
    allowedDomains: [String!]!
    workspace: String!
    createdBy: String!
    createdAt: String!
  }
`;

// Define the resolvers
const resolvers = {
  apiKeys: async (_, { workspaceId }, { user }) => { 
    if (user && (user.sub)) {
      // Get the user's ID from available properties
      const userId = user.sub;
      
      // Find member with the user's userId
      const member = await Member.findOne({ 
        workspaceId, 
        userId: userId,
        permissions: "query:apiKeys" // Use existing token permission for API keys
      });
      
      if (member) { // If member found and has permission
        const ApiKeyModel = ApiKey(workspaceId);
        // Find all API keys for this workspace
        const apiKeys = await ApiKeyModel.find();
        return apiKeys.map(apiKey => ({
          ...apiKey.toObject(),
          _id: apiKey._id.toString(),
          createdAt: apiKey.createdAt.toISOString()
        }));
      } else {
        console.error('User not authorized to query API keys');
        return null;
      }
    } else {
      console.error('User not authenticated or userId not found');
      return null;
    }
  }
};

module.exports = { typeDefs, resolvers }; 
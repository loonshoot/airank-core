const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const { Member } = require('../member');

// Define the Model factory for workspace-specific connections
const Model = (workspaceId) => {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  const datalake = mongoose.createConnection(dataLakeUri);

  return datalake.model('Model', new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    provider: { type: String, required: true },
    modelId: { type: String, required: true },
    isEnabled: { type: Boolean, required: true, default: true },
    workspaceId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  }));
};

// Define the typeDefs (schema)
const typeDefs = gql`
  type Model {
    _id: ID!
    name: String!
    provider: String!
    modelId: String!
    isEnabled: Boolean!
    workspaceId: String!
    createdAt: String
    updatedAt: String
  }
`;

// Define the resolvers
const resolvers = {
  models: async (_, { workspaceId, modelId }, { user }) => {
    if (user && user.sub) {
      const userId = user.sub;
      
      // Find member with the user's userId
      const member = await Member.findOne({
        workspaceId,
        userId: userId,
        permissions: "query:models"
      });
      
      if (member) {
        const ModelModel = Model(workspaceId);
        if (modelId) {
          const model = await ModelModel.findOne({ _id: modelId });
          return model ? [model] : [];
        } else {
          const models = await ModelModel.find({ workspaceId });
          return models;
        }
      } else {
        console.error('User not authorized to query models');
        return null;
      }
    } else {
      console.error('User not authenticated or userId not found');
      return null;
    }
  }
};

module.exports = { typeDefs, resolvers }; 
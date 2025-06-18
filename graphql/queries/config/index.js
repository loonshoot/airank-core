const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const { Member } = require('../member');

// Define the Config Model
const Config = (workspaceId) => {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  const datalake = mongoose.createConnection(dataLakeUri);

  const historySchema = new mongoose.Schema({
    userId: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    timestamp: { type: Date, default: Date.now }
  });

  return datalake.model('Config', new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, required: true },
    configType: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    updatedAt: { type: Date, default: Date.now },
    history: [historySchema]
  }));
};

// Define the typeDefs (schema)
const typeDefs = gql`
  type HistoryEntry {
    userId: String!
    data: JSON!
    timestamp: String!
  }

  type Config {
    _id: String!
    configType: String!
    data: JSON!
    updatedAt: String!
    history: [HistoryEntry!]
  }
`;

// Define the resolvers
const resolvers = {
  configs: async (_, { workspaceId }, { user }) => {
    if (user && (user.sub)) {
      // Find member with the user's email
      const member = await Member.findOne({ workspaceId, userId: user.sub,
        permissions: "query:config"
      });

      if (member) {
        const ConfigModel = Config(workspaceId);
        const configs = await ConfigModel.find();
        return configs;
      } else {
        console.error('User not authorized to query config');
        return null;
      }
    } else {
      console.error('User not authenticated or userId not found');
      return null;
    }
  }
};

module.exports = { typeDefs, resolvers }; 
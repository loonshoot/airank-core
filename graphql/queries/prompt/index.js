const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const { Member } = require('../member');

// Define the Prompt Model factory for workspace-specific connections
const Prompt = (workspaceId) => {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  const datalake = mongoose.createConnection(dataLakeUri);

  return datalake.model('Prompt', new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, required: true },
    phrase: { type: String, required: true },
    workspaceId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  }));
};

// Define the typeDefs (schema)
const typeDefs = gql`
  type Prompt {
    _id: ID!
    phrase: String!
    workspaceId: String!
    createdAt: String
    updatedAt: String
  }
`;

// Define the resolvers
const resolvers = {
  prompts: async (_, { workspaceId, promptId }, { user }) => {
    console.log('Prompts query called with:', { workspaceId, promptId, user: user?.sub });
    
    if (user && user.sub) {
      const userId = user.sub;
      
      // Find member with the user's userId
      console.log('Looking for member with:', { workspaceId, userId, permission: "query:prompts" });
      const member = await Member.findOne({
        workspaceId,
        userId: userId,
        permissions: "query:prompts"
      });
      
      console.log('Member found:', member ? 'YES' : 'NO', member?._id);
      
      if (member) {
        const PromptModel = Prompt(workspaceId);
        if (promptId) {
          const prompt = await PromptModel.findOne({ _id: promptId });
          console.log('Single prompt query result:', prompt ? 'FOUND' : 'NOT FOUND');
          return prompt ? [prompt] : [];
        } else {
          const prompts = await PromptModel.find({ workspaceId });
          console.log('All prompts query result:', prompts?.length || 0, 'prompts found');
          return prompts;
        }
      } else {
        console.error('User not authorized to query prompts');
        return null;
      }
    } else {
      console.error('User not authenticated or userId not found');
      return null;
    }
  }
};

module.exports = { typeDefs, resolvers }; 
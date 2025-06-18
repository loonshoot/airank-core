// src/workspace/index.js
const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const { Member } = require('../member');

// Define the Workspace Model
const Workspace = mongoose.model('Workspace', new mongoose.Schema({
  _id: { type: String, required: true }, // Use String for custom _id
  workspaceCode: { type: String, required: true },
  inviteCode: { type: String, required: true },
  creatorId: { type: String, required: true },
  chargebeeSubscriptionId: { type: String, required: true },
  chargebeeCustomerId: { type: String, required: true },
  name: { type: String, required: true },
  slug: { type: String, required: true },
  createdAt: { type: Date, required: true },
  updatedAt: { type: Date, required: true }
}));

// Define the typeDefs (schema)
const typeDefs = gql`
  type Workspace {
    _id: String!
    workspaceCode: String!
    inviteCode: String!
    creatorId: String!
    chargebeeSubscriptionId: String!
    chargebeeCustomerId: String!
    name: String!
    slug: String!
    createdAt: String!
    updatedAt: String!
  }
`;

// Define the resolvers
const resolvers = {
    workspace: async (_, { workspaceId }, { user }) => { 
      if (user) {
        
  
        // Find member with the user's userId
        const member = await Member.findOne({ 
          workspaceId, 
          userId: user.sub,
          permissions: "query:workspaces" // Check if permissions include 'query:workspaces'
        });

        if (member) { // If member found and has permission
          const workspace = await Workspace.findOne({ _id: workspaceId });
          if (!workspace) {
            console.error(`Workspace with ID ${workspaceId} not found`);
            return null;
          }
          return workspace;
        } else {
          console.error('User not authorized to query members');
          return null;
        }
      } else {
        console.error('User not authenticated');
        return null;
      }
    }
};

module.exports = { typeDefs, resolvers };
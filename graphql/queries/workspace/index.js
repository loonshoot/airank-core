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
  chargebeeSubscriptionId: { type: String }, // Legacy - no longer required
  chargebeeCustomerId: { type: String }, // Legacy - no longer required
  billingProfileId: { type: String }, // Current billing profile (can change in advanced mode)
  defaultBillingProfileId: { type: String }, // Original auto-created billing profile (cannot be deleted or shared)
  config: {
    advancedBilling: { type: Boolean, default: false } // Workspace-specific billing mode
  },
  name: { type: String, required: true },
  slug: { type: String, required: true },
  createdAt: { type: Date, required: true },
  updatedAt: { type: Date, required: true }
}));

// Define the typeDefs (schema)
const typeDefs = gql`
  type WorkspaceConfig {
    advancedBilling: Boolean
  }

  type Workspace {
    _id: String!
    workspaceCode: String!
    inviteCode: String!
    creatorId: String!
    chargebeeSubscriptionId: String # Legacy
    chargebeeCustomerId: String # Legacy
    billingProfileId: String
    defaultBillingProfileId: String
    config: WorkspaceConfig
    name: String!
    slug: String!
    createdAt: String!
    updatedAt: String!
    billingProfile: BillingProfile # Resolver to fetch billing profile
    defaultBillingProfile: BillingProfile # Resolver to fetch default billing profile
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
    },

    // Field resolvers for Workspace type
    Workspace: {
      billingProfile: async (workspace) => {
        if (!workspace.billingProfileId) return null;
        const { BillingProfile } = require('../billingProfile');
        return await BillingProfile().findById(workspace.billingProfileId);
      },
      defaultBillingProfile: async (workspace) => {
        if (!workspace.defaultBillingProfileId) return null;
        const { BillingProfile } = require('../billingProfile');
        return await BillingProfile().findById(workspace.defaultBillingProfileId);
      }
    }
};

module.exports = { typeDefs, resolvers, Workspace: () => Workspace };
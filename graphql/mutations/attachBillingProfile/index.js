const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');

const typeDefs = gql`
  extend type Mutation {
    attachBillingProfile(workspaceId: String!, billingProfileId: String!): Workspace
  }
`;

const resolvers = {
  attachBillingProfile: async (_, { workspaceId, billingProfileId }, { user }) => {
    if (!user) throw new Error('Authentication required');

    // Check user is workspace owner
    const Member = mongoose.model('Member');
    const member = await Member.findOne({
      workspaceId,
      userId: user.sub || user._id,
      teamRole: 'OWNER'
    });

    if (!member) {
      throw new Error('Only workspace owners can attach billing profiles');
    }

    // Check user is manager of billing profile
    const { BillingProfileMember } = require('../../queries/billingProfile');
    const billingMember = await BillingProfileMember().findOne({
      billingProfileId,
      userId: user.sub || user._id,
      role: 'manager'
    });

    if (!billingMember) {
      throw new Error('Only billing profile managers can attach it to workspaces');
    }

    // Update workspace with billing profile
    const Workspace = mongoose.model('Workspace');
    const workspace = await Workspace.findOneAndUpdate(
      { _id: workspaceId },
      {
        billingProfileId,
        updatedAt: new Date()
      },
      { new: true }
    );

    if (!workspace) {
      throw new Error('Workspace not found');
    }

    return workspace;
  }
};

module.exports = { typeDefs, resolvers };

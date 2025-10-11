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

    try {
      // Connect to the airank database
      const airankUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
      const airankDb = mongoose.createConnection(airankUri);
      await airankDb.asPromise();

      // Check user has permission to update workspace config
      const membersCollection = airankDb.collection('members');
      const member = await membersCollection.findOne({
        workspaceId,
        userId: user.sub,
        permissions: 'mutation:updateConfig'
      });

      if (!member) {
        await airankDb.close();
        throw new Error('Unauthorized: You do not have permission to update workspace config');
      }

      // Get workspace
      const workspacesCollection = airankDb.collection('workspaces');
      const workspace = await workspacesCollection.findOne({ _id: workspaceId });

      if (!workspace) {
        await airankDb.close();
        throw new Error('Workspace not found');
      }

      // Check if workspace is in advanced billing mode by checking configs collection
      const workspaceDbUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
      const workspaceDb = mongoose.createConnection(workspaceDbUri);
      await workspaceDb.asPromise();

      const billingConfig = await workspaceDb.collection('configs').findOne({ configType: 'billing' });

      if (!billingConfig?.data?.advancedBilling) {
        await airankDb.close();
        await workspaceDb.close();
        throw new Error('Workspace must be in advanced billing mode to attach billing profiles');
      }

      await workspaceDb.close();

      // Verify user has access to the billing profile
      const billingProfileMembersCollection = airankDb.collection('billingprofilemembers');
      const billingProfileMember = await billingProfileMembersCollection.findOne({
        billingProfileId,
        userId: user.sub
      });

      if (!billingProfileMember) {
        await airankDb.close();
        throw new Error('Unauthorized: You do not have access to this billing profile');
      }

      // Prevent using default billing profile from another workspace
      const otherWorkspace = await workspacesCollection.findOne({
        defaultBillingProfileId: billingProfileId,
        _id: { $ne: workspaceId }
      });

      if (otherWorkspace) {
        await airankDb.close();
        throw new Error('Cannot use default billing profile from another workspace');
      }

      // Update workspace billing profile
      await workspacesCollection.updateOne(
        { _id: workspaceId },
        {
          $set: {
            billingProfileId,
            updatedAt: new Date()
          }
        }
      );

      // Fetch updated workspace
      const updatedWorkspace = await workspacesCollection.findOne({ _id: workspaceId });

      await airankDb.close();
      return updatedWorkspace;
    } catch (error) {
      console.error('Error attaching billing profile:', error);
      throw error;
    }
  }
};

module.exports = { typeDefs, resolvers };

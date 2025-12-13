// graphql/queries/pendingInvitations/index.js
const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');

const typeDefs = gql`
  type PendingInvitation {
    _id: String!
    workspaceId: String!
    workspaceName: String
    inviter: String!
    inviterEmail: String
    invitedAt: String!
    permissions: [String]
  }

  type Query {
    pendingInvitations: [PendingInvitation]
  }
`;

const resolvers = {
  pendingInvitations: async (_, __, { user }) => {
    if (!user || !user.sub) {
      throw new Error('Authentication required');
    }

    const Member = mongoose.models.Member || mongoose.model('Member');
    const Workspace = mongoose.models.Workspace || mongoose.model('Workspace');
    const User = mongoose.models.User || mongoose.model('User');

    // Get the user's email from airank.users (trusted source, not JWT)
    const airankUser = await User.findOne({ _id: user.sub });
    if (!airankUser || !airankUser.email) {
      throw new Error('User not found');
    }

    // Find pending invitations by userId OR by email (from trusted DB)
    // This handles the case where user was already logged in when invited
    // (sign-in merge didn't happen because session was already active)
    const pendingMembers = await Member.find({
      $or: [
        { userId: user.sub },
        { email: airankUser.email }
      ],
      status: 'PENDING',
      deletedAt: null
    });

    // Enrich with workspace names and inviter emails
    const invitations = await Promise.all(
      pendingMembers.map(async (member) => {
        const workspace = await Workspace.findOne({ _id: member.workspaceId });
        const inviterUser = await User.findOne({ _id: member.inviter });

        return {
          _id: member._id,
          workspaceId: member.workspaceId,
          workspaceName: workspace?.name || 'Unknown Workspace',
          inviter: member.inviter,
          inviterEmail: inviterUser?.email || null,
          invitedAt: member.invitedAt,
          permissions: member.permissions
        };
      })
    );

    return invitations;
  }
};

module.exports = { typeDefs, resolvers };

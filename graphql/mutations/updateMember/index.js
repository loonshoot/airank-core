// airank-core/graphql/mutations/updateMember/index.js
const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');

const typeDefs = gql`
  type Mutation {
    updateMember(
      workspaceId: String!
      memberId: String!
      permissions: [String]!
    ): Member
  }
`;

async function updateMember(parent, args, { user }) {
  if (!user?.sub) {
    throw new Error('Authentication required');
  }

  const { workspaceId, memberId, permissions } = args;
  const Member = mongoose.model('Member');
  const User = mongoose.model('User');

  try {
    // Check if the current user has permission to update members
    const currentMember = await Member.findOne({
      workspaceId,
      userId: user.sub,
      deletedAt: null,
      $or: [
        { permissions: { $in: ['mutation:updateMember'] } },
        { teamRole: 'OWNER' }
      ]
    });

    if (!currentMember) {
      throw new Error('Forbidden: You do not have permission to update members');
    }

    // Find the member to update
    const memberToUpdate = await Member.findOne({
      _id: memberId,
      workspaceId,
      deletedAt: null
    });

    if (!memberToUpdate) {
      throw new Error('Member not found');
    }

    // Prevent updating PENDING members
    if (memberToUpdate.status === 'PENDING') {
      throw new Error('Cannot update permissions for a pending member');
    }

    // Prevent updating own permissions
    if (memberToUpdate.userId === user.sub) {
      throw new Error('Cannot update your own permissions');
    }

    // Prevent updating OWNER members unless you're also an owner
    if (memberToUpdate.teamRole === 'OWNER' && currentMember.teamRole !== 'OWNER') {
      throw new Error('Cannot update owner permissions');
    }

    // Update the member
    const updatedMember = await Member.findOneAndUpdate(
      {
        _id: memberId,
        workspaceId,
        deletedAt: null
      },
      {
        $set: {
          permissions,
          updatedAt: new Date()
        }
      },
      { new: true }
    );

    if (!updatedMember) {
      throw new Error('Failed to update member');
    }

    // Get the user's email
    const userDoc = await User.findOne({ _id: updatedMember.userId });

    return {
      ...updatedMember.toObject(),
      email: userDoc?.email || updatedMember.email
    };
  } catch (error) {
    console.error('Error updating member:', error);
    throw error;
  }
}

module.exports = { typeDefs, updateMember };

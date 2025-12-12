// airank-core/graphql/mutations/deleteMember/index.js
const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');

const typeDefs = gql`
  input DeleteMemberInput {
    workspaceId: String!
    memberId: String!
  }

  type MemberDeletionResponse {
    _id: String!
    status: String!
    deletedAt: String
  }

  type Mutation {
    deleteMember(input: DeleteMemberInput!): MemberDeletionResponse
  }
`;

async function deleteMember(parent, { input }, { user }) {
  if (!user || !user.sub) {
    throw new Error('Authentication required');
  }

  const { workspaceId, memberId } = input;
  const Member = mongoose.model('Member');

  try {
    // Check if the user has permission to delete members
    const currentMember = await Member.findOne({
      workspaceId: workspaceId,
      userId: user.sub,
      deletedAt: null,
      $or: [
        { permissions: { $in: ['mutation:deleteMember'] } },
        { teamRole: 'OWNER' }
      ]
    });

    if (!currentMember) {
      throw new Error('Forbidden: You do not have permission to remove members');
    }

    // Find the member to delete
    const memberToDelete = await Member.findOne({
      _id: memberId,
      workspaceId: workspaceId,
      deletedAt: null
    });

    if (!memberToDelete) {
      throw new Error('Member not found');
    }

    // Prevent deleting yourself
    if (memberToDelete.userId === user.sub) {
      throw new Error('Cannot remove your own member account');
    }

    // Prevent deleting OWNER members unless you're also an owner
    if (memberToDelete.teamRole === 'OWNER' && currentMember.teamRole !== 'OWNER') {
      throw new Error('Cannot remove workspace owners');
    }

    // Soft delete the member by setting deletedAt
    const updatedMember = await Member.findOneAndUpdate(
      { _id: memberId, workspaceId: workspaceId },
      {
        $set: {
          deletedAt: new Date(),
          updatedAt: new Date(),
          status: 'DELETED'
        }
      },
      { new: true }
    );

    if (!updatedMember) {
      throw new Error('Failed to remove member');
    }

    // Return the deletion response format
    return {
      _id: updatedMember._id,
      status: 'DELETED',
      deletedAt: updatedMember.deletedAt.toISOString()
    };
  } catch (error) {
    console.error('Error deleting member:', error);
    throw error;
  }
}

module.exports = { typeDefs, deleteMember };

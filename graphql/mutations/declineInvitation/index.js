// graphql/mutations/declineInvitation/index.js
const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');

const typeDefs = gql`
  type Mutation {
    declineInvitation(invitationId: ID!): Boolean
  }
`;

async function declineInvitation(parent, { invitationId }, { user }) {
  if (!user || !user.sub) {
    throw new Error('Authentication required');
  }

  const Member = mongoose.models.Member || mongoose.model('Member');

  // Find the invitation - must belong to this user and be PENDING
  // Uses user.sub directly since signIn event merges placeholder user IDs
  const invitation = await Member.findOne({
    _id: invitationId,
    userId: user.sub,
    status: 'PENDING',
    deletedAt: null
  });

  if (!invitation) {
    throw new Error('Invitation not found or already processed');
  }

  // Soft delete the member record (decline)
  await Member.findOneAndUpdate(
    { _id: invitationId },
    {
      $set: {
        status: 'DECLINED',
        deletedAt: new Date(),
        updatedAt: new Date()
      }
    }
  );

  return true;
}

module.exports = { typeDefs, declineInvitation };

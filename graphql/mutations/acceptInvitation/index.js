// graphql/mutations/acceptInvitation/index.js
const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');

const typeDefs = gql`
  type Mutation {
    acceptInvitation(invitationId: ID!): Boolean
  }
`;

async function acceptInvitation(parent, { invitationId }, { user }) {
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

  // Update the member status to ACCEPTED
  await Member.findOneAndUpdate(
    { _id: invitationId },
    {
      $set: {
        status: 'ACCEPTED',
        joinedAt: new Date(),
        updatedAt: new Date()
      }
    }
  );

  return true;
}

module.exports = { typeDefs, acceptInvitation };

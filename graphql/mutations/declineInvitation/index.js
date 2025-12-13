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
  const User = mongoose.models.User || mongoose.model('User');

  // Get the user's email from airank.users (trusted source)
  const airankUser = await User.findOne({ _id: user.sub });
  if (!airankUser || !airankUser.email) {
    throw new Error('User not found');
  }

  // Find the invitation by userId OR email (from trusted DB)
  const invitation = await Member.findOne({
    _id: invitationId,
    $or: [
      { userId: user.sub },
      { email: airankUser.email }
    ],
    status: 'PENDING',
    deletedAt: null
  });

  if (!invitation) {
    throw new Error('Invitation not found or already processed');
  }

  // If invitation was found by email (placeholder userId), clean up placeholder user
  if (invitation.userId !== user.sub) {
    await User.deleteOne({ _id: invitation.userId });
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

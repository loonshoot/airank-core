// graphql/src/member/index.js
const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');

// Define the Member Model
const Member = mongoose.model('Member', new mongoose.Schema({
  _id: { type: String, required: true },
  workspaceId: { type: String, required: true },
  userId: { type: String, required: true },
  email: { type: String },
  inviter: { type: String, required: true },
  invitedAt: { type: Date, required: true },
  joinedAt: { type: Date },
  updatedAt: { type: Date, required: true },
  deletedAt: { type: Date, default: null },
  status: { type: String, required: true, default: 'PENDING' },
  teamRole: { type: String, required: true, default: 'MEMBER' },
  permissions: [{ type: String }]
}, { _id: false }));

// Define the typeDefs (schema)
const typeDefs = gql`
  type Member {
    _id: String!
    workspaceId: String!
    userId: String!
    email: String
    inviter: String!
    invitedAt: String!
    joinedAt: String
    updatedAt: String!
    status: String!
    teamRole: String!
    permissions: [String]
    name: String
  }
`;

// Define the resolvers
const resolvers = {
  members: async (_, { workspaceId }, { user }) => {
    if (!user) {
      console.error('User not authenticated');
      throw new Error('Unauthorized: You must be authenticated to access members.');
    }

    // Find member with the user's userId
    const member = await Member.findOne({
      workspaceId,
      userId: user.sub,
      deletedAt: null,
      $or: [
        { permissions: "query:members" },
        { teamRole: 'OWNER' }
      ]
    });

    if (!member) {
      console.error('User not authorized to query members');
      throw new Error('Forbidden: You are not authorized to access members.');
    }

    // Get all non-deleted members
    const members = await Member.find({
      workspaceId,
      deletedAt: null
    });

    // Populate email and name for each member from User collection
    const User = mongoose.model('User');
    const membersWithDetails = await Promise.all(
      members.map(async (memberDoc) => {
        const userDoc = await User.findOne({ _id: memberDoc.userId });
        return {
          ...memberDoc.toObject(),
          email: userDoc?.email || memberDoc.email || null,
          name: userDoc?.name || null
        };
      })
    );

    return membersWithDetails;
  }
};

module.exports = { typeDefs, resolvers, Member };

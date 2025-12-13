// graphql/src/member/index.js
const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');

// Define the User Model (created by Prisma in MongoDB, registered here for Mongoose access)
const UserSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  userCode: { type: String },
  email: { type: String },
  emailVerified: { type: Date },
  createdAt: { type: Date },
  updatedAt: { type: Date }
}, { _id: false, collection: 'users' });

const User = mongoose.models.User || mongoose.model('User', UserSchema);

// Define the Member Model
const Member = mongoose.models.Member || mongoose.model('Member', new mongoose.Schema({
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
    teamRole: String
    permissions: [String]
    name: String
    isCurrentUser: Boolean
  }
`;

// Define the resolvers
const resolvers = {
  members: async (_, { workspaceId }, { user }) => {
    console.log('=== MEMBERS QUERY DEBUG ===');
    console.log('workspaceId received:', workspaceId);
    console.log('user:', user ? { sub: user.sub, email: user.email } : 'null');

    if (!user) {
      console.error('User not authenticated');
      throw new Error('Unauthorized: You must be authenticated to access members.');
    }

    // Debug: Check what's in the database
    const allMembers = await Member.find({});
    console.log('Total members in DB:', allMembers.length);
    console.log('Sample member:', allMembers[0] ? { workspaceId: allMembers[0].workspaceId, userId: allMembers[0].userId } : 'none');

    // Find current user's member record - only check permissions array
    const currentMember = await Member.findOne({
      workspaceId,
      userId: user.sub,
      deletedAt: null,
      permissions: { $in: ['query:members'] }
    });

    console.log('currentMember found:', currentMember ? { _id: currentMember._id, userId: currentMember.userId } : 'null');

    if (!currentMember) {
      console.error('User not authorized to query members - workspaceId:', workspaceId, 'userId:', user.sub);
      throw new Error('Forbidden: You are not authorized to access members.');
    }

    // Get all non-deleted members
    const members = await Member.find({
      workspaceId,
      deletedAt: null
    });

    console.log('Members found for workspace:', members.length);

    // Populate email from User collection
    const membersWithDetails = await Promise.all(
      members.map(async (memberDoc) => {
        const userDoc = await User.findOne({ _id: memberDoc.userId });
        const isCurrentUser = memberDoc.userId === user.sub;
        // Get email from user doc or member doc
        const email = userDoc?.email || memberDoc.email || null;
        // Derive name from email if available
        const name = email ? email.split('@')[0] : null;
        return {
          ...memberDoc.toObject(),
          email,
          name,
          isCurrentUser
        };
      })
    );

    return membersWithDetails;
  }
};

module.exports = { typeDefs, resolvers, Member };

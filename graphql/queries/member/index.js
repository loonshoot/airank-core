// graphql/src/member/index.js
const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');

// Define the Member Model
const Member = mongoose.model('Member', new mongoose.Schema({
  _id: { type: String, required: true },
  workspaceId: { type: String, required: true },
  userId: { type: String, required: true },
  inviter: { type: String, required: true },
  invitedAt: { type: Date, required: true },
  updatedAt: { type: Date, required: true },
  status: { type: String, required: true },
  teamRole: { type: String, required: true },
  permissions: [{ type: String }]
}));

// Define the typeDefs (schema)
const typeDefs = gql`
  type Member {
    _id: String!
    workspaceId: String!
    userId: String!
    inviter: String!
    invitedAt: String!
    updatedAt: String!
    status: String!
    teamRole: String!
    permissions: [String]
  }
`;

// Define the resolvers
const resolvers = {
  members: async (_, { workspaceId }, { user }) => {
    if (user) {

      // Find member with the user's userId
      const member = await Member.findOne({ 
        workspaceId, 
        userId: user.sub,
        permissions: "query:members" // Check if permissions include 'query:members'
      });

      if (member) { // If member found and has permission
        const members = await Member.find({ workspaceId });
        return members;
      } else {
        console.error('User not authorized to query members');
        throw new Error('Forbidden: You are not authorized to access members.');
      }
    } else {
      console.error('User not authenticated');
      throw new Error('Unauthorized: You must be authenticated to access members.');
    }
  }
};

module.exports = { typeDefs, resolvers, Member };
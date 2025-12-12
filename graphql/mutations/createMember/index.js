// airank-core/graphql/mutations/createMember/index.js
const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');

const typeDefs = gql`
  input CreateMemberInput {
    workspaceId: String!
    email: String!
    permissions: [String]
  }

  type Mutation {
    createMember(input: CreateMemberInput!): Member
  }
`;

async function createMember(parent, { input }, { user }) {
  if (!user || !user.sub) {
    throw new Error('Authentication required');
  }

  const { workspaceId, email, permissions } = input;
  const Member = mongoose.model('Member');
  const User = mongoose.model('User');

  try {
    // Check if the inviter has permission to create members
    const inviterMember = await Member.findOne({
      workspaceId: workspaceId,
      userId: user.sub,
      permissions: { $in: ['mutation:createMember'] }
    });

    if (!inviterMember) {
      throw new Error('Forbidden: You do not have permission to invite members');
    }

    // Check if user already exists, if not create them
    let targetUser = await User.findOne({ email });

    if (!targetUser) {
      targetUser = await User.create({
        _id: new mongoose.Types.ObjectId().toString(),
        email: email,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }

    // Check if a member record already exists
    const existingMember = await Member.findOne({
      workspaceId: workspaceId,
      userId: targetUser._id
    });

    if (existingMember) {
      // If member was previously deleted, restore them
      if (existingMember.deletedAt) {
        const restoredMember = await Member.findOneAndUpdate(
          { _id: existingMember._id },
          {
            $set: {
              status: 'PENDING',
              permissions: permissions || ['query:workspaces', 'query:members'],
              deletedAt: null,
              updatedAt: new Date(),
              invitedAt: new Date(),
              inviter: user.sub,
              teamRole: 'MEMBER'
            }
          },
          { new: true }
        );
        return {
          ...restoredMember.toObject(),
          email: email
        };
      } else {
        throw new Error('Member already exists in this workspace');
      }
    }

    // Create new member with default permissions
    const defaultPermissions = permissions || [
      'query:workspaces',
      'query:members',
      'query:sources',
      'query:jobs',
      'query:config',
      'query:query',
      'query:rankings',
      'query:reports'
    ];

    const newMember = await Member.create({
      _id: new mongoose.Types.ObjectId().toString(),
      workspaceId: workspaceId,
      userId: targetUser._id,
      email: email,
      inviter: user.sub,
      permissions: defaultPermissions,
      invitedAt: new Date(),
      updatedAt: new Date(),
      status: 'PENDING',
      teamRole: 'MEMBER'
    });

    return {
      ...newMember.toObject(),
      email: email
    };

  } catch (error) {
    console.error('Error creating member:', error);
    throw error;
  }
}

module.exports = { typeDefs, createMember };

// airank-core/graphql/mutations/createMember/index.js
const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const { sendWorkspaceInvitationEmail } = require('../../lib/email');

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
  const Workspace = mongoose.model('Workspace');

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

    // Get workspace name for the invitation email
    const workspace = await Workspace.findOne({ _id: workspaceId });
    const workspaceName = workspace?.name || 'a workspace';

    // Get inviter's email for the invitation
    const inviterUser = await User.findOne({ _id: user.sub });
    const inviterEmail = user.email || inviterUser?.email || 'A team member';
    const inviterName = inviterUser?.name || inviterEmail.split('@')[0];

    // Check if user exists by email, create if not
    let targetUser = await User.findOne({ email });
    if (!targetUser) {
      targetUser = await User.create({
        _id: new mongoose.Types.ObjectId().toString(),
        email: email,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }

    // Check if member already exists in this workspace
    const existingMember = await Member.findOne({
      workspaceId: workspaceId,
      email: email,
      deletedAt: null
    });

    if (existingMember) {
      throw new Error('Member already exists in this workspace');
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

    await sendWorkspaceInvitationEmail({
      to: email,
      name: targetUser.name || email.split('@')[0],
      inviterName: inviterName,
      inviterEmail: inviterEmail,
      workspaceName: workspaceName,
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

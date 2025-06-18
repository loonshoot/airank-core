const { Member } = require('../../queries/member');
const { Query } = require('../../queries/query');
const mongoose = require('mongoose');

async function updateQuery(parent, args, { user }) {
  if (user && (user.sub)) {
    try {
      // Find member with the user's email and permission
      const member = await Member.findOne({
        workspaceId: args.workspaceId,
        email: user.email,
        permissions: "mutation:updateQuery"
      });

      if (member) {
        // Validate inputs
        if (!args.id) {
          throw new Error('Missing required field: id');
        }

        const QueryModel = Query(args.workspaceId);
        const objectId = new mongoose.Types.ObjectId(args.id);

        // Update the query
        const updatedQuery = await QueryModel.findOneAndUpdate(
          { _id: objectId },
          {
            ...(args.name && { name: args.name }),
            ...(args.description !== undefined && { description: args.description }),
            ...(args.query && { query: args.query }),
            ...(args.schedule !== undefined && { schedule: args.schedule }),
            lastModifiedBy: user.email,
            updatedAt: new Date()
          },
          { new: true }
        );

        if (updatedQuery) {
          return updatedQuery;
        } else {
          return null;
        }
      } else {
        console.error('User not authorized to update queries');
        return null;
      }
    } catch (error) {
      console.error('Error updating query:', error);
      throw error;
    }
  } else {
    console.error('User not authenticated');
    return null;
  }
}

module.exports = { updateQuery }; 
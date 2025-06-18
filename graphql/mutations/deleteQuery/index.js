const { Member } = require('../../queries/member');
const { Query } = require('../../queries/query');
const mongoose = require('mongoose');

async function deleteQuery(parent, args, { user }) {
  if (user && (user.sub)) {
    try {
      // Find member with the user's email and permission
      const member = await Member.findOne({
        workspaceId: args.workspaceId,
        email: user.email,
        permissions: "mutation:deleteQuery"
      });

      if (member) {
        // Validate inputs
        if (!args.id) {
          throw new Error('Missing required field: id');
        }

        const QueryModel = Query(args.workspaceId);
        const objectId = new mongoose.Types.ObjectId(args.id);

        // Find and delete the query
        const deletedQuery = await QueryModel.findOneAndDelete({ _id: objectId });

        if (deletedQuery) {
          // Get remaining queries
          const remainingQueries = await QueryModel.find();

          return {
            message: 'Query deleted successfully',
            remainingQueries: remainingQueries
          };
        } else {
          throw new Error('Query not found');
        }
      } else {
        console.error('User not authorized to delete queries');
        return null;
      }
    } catch (error) {
      console.error('Error deleting query:', error);
      throw error;
    }
  } else {
    console.error('User not authenticated');
    return null;
  }
}

module.exports = { deleteQuery }; 
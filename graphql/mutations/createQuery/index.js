const { Member } = require('../../queries/member');
const { Query } = require('../../queries/query');
const mongoose = require('mongoose');

async function createQuery(parent, args, { user }) {
  if (user && (user.sub)) {
    try {
      // Find member with the user's email and permission
      const member = await Member.findOne({
        workspaceId: args.workspaceId,
        email: user.email,
        permissions: "mutation:createQuery"
      });

      if (member) {
        // Validate inputs
        if (!args.name || !args.query) {
          throw new Error('Missing required fields: name, query');
        }

        // Create new query instance
        const QueryModel = Query(args.workspaceId);
        const newQuery = new QueryModel({
          _id: new mongoose.Types.ObjectId(),
          name: args.name,
          description: args.description || '',
          query: args.query,
          schedule: args.schedule || null,
          createdBy: user.email,
          lastModifiedBy: user.email
        });

        // Save the query
        await newQuery.save();

        return newQuery;
      } else {
        console.error('User not authorized to create queries');
        return null;
      }
    } catch (error) {
      console.error('Error creating query:', error);
      throw error;
    }
  } else {
    console.error('User not authenticated');
    return null;
  }
}

module.exports = { createQuery }; 
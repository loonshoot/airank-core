// src/StreamRoute/index.js
const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const { Member } = require('../member');

// Define the StreamRoute Model
const StreamRoute = (workspaceId) => {
  const dataLakeUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
  const datalake = mongoose.createConnection(dataLakeUri);

  return datalake.model('StreamRoute', new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, required: true },
    service: { type: String },
    sourceId: { type: String },
    workspaceId: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed }
  }), "streamRoutes");
};

// Define the typeDefs (schema)
const typeDefs = gql`
  type StreamRoute {
    _id: String
    service: String
    sourceId: String
    workspaceId: String!
    data: JSON
  }
`;

// Define the resolvers
const resolvers = {
  streamRoutes: async (_, { streamRouteId, workspaceId, service, sourceId }, { user }) => { 
    if (user && (user.sub)) {
      // Find member with the user's email
      const member = await Member.findOne({ workspaceId, userId: user.sub,
        permissions: "query:streamRoutes" // Check if permissions include 'query:streamRoutes'
      });
      if (member) { // If member found and has permission
        const StreamRouteModel = StreamRoute(workspaceId);
        // Build query object with only provided parameters
        const query = { workspaceId }; // workspaceId is always required
        
        // Handle both _id and streamRouteId
        if (streamRouteId) query._id = streamRouteId;
        
        if (service) query.service = service;
        if (sourceId) query.sourceId = sourceId;

        // If either _id or streamRouteId was provided, find one
        if (streamRouteId) {
          const streamRoute = await StreamRouteModel.findOne(query);
          return streamRoute ? [streamRoute] : [];
        }
        
        // Otherwise find all matching routes
        const streamRoutes = await StreamRouteModel.find(query);
        return streamRoutes;
      } else {
        console.error('User not authorized to query streamRoutes');
        return null;
      }
    } else {
      console.error('User not authenticated or userId not found');
      return null;
    }
  }
};

module.exports = { typeDefs, resolvers };
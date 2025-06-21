const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const { Member } = require('../member');

// Define the Brand Model factory for workspace-specific connections
const Brand = (workspaceId) => {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  const datalake = mongoose.createConnection(dataLakeUri);

  return datalake.model('Brand', new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    isOwnBrand: { type: Boolean, required: true, default: false },
    workspaceId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  }));
};

// Define the typeDefs (schema)
const typeDefs = gql`
  type Brand {
    _id: ID!
    name: String!
    isOwnBrand: Boolean!
    workspaceId: String!
    createdAt: String
    updatedAt: String
  }
`;

// Define the resolvers
const resolvers = {
  brands: async (_, { workspaceId, brandId }, { user }) => {
    if (user && user.sub) {
      const userId = user.sub;
      
      // Find member with the user's userId
      const member = await Member.findOne({
        workspaceId,
        userId: userId,
        permissions: "query:brands"
      });
      
      if (member) {
        const BrandModel = Brand(workspaceId);
        if (brandId) {
          const brand = await BrandModel.findOne({ _id: brandId });
          return brand ? [brand] : [];
        } else {
          const brands = await BrandModel.find({ workspaceId });
          return brands;
        }
      } else {
        console.error('User not authorized to query brands');
        return null;
      }
    } else {
      console.error('User not authenticated or userId not found');
      return null;
    }
  }
};

module.exports = { typeDefs, resolvers }; 
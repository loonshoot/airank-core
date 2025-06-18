// graphql/queries/token/index.js
const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const { Member } = require('../member');

// Define the Token Model
const Token = mongoose.model('Token', new mongoose.Schema({
  _id: { type: String, required: true },
  externalId: { type: String },
  displayName: { type: String },
  email: { type: String, required: true },
  encryptedAuthToken: { type: String, required: true },
  encryptedRefreshToken: { type: String, required: true },
  service: { type: String, required: true },
  issueTime: { type: Number, required: true }, // Store as milliseconds
  expiryTime: { type: Number, required: true }, // Store as milliseconds
  tokenType: { type: String, required: true },
  scopes: { type: [String], required: true },
  errorMessages: { type: [String], default: [] }, // Changed to errorMessages
  accountsServer: { type: String } // Add accountsServer field for Zoho
}));

// Define the typeDefs (schema)
const typeDefs = gql`
  type Token {
    tokenId: ID
    externalId: String
    displayName: String
    email: String!
    service: String!
    issueTime: Int!
    expiryTime: Int!
    tokenType: String!
    scopes: [String]!
    errorMessages: [String]
    accountsServer: String
  }

  type WorkspaceTokens {
    tokens: [Token]
  }

  type ServiceTokens {
    tokens: [Token]
  }
`;

// Define the resolvers
const resolvers = {
  tokens: async (_, { workspaceId, service, tokenId }, { user }) => { 
    if (user && (user.sub)) {
      // Find member with the user's email
      const member = await Member.findOne({ workspaceId, userId: user.sub,
        permissions: "query:tokens" // Check if permissions include 'query:tokens'
      });
      if (member) { 
        // Connect to the workspace database
        const datalake = await createConnection(workspaceId);

        let tokens;
        if (tokenId) {
          // Fetch the specific token
          tokens = await datalake.model('Token').findOne({ _id: tokenId });
        } else if (service) {
          // Fetch tokens for the specific service
          tokens = await datalake.model('Token').find({ service });
        } else {
          // Fetch all tokens for the workspace
          tokens = await datalake.model('Token').find();
        }

        await datalake.close();

        // Filter out sensitive data
        const filteredTokens = tokens.map(token => ({
          _id: token._id.toString(), // Convert ObjectId to string
          externalId: token.externalId,
          displayName: token.displayName,
          email: token.email,
          service: token.service,
          issueTime: token.issueTime,
          expiryTime: token.expiryTime,
          tokenType: token.tokenType,
          scopes: token.scopes,
          errorMessages: token.errorMessages, // Changed to errorMessages
          accountsServer: token.accountsServer // Add accountsServer field for Zoho
        }));

        // Return tokens with filtered data
        return filteredTokens;
      } else {
        console.error('User not authorized to query tokens');
        return null;
      }
    } else {
      console.error('User not authenticated or userId not found');
      return null;
    }
  }
};

// Function to establish the database connection
async function createConnection(workspaceId) {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;

  const datalake = mongoose.createConnection(dataLakeUri);

  // Register the model on this connection
  datalake.model('Token', Token.schema);

  await datalake.asPromise(); // Wait for connection to establish
  return datalake;
}

module.exports = { typeDefs, resolvers };
// graphql/queries/integration/index.js
const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const { Member } = require('../member');
const { ObjectId } = require('mongoose').Types;

const integrations = {
  'google-search-console': require('./google-search-console'),
  'confluence': require('./confluence')
  // ... add other integrations here
};

const typeDefs = gql`
  type Integration {
    _id: ID!
    name: String!
    tenants: [Tenant]
    token: Token
  }

  type Tenant {
    id: String!
    name: String!
  }

  type Token {
    _id: ID!
    encryptedAuthToken: String!
    encryptedRefreshToken: String!
    expiryTime: Int!
    scopes: [String]!
    activeKey: String
    decryptedToken: String
  }

  extend type Query {
    integrations(workspaceId: String, workspaceSlug: String, appName: String, tokenId: String): [Integration]
  }
`;

const resolvers = {
  integrations: async (_, { workspaceId, workspaceSlug, appName, tokenId }, { user }) => {
    if (user && (user.sub)) {
      const member = await Member.findOne({ workspaceId, userId: user.sub,
        permissions: "query:integrations"
      });

      if (member) {
        const integration = integrations[appName];

        if (integration) {
          let activeKey = null;
          let integrationToken = null;

          if (tokenId) {
            const datalake = await createConnection(workspaceId);
            const token = await datalake.model('Token').findOne({ _id: new ObjectId(tokenId) });

            if (token) {
              const { activeKey: returnedActiveKey, decryptedToken } = await integration.getValidToken(token, workspaceId);
              activeKey = returnedActiveKey;

              integrationToken = {
                _id: token._id,
                encryptedAuthToken: token.encryptedAuthToken,
                encryptedRefreshToken: token.encryptedRefreshToken,
                expiryTime: token.expiryTime,
                scopes: token.scopes,
                activeKey: activeKey,
                decryptedToken: decryptedToken,
              };
            } else {
              console.error(`Token with ID '${tokenId}' not found`);
            }
            await datalake.close();
          }
          const tenants = await integration.getTenants(workspaceId, new ObjectId(tokenId));

          return [{
            _id: tokenId,
            name: appName,
            tenants,
            token: integrationToken
          }];
        } else {
          console.error(`Integration with name '${appName}' not found`);
          return null;
        }
      } else {
        console.error('User not authorized to query integrations');
        return null;
      }
    } else {
      console.error('User not authenticated or userId not found');
      return null;
    }
  },
};

async function createConnection(workspaceId) {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  const datalake = mongoose.createConnection(dataLakeUri);

  datalake.model('Token', new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, required: true },
    email: { type: String, required: true },
    encryptedAuthToken: { type: String, required: true }, 
    encryptedAuthTokenIV: { type: String, required: true },
    encryptedRefreshToken: { type: String, required: true },
    encryptedRefreshTokenIV: { type: String, required: true },
    service: { type: String, required: true },
    issueTime: { type: Number, required: true },
    expiryTime: { type: Number, required: true },
    tokenType: { type: String, required: true },
    scopes: { type: [String], required: true },
    errorMessages: { type: [String], default: [] }
  }));

  await datalake.asPromise();
  return datalake;
}

module.exports = { typeDefs, resolvers };
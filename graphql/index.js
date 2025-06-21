// airank-core/graphql/index.js

const { ApolloServer, gql } = require('apollo-server-express');
const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();
const { promisify } = require('util');
const crypto = require('crypto');
const hkdf = promisify(crypto.hkdf);
const app = express();
const port = 3002;

// Import jose dynamically
let jwtDecrypt;
(async () => {
  const jose = await import('jose');
  jwtDecrypt = jose.jwtDecrypt;
})();

// MongoDB connection
const mongoUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;

mongoose.connect(mongoUri)
  .then(() => {
    console.log('Connected to MongoDB');

    // Import your models and resolvers
    const { typeDefs: memberTypeDefs, resolvers: memberResolvers } = require('./queries/member');
    const { typeDefs: sourceTypeDefs, resolvers: sourceResolvers } = require('./queries/source');
    const { typeDefs: workspaceTypeDefs, resolvers: workspaceResolvers } = require('./queries/workspace');
    const { typeDefs: jobTypeDefs, resolvers: jobResolvers } = require('./queries/job');
    const { typeDefs: tokenTypeDefs, resolvers: tokenResolvers } = require('./queries/token');
    const { typeDefs: configTypeDefs, resolvers: configResolvers } = require('./queries/config');
    const { typeDefs: queryTypeDefs, resolvers: queryResolvers } = require('./queries/query');
    const { scheduleJobMutation } = require('./mutations/scheduleJob');
    const { createSource } = require('./mutations/createSource'); 
    const { updateSource } = require('./mutations/updateSource'); 
    const { archiveSource } = require('./mutations/archiveSource'); 
    const { updateWorkspaceConfigs } = require('./mutations/updateConfig');
    const { createQuery } = require('./mutations/createQuery');
    const { updateQuery } = require('./mutations/updateQuery');
    const { deleteQuery } = require('./mutations/deleteQuery');
    const { runQuery } = require('./mutations/runQuery');
    const { createWorkspace } = require('./mutations/createWorkspace');

    // Combine typeDefs and resolvers
    const typeDefs = [
        workspaceTypeDefs,
        memberTypeDefs,
        sourceTypeDefs,
        jobTypeDefs,
        tokenTypeDefs,
        configTypeDefs,
        queryTypeDefs,
        gql`
          type Query {
            workspace(workspaceId: String, workspaceSlug: String): Workspace
            workspaces: [Workspace]
            members(workspaceId: String, workspaceSlug: String): [Member]
            sources(workspaceId: String, workspaceSlug: String, sourceId: String): [Source]
            jobs(workspaceId: String, workspaceSlug: String, jobId: String, sourceId: String): [Job]
            tokens(workspaceId: String, workspaceSlug: String, service: String, tokenId: String): [Token]
            configs(workspaceId: String, workspaceSlug: String): [Config]
            queries(
              workspaceId: String, 
              workspaceSlug: String, 
              queryId: String,
              page: Int,
              limit: Int
            ): PaginatedQueries
          }

          type Job {
            _id: ID!
            name: String
            data: JSON!
            priority: Int
            type: String
            nextRunAt: String
            lastModifiedBy: String
            lockedAt: String
            lastRunAt: String
            lastFinishedAt: String
            status: String
            failReason: String
            failedAt: String
            startTime: String
            endTime: String
            errors: [JSON]
            apiCalls: Int
            ingressBytes: Int
            runtimeMilliseconds: Int
          }

          type Mutation {
            scheduleJobs(
              workspaceId: String
              workspaceSlug: String
              jobs: [JobScheduleInput]!
            ): [JobScheduleResponse]
            createWorkspace(
              name: String!
            ): Workspace
            createSource(
              workspaceId: String
              workspaceSlug: String
              name: String!
              tokenId: String
              sourceType: String!
              matchingField: String
              whitelistedIp: [String]
              batchConfig: JSON
            ): Source
            updateSource(
              workspaceId: String
              workspaceSlug: String
              id: ID!
              name: String
              whitelistedIp: [String]
              bearerToken: String
              tokenId: String
              sourceType: String
              datalakeCollection: String
              matchingField: String
              batchConfig: JSON
            ): Source
            archiveSource(
              workspaceId: String
              status: String
              workspaceSlug: String
              id: ID!
            ): SourceDeletionResponse
            updateWorkspaceConfigs(
              workspaceSlug: String!
              configs: JSON!
            ): [Config]
            createQuery(workspaceId: String, workspaceSlug: String, name: String!, description: String, query: String!, schedule: String): StoredQuery
            updateQuery(workspaceId: String, workspaceSlug: String, id: ID!, name: String, description: String, query: String, schedule: String): StoredQuery
            deleteQuery(workspaceId: String, workspaceSlug: String, id: ID!): QueryDeletionResponse
            runQuery(
              workspaceId: String
              workspaceSlug: String
              query: String
              queryId: ID
            ): QueryResult
          }

          type JobScheduleResponse {
            id: ID!
            nextRunAt: String
          }

          input JobScheduleInput {
            name: String!
            schedule: String
            data: JSON!
            repeatEvery: String
            timezone: String
            skipImmediate: Boolean
            startDate: String
            endDate: String
            skipDays: String
            forkMode: Boolean
            unique: JSON
            insertOnly: Boolean
          }

          type SourceDeletionResponse {
            message: String
            remainingSources: [Source]
          }
            
          type Source {
            _id: String
            source: Source
          }

          type QueryDeletionResponse {
            message: String
            remainingQueries: [StoredQuery]
          }

          type QueryResult {
            results: JSON!
            count: Int!
          }

          scalar JSON
        `
    ];

    // Resolve Query functions
    const resolvers = {
        Query: {
            workspace: async (parent, args, context) => {
              if (!args.workspaceId && !args.workspaceSlug) {
                const Member = mongoose.model('Member');
                if (!context.user) {
                  throw new Error('User not authenticated');
                }
                
                const userId = context.user.sub || context.user._id;
                
                const members = await Member.find({ 
                  userId: userId,
                  permissions: "query:workspaces"
                });
                
                if (!members || members.length === 0) {
                  return null;
                }
                
                const workspaceIds = members.map(m => m.workspaceId);
                const Workspace = mongoose.model('Workspace');
                const workspaces = await Workspace.find({ 
                  _id: { $in: workspaceIds } 
                });
                
                return workspaces.length > 0 ? workspaces[0] : null;
              }
              
              const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
              if (!workspaceId) {
                  throw new Error('Workspace not found.');
              }
              return workspaceResolvers.workspace(parent, { workspaceId }, context);
            },
            workspaces: async (parent, args, context) => {
              const Member = mongoose.model('Member');
              if (!context.user) {
                throw new Error('User not authenticated');
              }
              
              const userId = context.user.sub || context.user._id;
              
              const members = await Member.find({ 
                userId: userId,
                permissions: "query:workspaces"
              });
              
              if (!members || members.length === 0) {
                return [];
              }
              
              const workspaceIds = members.map(m => m.workspaceId);
              const Workspace = mongoose.model('Workspace');
              const workspaces = await Workspace.find({ 
                _id: { $in: workspaceIds } 
              });
              
              return workspaces;
            },
            members: async (parent, args, context) => {
              const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
              if (!workspaceId) {
                  throw new Error('Workspace not found.');
              }
              return memberResolvers.members(parent, { workspaceId }, context);
            },
            sources: async (parent, args, context) => {
              const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
              if (!workspaceId) {
                  throw new Error('Workspace not found.');
              }
              return sourceResolvers.sources(parent, { ...args, workspaceId }, context);
            },
            jobs: async (parent, args, context) => {
              const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
              if (!workspaceId) {
                  throw new Error('Workspace not found.');
              }
              return jobResolvers.jobs(parent, { ...args, workspaceId }, context);
            },
            tokens: async (parent, args, context) => {
              const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
              if (!workspaceId) {
                  throw new Error('Workspace not found.');
              }
              return await tokenResolvers.tokens(parent, { ...args, workspaceId }, context);
            },
            configs: async (parent, args, context) => {
              const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
              if (!workspaceId) {
                  throw new Error('Workspace not found.');
              }
              return configResolvers.configs(parent, { ...args, workspaceId }, context);
            },
            queries: async (parent, args, context) => {
                const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
                if (!workspaceId) {
                    throw new Error('Workspace not found.');
                }
                return queryResolvers.queries(parent, { ...args, workspaceId }, context);
            }
        },
        Mutation: {
          scheduleJobs: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
                throw new Error('Workspace not found.');
            }
            return await scheduleJobMutation(parent, { ...args, workspaceId }, context);
          },
          createWorkspace: async (parent, args, context) => {
            return await createWorkspace(parent, args, context);
          },
          createSource: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
              throw new Error('Workspace not found.');
            }
            return await createSource(parent, { ...args, workspaceId }, context);
          },
          updateSource: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
              throw new Error('Workspace not found.');
            }
            return await updateSource(parent, { ...args, workspaceId }, context);
          },
          archiveSource: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
              throw new Error('Workspace not found.');
            }
            return await archiveSource(parent, { ...args, workspaceId }, context);
          },
          updateWorkspaceConfigs: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
                throw new Error('Workspace not found.');
            }
            return updateWorkspaceConfigs(parent, { ...args, workspaceId }, context);
          },
          createQuery: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
                throw new Error('Workspace not found.');
            }
            return createQuery(parent, { ...args, workspaceId }, context);
          },
          updateQuery: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
                throw new Error('Workspace not found.');
            }
            return updateQuery(parent, { ...args, workspaceId }, context);
          },
          deleteQuery: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
                throw new Error('Workspace not found.');
            }
            return deleteQuery(parent, { ...args, workspaceId }, context);
          },
          runQuery: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
                throw new Error('Workspace not found.');
            }
            return runQuery(parent, { ...args, workspaceId }, context);
          }
        }
    };

    // Authentication middleware
    const authenticateToken = async (req, res, next) => {
      const authHeader = req.headers['authorization'];
      if (authHeader) {
        // Check if it's a Bearer token (API key) or JWT token
        if (authHeader.startsWith('Bearer ')) {
          // This is a Bearer token (API key) - look it up to get workspace restriction
          const bearerToken = authHeader.split(' ')[1];
          
          try {
            // Connect to airank database to look up API key
            const airankUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
            const airankDb = mongoose.createConnection(airankUri);
            await airankDb.asPromise();
            
            const apiKey = await airankDb.collection('apiKeys').findOne({ bearer: bearerToken });
            await airankDb.close();
            
            if (!apiKey) {
              console.error('API key not found in database');
              return res.status(401).json({ error: 'Invalid API key' });
            }
            
            req.user = { 
              sub: 'api-key-user',
              isApiKey: true,
              bypassMemberCheck: true,
              restrictedWorkspaceId: apiKey.workspace
            };
            next();
          } catch (error) {
            console.error('Error looking up API key:', error);
            return res.status(500).json({ error: 'Internal server error' });
          }
        } else {
          // This is a JWT token - decrypt it
          const token = authHeader;
          try {
            const decodedToken = await decryptToken(token, process.env.JWT_SECRET); 
            req.user = decodedToken; 
            next();
          } catch (error) {
            res.status(401).send('Unauthorized');
          }
        }
      } else {
        res.status(401).send('Unauthorized: Missing or invalid token');
      }
    };

    // Apply middleware to handle CORS and Authentication
    app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, do-connecting-ip'); 
      next();
    });
    app.use(authenticateToken);

    // Create the Apollo Server
    const server = new ApolloServer({ 
      typeDefs, 
      resolvers,
      context: ({ req }) => ({ user: req.user }) 
    });

    // Start the server
    server.start().then(() => {
      server.applyMiddleware({ app });
      app.listen(port, () => {
        console.log(`GraphQL server listening on port ${port}`);
      });
    });
  })
  .catch(err => {
    console.error('Error connecting to MongoDB:', err);
  });

// JWT Decryption function
async function decryptToken(token, secret) {
  const encryptionKey = await getDerivedEncryptionKey(secret, "");
  const { payload } = await jwtDecrypt(token, encryptionKey);
  return payload;
}

async function getDerivedEncryptionKey(keyMaterial, salt) {
  const info = Buffer.from('NextAuth.js Generated Encryption Key', 'utf8');
  const derivedKey = await hkdf('sha256', keyMaterial, salt, info, 32);
  return new Uint8Array(derivedKey);
}
// airank-core/graphql/index.js

const { ApolloServer, gql } = require('apollo-server-express');
const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();
const { promisify } = require('util');
const crypto = require('crypto');
const hkdf = promisify(crypto.hkdf);
const app = express();
const port = 4002;

// Import jose dynamically
let jwtDecrypt;
(async () => {
  const jose = await import('jose');
  jwtDecrypt = jose.jwtDecrypt;
})();

// MongoDB connection
const mongoUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;

// Helper function to get workspaceId from slug
async function getWorkspaceIdFromSlug(slug) {
  try {
    // Connect to the airank database to look up workspace by slug
    const airankUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
    const airankDb = mongoose.createConnection(airankUri);
    await airankDb.asPromise();
    
    const workspace = await airankDb.collection('workspaces').findOne({ slug });
    await airankDb.close();
    
    if (!workspace) {
      console.error(`Workspace with slug '${slug}' not found`);
      return null;
    }
    
    return workspace._id;
  } catch (error) {
    console.error('Error looking up workspace by slug:', error);
    return null;
  }
}

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
    const { typeDefs: promptTypeDefs, resolvers: promptResolvers } = require('./queries/prompt');
    const { typeDefs: brandTypeDefs, resolvers: brandResolvers } = require('./queries/brand');
    const { typeDefs: modelTypeDefs, resolvers: modelResolvers } = require('./queries/model');
    const { typeDefs: analyticsTypeDefs, resolvers: analyticsResolvers } = require('./queries/analytics');
    const { typeDefs: billingProfileTypeDefs, resolvers: billingProfileResolvers } = require('./queries/billingProfile');
    const { typeDefs: billingPlansTypeDefs, resolvers: billingPlansResolvers } = require('./queries/billingPlans');
    const { typeDefs: entitlementsTypeDefs, resolvers: entitlementsResolvers } = require('./queries/entitlements');
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
    const { createPrompt } = require('./mutations/createPrompt');
    const { updatePrompt } = require('./mutations/updatePrompt');
    const { deletePrompt } = require('./mutations/deletePrompt');
    const { createBrand } = require('./mutations/createBrand');
    const { updateBrand } = require('./mutations/updateBrand');
    const { deleteBrand } = require('./mutations/deleteBrand');
    const { createModel } = require('./mutations/createModel');
    const { updateModel } = require('./mutations/updateModel');
    const { deleteModel } = require('./mutations/deleteModel');
    const { resolvers: createBillingProfileResolvers } = require('./mutations/createBillingProfile');
    const { resolvers: attachBillingProfileResolvers } = require('./mutations/attachBillingProfile');
    const { resolvers: createSubscriptionResolvers } = require('./mutations/createSubscription');
    const { resolvers: confirmSubscriptionResolvers } = require('./mutations/confirmSubscription');
    const { resolvers: changePlanResolvers } = require('./mutations/changePlan');
    const { resolvers: createSetupIntentResolvers } = require('./mutations/createSetupIntent');
    const { resolvers: savePaymentMethodResolvers } = require('./mutations/savePaymentMethod');

    // Combine typeDefs and resolvers
    const typeDefs = [
        workspaceTypeDefs,
        memberTypeDefs,
        sourceTypeDefs,
        jobTypeDefs,
        tokenTypeDefs,
        configTypeDefs,
        queryTypeDefs,
        promptTypeDefs,
        brandTypeDefs,
        modelTypeDefs,
        analyticsTypeDefs,
        billingProfileTypeDefs,
        billingPlansTypeDefs,
        entitlementsTypeDefs,
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
            prompts(workspaceId: String, workspaceSlug: String, promptId: String): [Prompt]
            brands(workspaceId: String, workspaceSlug: String, brandId: String): [Brand]
            models(workspaceId: String, workspaceSlug: String, modelId: String): [Model]
            analytics(workspaceId: String!, startDate: String, endDate: String): AnalyticsData
            billingProfiles(billingProfileId: ID): [BillingProfile]
            billingPlans: [BillingPlan]
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
            createPrompt(workspaceId: String, workspaceSlug: String, phrase: String!): Prompt
            updatePrompt(workspaceId: String, workspaceSlug: String, id: ID!, phrase: String!): Prompt
            deletePrompt(workspaceId: String, workspaceSlug: String, id: ID!): PromptDeletionResponse
            createBrand(workspaceId: String, workspaceSlug: String, name: String!, isOwnBrand: Boolean): Brand
            updateBrand(workspaceId: String, workspaceSlug: String, id: ID!, name: String, isOwnBrand: Boolean): Brand
            deleteBrand(workspaceId: String, workspaceSlug: String, id: ID!): BrandDeletionResponse
            createModel(workspaceId: String, workspaceSlug: String, name: String!, provider: String!, modelId: String!, isEnabled: Boolean): Model
            updateModel(workspaceId: String, workspaceSlug: String, id: ID!, name: String, provider: String, modelId: String, isEnabled: Boolean): Model
            deleteModel(workspaceId: String, workspaceSlug: String, id: ID!): ModelDeletionResponse
            createBillingProfile(name: String!, workspaceId: ID): BillingProfile
            attachBillingProfile(workspaceId: ID!, billingProfileId: ID!): Workspace
            createSubscription(billingProfileId: ID!, planId: String!, interval: String!): SubscriptionResult
            confirmSubscription(billingProfileId: ID!): BillingProfile
            changePlan(billingProfileId: ID!, newPlanId: String!, interval: String!): BillingProfile
            createSetupIntent(billingProfileId: ID!): SetupIntentResult
            savePaymentMethod(billingProfileId: ID!, paymentMethodId: String!): BillingProfile
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

          type PromptDeletionResponse {
            message: String
            remainingPrompts: [Prompt]
          }

          type BrandDeletionResponse {
            message: String
            remainingBrands: [Brand]
          }

          type ModelDeletionResponse {
            message: String
            remainingModels: [Model]
          }

          type QueryResult {
            results: JSON!
            count: Int!
          }

          type SubscriptionResult {
            billingProfile: BillingProfile!
            stripeSubscriptionId: String!
            clientSecret: String
          }

          type SetupIntentResult {
            clientSecret: String!
          }

          scalar JSON
          scalar DateTime
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
            },
            prompts: async (parent, args, context) => {
                const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
                if (!workspaceId) {
                    throw new Error('Workspace not found.');
                }
                return promptResolvers.prompts(parent, { ...args, workspaceId }, context);
            },
            brands: async (parent, args, context) => {
                const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
                if (!workspaceId) {
                    throw new Error('Workspace not found.');
                }
                return brandResolvers.brands(parent, { ...args, workspaceId }, context);
            },
            models: async (parent, args, context) => {
                const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
                if (!workspaceId) {
                    throw new Error('Workspace not found.');
                }
                return modelResolvers.models(parent, { ...args, workspaceId }, context);
            },
            analytics: async (parent, args, context) => {
                const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
                if (!workspaceId) {
                    throw new Error('Workspace not found.');
                }
                return analyticsResolvers.analytics(parent, { ...args, workspaceId }, context);
            },
            billingProfiles: async (parent, args, context) => {
                return billingProfileResolvers.billingProfiles(parent, args, context);
            },
            billingPlans: async (parent, args, context) => {
                return billingPlansResolvers.billingPlans(parent, args, context);
            },
            entitlements: async (parent, args, context) => {
                return entitlementsResolvers.entitlements(parent, args, context);
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
          },
          createPrompt: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
                throw new Error('Workspace not found.');
            }
            return createPrompt(parent, { ...args, workspaceId }, context);
          },
          updatePrompt: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
                throw new Error('Workspace not found.');
            }
            return updatePrompt(parent, { ...args, workspaceId }, context);
          },
          deletePrompt: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
                throw new Error('Workspace not found.');
            }
            return deletePrompt(parent, { ...args, workspaceId }, context);
          },
          createBrand: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
                throw new Error('Workspace not found.');
            }
            return createBrand(parent, { ...args, workspaceId }, context);
          },
          updateBrand: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
                throw new Error('Workspace not found.');
            }
            return updateBrand(parent, { ...args, workspaceId }, context);
          },
          deleteBrand: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
                throw new Error('Workspace not found.');
            }
            return deleteBrand(parent, { ...args, workspaceId }, context);
          },
          createModel: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
                throw new Error('Workspace not found.');
            }
            return createModel(parent, { ...args, workspaceId }, context);
          },
          updateModel: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
                throw new Error('Workspace not found.');
            }
            return updateModel(parent, { ...args, workspaceId }, context);
          },
          deleteModel: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
                throw new Error('Workspace not found.');
            }
            return deleteModel(parent, { ...args, workspaceId }, context);
          },
          createBillingProfile: async (parent, args, context) => {
            return createBillingProfileResolvers.createBillingProfile(parent, args, context);
          },
          attachBillingProfile: async (parent, args, context) => {
            return attachBillingProfileResolvers.attachBillingProfile(parent, args, context);
          },
          createSubscription: async (parent, args, context) => {
            return createSubscriptionResolvers.createSubscription(parent, args, context);
          },
          confirmSubscription: async (parent, args, context) => {
            return confirmSubscriptionResolvers.confirmSubscription(parent, args, context);
          },
          changePlan: async (parent, args, context) => {
            return changePlanResolvers.changePlan(parent, args, context);
          },
          createSetupIntent: async (parent, args, context) => {
            return createSetupIntentResolvers.createSetupIntent(parent, args, context);
          },
          savePaymentMethod: async (parent, args, context) => {
            return savePaymentMethodResolvers.savePaymentMethod(parent, args, context);
          },
          refreshEntitlements: async (parent, args, context) => {
            return entitlementsResolvers.refreshEntitlements(parent, args, context);
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

      // Handle preflight OPTIONS requests
      if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
      }

      next();
    });

    // Apply authentication middleware
    app.use(authenticateToken);

    // Create the Apollo Server
    const server = new ApolloServer({ 
      typeDefs, 
      resolvers,
      context: ({ req }) => ({ user: req.user }) 
    });

    // Start the server
    server.start().then(() => {
      server.applyMiddleware({
        app,
        cors: {
          origin: '*',
          credentials: true
        }
      });
      app.listen(port, '0.0.0.0', () => {
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
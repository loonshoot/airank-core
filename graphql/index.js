// outrun-core/graphql/index.js

const { ApolloServer, gql } = require('apollo-server-express');
const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();
const { jwtDecrypt } = require("jose");
const { promisify } = require('util');
const crypto = require('crypto');
const hkdf = promisify(crypto.hkdf);
const app = express();
const port = 3002;

// MongoDB connection
const mongoUri = `${process.env.MONGODB_URI}/outrun?${process.env.MONGODB_PARAMS}`;

mongoose.connect(mongoUri)
  .then(() => {
    console.log('Connected to MongoDB');

    // Import your models and resolvers
    const { typeDefs: memberTypeDefs, resolvers: memberResolvers } = require('./queries/member');
    const { typeDefs: sourceTypeDefs, resolvers: sourceResolvers } = require('./queries/source');
    const { typeDefs: workspaceTypeDefs, resolvers: workspaceResolvers } = require('./queries/workspace');
    const { typeDefs: jobTypeDefs, resolvers: jobResolvers } = require('./queries/job');
    const { typeDefs: tokenTypeDefs, resolvers: tokenResolvers } = require('./queries/token');
    const { typeDefs: integrationTypeDefs, resolvers: integrationResolvers } = require('./queries/integration'); 
    const { typeDefs: streamRouteTypeDefs, resolvers: streamRouteSchema } = require('./queries/streamRoutes');
    const { typeDefs: collectionsTypeDefs, resolvers: collectionsResolvers } = require('./queries/collections');
    const { typeDefs: objectsTypeDefs, resolvers: objectsResolvers } = require('./queries/objects');
    const { typeDefs: logsTypeDefs, resolvers: logsResolvers } = require('./queries/logs');
    const { typeDefs: configTypeDefs, resolvers: configResolvers } = require('./queries/config');
    const { typeDefs: queryTypeDefs, resolvers: queryResolvers } = require('./queries/query');
    const { typeDefs: factsTypeDefs, resolvers: factsResolvers } = require('./queries/facts');
    const { typeDefs: destinationsTypeDefs, resolvers: destinationsResolvers } = require('./queries/destinations');
    const { typeDefs: apiKeyTypeDefs, resolvers: apiKeyResolvers } = require('./queries/apiKey');
    const { typeDefs: workflowTypeDefs, resolvers: workflowResolvers } = require('./queries/workflow');
    const { scheduleJobMutation } = require('./mutations/scheduleJob');
    const { registerExternalCredentials } = require('./mutations/registerExternalCredentials'); 
    const { deleteExternalCredentials } = require('./mutations/deleteExternalCredentials');
    const { createSource } = require('./mutations/createSource'); 
    const { updateSource } = require('./mutations/updateSource'); 
    const { archiveSource } = require('./mutations/archiveSource'); 
    const { createStreamRoute } = require('./mutations/createStreamRoute');
    const { updateWorkspaceConfigs } = require('./mutations/updateConfig');
    const { createQuery } = require('./mutations/createQuery');
    const { updateQuery } = require('./mutations/updateQuery');
    const { deleteQuery } = require('./mutations/deleteQuery');
    const { runQuery } = require('./mutations/runQuery');
    const { createDestination } = require('./mutations/createDestination');
    const { updateDestination } = require('./mutations/updateDestination');
    const { deleteDestination } = require('./mutations/deleteDestination');
    const { createWorkspace } = require('./mutations/createWorkspace');
    const { createApiKey } = require('./mutations/createApiKey');
    const { updateApiKey } = require('./mutations/updateApiKey');
    const { createWorkflow } = require('./mutations/createWorkflow');
    const { updateWorkflow } = require('./mutations/updateWorkflow');
    const { deleteWorkflow } = require('./mutations/deleteWorkflow');
    const { activateWorkflow } = require('./mutations/activateWorkflow');
    const { pauseWorkflow } = require('./mutations/pauseWorkflow');
    const { createWorkflowRun } = require('./mutations/createWorkflowRun');

    // Combine typeDefs and resolvers
    const typeDefs = [
        workspaceTypeDefs,
        memberTypeDefs,
        sourceTypeDefs,
        jobTypeDefs,
        tokenTypeDefs,
        integrationTypeDefs,
        streamRouteTypeDefs,
        collectionsTypeDefs,
        objectsTypeDefs,
        logsTypeDefs,
        configTypeDefs,
        queryTypeDefs,
        factsTypeDefs,
        destinationsTypeDefs,
        apiKeyTypeDefs,
        workflowTypeDefs,
        gql`

          type Query {
            workspace(workspaceId: String, workspaceSlug: String): Workspace
            workspaces: [Workspace]
            members(workspaceId: String, workspaceSlug: String): [Member]
            sources(workspaceId: String, workspaceSlug: String, sourceId: String): [Source]
            jobs(workspaceId: String, workspaceSlug: String, jobId: String, sourceId: String, destinationId: ID): [Job]
            tokens(workspaceId: String, workspaceSlug: String, service: String, tokenId: String): [Token]
            integrations(workspaceId: String, workspaceSlug: String, appName: String, tokenId: String): [Integration]
            streamRoutes(
              workspaceId: String, 
              workspaceSlug: String, 
              sourceId: String, 
              service: String, 
              streamRouteId: String
            ): [StreamRoute]
            collections(workspaceId: String, workspaceSlug: String): [Collection]
            objects(
              workspaceId: String, 
              workspaceSlug: String, 
              collectionName: String!, 
              objectId: String,
              page: Int,
              limit: Int
            ): PaginatedObjects
            logs(
              workspaceId: String,
              workspaceSlug: String,
              logId: String,
              page: Int,
              limit: Int,
              type: String,
              startDate: String,
              endDate: String
            ): PaginatedLogs
            configs(workspaceId: String, workspaceSlug: String): [Config]
            queries(
              workspaceId: String, 
              workspaceSlug: String, 
              queryId: String,
              page: Int,
              limit: Int
            ): PaginatedQueries
            destinations(
              workspaceId: String,
              workspaceSlug: String,
              id: ID
            ): [Destination]
            facts(
              workspaceId: String, 
              workspaceSlug: String,
              property: String,
              entityId: String,
              entityType: String,
              factType: String,
              startDate: DateTime,
              endDate: DateTime,
              period: String,
              location: FactLocationInput,
              dimensions: JSON,
              limit: Int,
              offset: Int
            ): [Fact]
            factsAggregate(
              workspaceId: String,
              workspaceSlug: String,
              property: String!,
              factType: String!,
              startDate: DateTime!,
              endDate: DateTime!,
              groupBy: String!,
              filters: JSON
            ): [FactAggregate]
            apiKeys(workspaceId: String, workspaceSlug: String): [ApiKey]
            workflows(workspaceId: String, workspaceSlug: String, workflowId: String, page: Int, limit: Int): [Workflow]
            workflowRuns(workspaceId: String, workspaceSlug: String, workflowId: String, runId: String, status: RunStatus, page: Int, limit: Int): PaginatedWorkflowRuns
            triggerListeners(workspaceId: String, workspaceSlug: String): [TriggerListener]
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
            registerExternalCredentials(
              workspaceId: String
              workspaceSlug: String
              service: String!
              code: String!
              scope: String
              tokenId: String
              accountsServer: String
              redirectUri: String
            ): ExternalCredentials
            deleteExternalCredentials(
              workspaceId: String
              workspaceSlug: String
              id: ID!
            ): ExternalCredentials
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
            createStreamRoute(
              workspaceId: String
              workspaceSlug: String
              service: String!
              sourceId: String!
              data: JSON!
            ): StreamRoute
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
            createDestination(
              workspaceId: String
              workspaceSlug: String
              name: String!
              tokenId: String
              destinationType: String!
              targetSystem: String!
              rateLimits: RateLimitsInput
              mappings: DestinationMappingsInput
            ): Destination
            updateDestination(
              workspaceId: String
              workspaceSlug: String
              id: ID!
              name: String
              status: String
              mappings: DestinationMappingsInput
            ): Destination
            deleteDestination(
              workspaceId: String
              workspaceSlug: String
              id: ID!
            ): DestinationDeletionResponse
            createApiKey(
              workspaceId: String
              workspaceSlug: String
              name: String!
              permissions: [String!]!
              allowedIps: [String!]
              allowedDomains: [String!]
            ): ApiKey
            updateApiKey(
              workspaceId: String
              workspaceSlug: String
              id: ID!
              name: String
              permissions: [String!]
              allowedIps: [String!]
              allowedDomains: [String!]
            ): ApiKey
            createWorkflow(workspaceId: String, workspaceSlug: String, name: String!, description: String, nodes: JSON!, edges: JSON!, triggers: [JSON], settings: JSON, tags: [String]): Workflow
            updateWorkflow(workspaceId: String, workspaceSlug: String, workflowId: String!, name: String, description: String, nodes: JSON, edges: JSON, triggers: [JSON], settings: JSON, tags: [String]): Workflow
            deleteWorkflow(workspaceId: String, workspaceSlug: String, workflowId: String!): Boolean
            activateWorkflow(workspaceId: String, workspaceSlug: String, workflowId: String!): Workflow
            pauseWorkflow(workspaceId: String, workspaceSlug: String, workflowId: String!): Workflow
            createWorkflowRun(workspaceId: String, workspaceSlug: String, workflowId: String!, triggeredBy: JSON, input: JSON): WorkflowRun
          }

          type JobScheduleResponse {
            id: ID!
            nextRunAt: String
          }

          input JobScheduleInput { # New input type for job parameters
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

          type ExternalCredentials {
            message: String
            authToken: String
            remainingTokens: [Token]
          }

          type SourceDeletionResponse {
            message: String
            remainingSources: [Source]
          }

          type DestinationDeletionResponse {
            message: String
            remainingDestinations: [Destination]
          }
            
          type Source {
            _id: String
            source: Source
          }

          type StreamRoute {
            _id: String
            service: String!
            sourceId: String!
            workspaceId: String!
            data: JSON!
          }

          type QueryDeletionResponse {
            message: String
            remainingQueries: [StoredQuery]
          }

          type QueryResult {
            results: JSON!
            count: Int!
          }

          type Subscription {
            workflowRunUpdated(workspaceId: String!, workflowId: String): WorkflowRun
            workflowStatsUpdated(workspaceId: String!, workflowId: String!): WorkflowStats
            workflowRunStepUpdated(workspaceId: String!, runId: String!): RunStep
            triggerListenerActivated(workspaceId: String!): TriggerListener
          }

          scalar JSON
        `
      ];

    // Function to fetch workspaceId from workspaceSlug
    async function getWorkspaceIdFromSlug(workspaceSlug) {
        const Workspace = mongoose.model('Workspace'); 
        const workspace = await Workspace.findOne({ slug: workspaceSlug });
        return workspace ? workspace._id.toString() : null;
    }

    // Resolve Query functions
    const resolvers = {
        Query: {
            workspace: async (parent, args, context) => {
              // If no workspaceId or workspaceSlug provided, return all user workspaces
              if (!args.workspaceId && !args.workspaceSlug) {
                const Member = mongoose.model('Member');
                if (!context.user) {
                  throw new Error('User not authenticated');
                }
                
                const userId = context.user.sub || context.user._id;
                
                // Find all workspaces where user is a member by userId
                const members = await Member.find({ 
                  userId: userId,
                  permissions: "query:workspaces" // Check if permissions include 'query:workspaces'
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
              
              // Otherwise, get specific workspace
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
              
              // Find all workspaces where user is a member by userId
              const members = await Member.find({ 
                userId: userId,
                permissions: "query:workspaces" // Check if permissions include 'query:workspaces'
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
            integrations: async (parent, args, context) => {
              const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
              if (!workspaceId) {
                  throw new Error('Workspace not found.');
              }
              return await integrationResolvers.integrations(parent, { ...args, workspaceId }, context);
            },
            streamRoutes: async (parent, args, context) => {
              const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
              if (!workspaceId) {
                  throw new Error('Workspace not found.');
              }
              return await streamRouteSchema.streamRoutes(parent, { ...args, workspaceId }, context);
            },
            collections: async (parent, args, context) => {
              const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
              if (!workspaceId) {
                  throw new Error('Workspace not found.');
              }
              return await collectionsResolvers.collections(parent, { ...args, workspaceId }, context);
            },
            objects: async (parent, args, context) => {
              let workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
              
              // For API key requests, use the restricted workspace ID if no workspaceId is provided
              if (!workspaceId && context.user && context.user.isApiKey && context.user.restrictedWorkspaceId) {
                workspaceId = context.user.restrictedWorkspaceId;
              }
              
              if (!workspaceId) {
                  throw new Error('Workspace not found.');
              }
              return await objectsResolvers.objects(parent, { ...args, workspaceId }, context);
            },
            logs: async (parent, args, context) => {
              const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
              if (!workspaceId) {
                  throw new Error('Workspace not found.');
              }
              return await logsResolvers.logs(parent, { ...args, workspaceId }, context);
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
            destinations: async (parent, args, context) => {
                const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
                if (!workspaceId) {
                    throw new Error('Workspace not found.');
                }
                return destinationsResolvers.destinations(parent, { ...args, workspaceId }, context);
            },
            facts: async (parent, args, context) => {
                const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
                if (!workspaceId) {
                    throw new Error('Workspace not found.');
                }
                return factsResolvers.Query.facts(parent, { ...args, workspaceId }, context);
            },
            factsAggregate: async (parent, args, context) => {
                const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
                if (!workspaceId) {
                    throw new Error('Workspace not found.');
                }
                return factsResolvers.Query.factsAggregate(parent, { ...args, workspaceId }, context);
            },
            apiKeys: async (parent, args, context) => {
              const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
              if (!workspaceId) {
                  throw new Error('Workspace not found.');
              }
              return apiKeyResolvers.apiKeys(parent, { ...args, workspaceId }, context);
            },
            workflows: async (parent, args, context) => {
              const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
              if (!workspaceId) throw new Error('Workspace not found.');
              return await workflowResolvers.workflows(parent, { ...args, workspaceId }, context);
            },
            workflowRuns: async (parent, args, context) => {
              const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
              if (!workspaceId) throw new Error('Workspace not found.');
              return await workflowResolvers.workflowRuns(parent, { ...args, workspaceId }, context);
            },
            triggerListeners: async (parent, args, context) => {
              const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
              if (!workspaceId) throw new Error('Workspace not found.');
              return await workflowResolvers.triggerListeners(parent, { ...args, workspaceId }, context);
            }
        },
        Mutation: {
          // Schedule Job mutation
          scheduleJobs: async (parent, args, context) => { // Updated to scheduleJobs
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
                throw new Error('Workspace not found.');
            }
            return await scheduleJobMutation(parent, { ...args, workspaceId }, context);
          },
          // Create Workspace mutation
          createWorkspace: async (parent, args, context) => {
            // This mutation doesn't need a workspaceId as it's creating a new workspace
            return await createWorkspace(parent, args, context);
          },
          // Register External Credentials mutation
          registerExternalCredentials: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
                throw new Error('Workspace not found.');
            }
            return await registerExternalCredentials(parent, { ...args, workspaceId }, context);
          },
          deleteExternalCredentials: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
              throw new Error('Workspace not found.');
            }
            return await deleteExternalCredentials(parent, { ...args, workspaceId }, context);
          },
          // Create Source mutation
          createSource: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
              throw new Error('Workspace not found.');
            }
            return await createSource(parent, { ...args, workspaceId }, context);
          },
          // Create Source mutation
          createStreamRoute: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
              throw new Error('Workspace not found.');
            }
            return await createStreamRoute(parent, { ...args, workspaceId }, context);
          },
          // Update Source mutation
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
          createDestination: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
                throw new Error('Workspace not found.');
            }
            return createDestination(parent, { ...args, workspaceId }, context);
          },
          updateDestination: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
                throw new Error('Workspace not found.');
            }
            return updateDestination(parent, { ...args, workspaceId }, context);
          },
          deleteDestination: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
                throw new Error('Workspace not found.');
            }
            return deleteDestination(parent, { ...args, workspaceId }, context);
          },
          createApiKey: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
                throw new Error('Workspace not found.');
            }
            return createApiKey(parent, { ...args, workspaceId }, context);
          },
          updateApiKey: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) {
                throw new Error('Workspace not found.');
            }
            return updateApiKey(parent, { ...args, workspaceId }, context);
          },
          createWorkflow: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) throw new Error('Workspace not found.');
            return await createWorkflow(parent, { ...args, workspaceId }, context);
          },
          updateWorkflow: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) throw new Error('Workspace not found.');
            return await updateWorkflow(parent, { ...args, workspaceId }, context);
          },
          deleteWorkflow: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) throw new Error('Workspace not found.');
            return await deleteWorkflow(parent, { ...args, workspaceId }, context);
          },
          activateWorkflow: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) throw new Error('Workspace not found.');
            return await activateWorkflow(parent, { ...args, workspaceId }, context);
          },
          pauseWorkflow: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) throw new Error('Workspace not found.');
            return await pauseWorkflow(parent, { ...args, workspaceId }, context);
          },
          createWorkflowRun: async (parent, args, context) => {
            const workspaceId = args.workspaceId || (args.workspaceSlug && await getWorkspaceIdFromSlug(args.workspaceSlug));
            if (!workspaceId) throw new Error('Workspace not found.');
            return await createWorkflowRun(parent, { ...args, workspaceId }, context);
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
            // Connect to outrun database to look up API key
            const outrunUri = `${process.env.MONGODB_URI}/outrun?${process.env.MONGODB_PARAMS}`;
            const outrunDb = mongoose.createConnection(outrunUri);
            await outrunDb.asPromise();
            
            const apiKey = await outrunDb.collection('apiKeys').findOne({ bearer: bearerToken });
            await outrunDb.close();
            
            if (!apiKey) {
              console.error('API key not found in database');
              return res.status(401).json({ error: 'Invalid API key' });
            }
            
            req.user = { 
              sub: 'api-key-user', // Placeholder user for API key requests
              isApiKey: true,
              // Add a flag to bypass member permission checks since API key permissions
              // are already validated by the API gateway
              bypassMemberCheck: true,
              // Store the workspace ID that this API key is restricted to
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

// JWT Decryption function (same as before)
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
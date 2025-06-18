// types/Permission.js
const { gql } = require('apollo-server-express');

const typeDefs = gql`
  enum Permission {
    # Query Permissions
    QUERY_MEMBERS
    QUERY_SOURCES
    QUERY_WORKSPACES
    QUERY_INTEGRATIONS
    QUERY_JOBS
    QUERY_TOKENS
    QUERY_COLLECTIONS
    QUERY_OBJECTS
    QUERY_LOGS
    QUERY_CONFIG
    QUERY_STREAM_ROUTES
    QUERY_QUERY
    QUERY_API_KEYS
    QUERY_DESTINATIONS
    QUERY_FACTS
    QUERY_WORKFLOWS
    
    # Mutation Permissions
    MUTATION_UPDATE_CONFIG
    MUTATION_ARCHIVE_SOURCE
    MUTATION_REGISTER_EXTERNAL_CREDENTIALS
    MUTATION_CREATE_SOURCE
    MUTATION_DELETE_EXTERNAL_CREDENTIALS
    MUTATION_DELETE_SOURCE
    MUTATION_SCHEDULE_JOBS
    MUTATION_UPDATE_SOURCE
    MUTATION_CREATE_STREAM_ROUTE
    MUTATION_CREATE_QUERY
    MUTATION_UPDATE_QUERY
    MUTATION_DELETE_QUERY
    MUTATION_RUN_QUERY
    MUTATION_CREATE_API_KEY
    MUTATION_UPDATE_API_KEY
    MUTATION_CREATE_DESTINATION
    MUTATION_UPDATE_DESTINATION
    MUTATION_DELETE_DESTINATION
    MUTATION_CREATE_WORKSPACE
    MUTATION_CREATE_WORKFLOW
    MUTATION_UPDATE_WORKFLOW
    MUTATION_DELETE_WORKFLOW
    MUTATION_ACTIVATE_WORKFLOW
    MUTATION_PAUSE_WORKFLOW
  }
`;

// All valid permission strings
const ALL_PERMISSIONS = [
  'query:members',
  'query:sources',
  'query:workspaces',
  'query:integrations',
  'query:jobs',
  'query:tokens',
  'query:collections',
  'query:objects',
  'query:logs',
  'query:config',
  'query:streamRoutes',
  'query:query',
  'query:apiKeys',
  'query:destinations',
  'query:facts',
  'query:workflows',
  'mutation:updateConfig',
  'mutation:archiveSource',
  'mutation:registerExternalCredentials',
  'mutation:createSource',
  'mutation:deleteExternalCredentials',
  'mutation:deleteSource',
  'mutation:scheduleJobs',
  'mutation:updateSource',
  'mutation:createStreamRoute',
  'mutation:createQuery',
  'mutation:updateQuery',
  'mutation:deleteQuery',
  'mutation:runQuery',
  'mutation:createApiKey',
  'mutation:updateApiKey',
  'mutation:createDestination',
  'mutation:updateDestination',
  'mutation:deleteDestination',
  'mutation:createWorkspace',
  'mutation:createWorkflow',
  'mutation:updateWorkflow',
  'mutation:deleteWorkflow',
  'mutation:activateWorkflow',
  'mutation:pauseWorkflow'
];

module.exports = { 
  typeDefs, 
  ALL_PERMISSIONS 
};
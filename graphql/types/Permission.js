// types/Permission.js
const { gql } = require('apollo-server-express');

const typeDefs = gql`
  enum Permission {
    # Query Permissions
    QUERY_MEMBERS
    QUERY_SOURCES
    QUERY_WORKSPACES
    QUERY_JOBS
    QUERY_TOKENS
    QUERY_CONFIG
    QUERY_QUERY
    
    # Mutation Permissions
    MUTATION_UPDATE_CONFIG
    MUTATION_ARCHIVE_SOURCE
    MUTATION_CREATE_SOURCE
    MUTATION_SCHEDULE_JOBS
    MUTATION_UPDATE_SOURCE
    MUTATION_CREATE_QUERY
    MUTATION_UPDATE_QUERY
    MUTATION_DELETE_QUERY
    MUTATION_RUN_QUERY
    MUTATION_CREATE_WORKSPACE
  }
`;

// All valid permission strings
const ALL_PERMISSIONS = [
  'query:members',
  'query:sources',
  'query:workspaces',
  'query:jobs',
  'query:tokens',
  'query:config',
  'query:query',
  'mutation:updateConfig',
  'mutation:archiveSource',
  'mutation:createSource',
  'mutation:scheduleJobs',
  'mutation:updateSource',
  'mutation:createQuery',
  'mutation:updateQuery',
  'mutation:deleteQuery',
  'mutation:runQuery',
  'mutation:createWorkspace'
];

module.exports = { 
  typeDefs, 
  ALL_PERMISSIONS 
};
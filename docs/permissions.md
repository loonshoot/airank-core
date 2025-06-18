# Outrun GraphQL Permissions System

This document outlines the complete permissions system used in the Outrun GraphQL API.

## Permission Format

Permissions follow the format: `{operation}:{resource}`

- **operation**: `query` or `mutation`
- **resource**: The resource being accessed (e.g., `sources`, `members`, `apiKeys`)

## Complete Permissions List

### Query Permissions (15)

| Permission | GraphQL Operation | Description |
|------------|-------------------|-------------|
| `query:members` | `members()` | View workspace members |
| `query:sources` | `sources()` | View data sources |
| `query:workspaces` | `workspace()`, `workspaces()` | View workspace information |
| `query:integrations` | `integrations()` | View third-party integrations |
| `query:jobs` | `jobs()` | View scheduled jobs |
| `query:tokens` | `tokens()` | View authentication tokens |
| `query:collections` | `collections()` | View data collections |
| `query:objects` | `objects()` | View data objects |
| `query:logs` | `logs()` | View system logs |
| `query:config` | `configs()` | View workspace configuration |
| `query:streamRoutes` | `streamRoutes()` | View stream routing rules |
| `query:query` | `queries()` | View saved queries |
| `query:apiKeys` | `apiKeys()` | View API keys |
| `query:destinations` | `destinations()` | View data destinations |
| `query:facts` | `facts()`, `factsAggregate()` | View facts and analytics |

### Mutation Permissions (19)

| Permission | GraphQL Operation | Description |
|------------|-------------------|-------------|
| `mutation:updateConfig` | `updateWorkspaceConfigs()` | Update workspace settings |
| `mutation:archiveSource` | `archiveSource()` | Archive data sources |
| `mutation:registerExternalCredentials` | `registerExternalCredentials()` | Register OAuth credentials |
| `mutation:createSource` | `createSource()` | Create new data sources |
| `mutation:deleteExternalCredentials` | `deleteExternalCredentials()` | Delete OAuth credentials |
| `mutation:deleteSource` | `deleteSource()` | Delete data sources |
| `mutation:scheduleJobs` | `scheduleJobs()` | Schedule background jobs |
| `mutation:updateSource` | `updateSource()` | Update data source settings |
| `mutation:createStreamRoute` | `createStreamRoute()` | Create stream routing rules |
| `mutation:createQuery` | `createQuery()` | Create saved queries |
| `mutation:updateQuery` | `updateQuery()` | Update saved queries |
| `mutation:deleteQuery` | `deleteQuery()` | Delete saved queries |
| `mutation:runQuery` | `runQuery()` | Execute queries |
| `mutation:createApiKey` | `createApiKey()` | Create API keys |
| `mutation:updateApiKey` | `updateApiKey()` | Update API keys |
| `mutation:createDestination` | `createDestination()` | Create data destinations |
| `mutation:updateDestination` | `updateDestination()` | Update data destinations |
| `mutation:deleteDestination` | `deleteDestination()` | Delete data destinations |
| `mutation:createWorkspace` | `createWorkspace()` | Create new workspaces |

## Permission String Array

```javascript
const ALL_PERMISSIONS = [
  // Query Permissions
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
  
  // Mutation Permissions
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
  'mutation:createWorkspace'
];
```

## Default Member Permissions

When a new member is added to a workspace, they receive these default permissions:

```javascript
const DEFAULT_PERMISSIONS = [
  "query:members",
  "query:sources", 
  "query:workspaces",
  "query:integrations",
  "query:jobs",
  "query:tokens",
  "query:collections",
  "query:objects", 
  "query:logs",
  "query:config",
  "query:streamRoutes",
  "query:query",
  "mutation:updateConfig",
  "mutation:archiveSource",
  "mutation:registerExternalCredentials",
  "mutation:createSource",
  "mutation:deleteExternalCredentials",
  "mutation:deleteSource",
  "mutation:scheduleJobs",
  "mutation:updateSource",
  "mutation:createStreamRoute",
  "mutation:createQuery",
  "mutation:updateQuery", 
  "mutation:deleteQuery",
  "mutation:runQuery"
];
```

## Permission Validation

Each GraphQL resolver validates permissions by:

1. **Authentication Check**: Verifying `user.sub` exists
2. **Membership Lookup**: Finding the user's membership in the workspace
3. **Permission Verification**: Checking the required permission exists in the member's permissions array

### Example Implementation

```javascript
const member = await Member.findOne({ 
  workspaceId, 
  userId: user.sub,
  permissions: "query:apiKeys" // Required permission
});

if (!member) {
  throw new Error('User not authorized to perform this action');
}
```

## Permission Hierarchy

### Resource Hierarchy
- **Workspace Level**: `query:workspaces`, `mutation:createWorkspace`
- **Member Level**: `query:members` 
- **Data Level**: `query:sources`, `query:collections`, `query:objects`
- **Integration Level**: `query:tokens`, `query:integrations`
- **System Level**: `query:logs`, `query:config`

### Operation Hierarchy
- **Read Operations**: All `query:*` permissions
- **Write Operations**: All `mutation:*` permissions
- **Administrative**: `mutation:createWorkspace`, `mutation:updateConfig`

## Adding New Permissions

When implementing new GraphQL operations:

1. **Define Permission**: Follow `{operation}:{resource}` format
2. **Add to Constants**: Update `ALL_PERMISSIONS` array
3. **Update Defaults**: Add to default permissions if needed
4. **Implement Validation**: Use standard permission check pattern
5. **Update Documentation**: Add to this file
6. **Test**: Verify permission validation works correctly

### Example: Adding a New Permission

```javascript
// 1. Define the permission string
const NEW_PERMISSION = 'mutation:createReport';

// 2. Add to resolver validation
const member = await Member.findOne({ 
  workspaceId, 
  userId: user.sub,
  permissions: "mutation:createReport"
});

// 3. Add to ALL_PERMISSIONS array
// 4. Update documentation
```

## Security Considerations

- **Principle of Least Privilege**: Members should only have permissions they need
- **Default Permissions**: Review default permissions regularly
- **Permission Auditing**: Log permission checks for security auditing
- **Workspace Isolation**: Permissions are workspace-specific
- **No Permission Inheritance**: Permissions must be explicitly granted

## GraphQL Type Safety

The system includes a GraphQL enum for type safety:

```graphql
enum Permission {
  QUERY_MEMBERS
  QUERY_SOURCES
  # ... all permissions as enum values
}
```

Use this enum in GraphQL schemas to ensure type safety when working with permissions in the frontend. 
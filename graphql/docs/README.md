# GraphQL Server Documentation

## Overview

The GraphQL server provides a unified API for querying and mutating data across multiple workspaces in the AI Rank system. It handles authentication, workspace isolation, and data access control.

## Architecture

```
API Gateway → GraphQL Server → Workspace Databases
                  ↓
        [Auth + Workspace Isolation + Resolvers]
```

## Authentication Methods

### 1. JWT Token Authentication
- **Source**: Web application users via API Gateway
- **Header**: `Authorization: <encrypted-jwt-token>`
- **Process**:
  1. Token is decrypted using AES-256-GCM
  2. JWT payload contains user ID and workspace context
  3. Member permissions are validated per workspace

### 2. Bearer Token Authentication (API Keys)
- **Source**: MCP servers, external integrations via API Gateway
- **Header**: `Authorization: Bearer <api-key>`
- **Process**:
  1. API key is looked up in the `airank` database
  2. Workspace restriction is extracted from API key
  3. Permissions are pre-validated by API Gateway

## Workspace Isolation

### Multi-Tenant Architecture
- Each workspace has its own MongoDB database: `workspace_{workspaceId}`
- API keys are restricted to a single workspace
- JWT users can access multiple workspaces based on membership

### Workspace Resolution
```javascript
// For API Keys - automatic workspace restriction
if (user.isApiKey && user.restrictedWorkspaceId) {
  workspaceId = user.restrictedWorkspaceId; // Always use restricted workspace
}

// For JWT users - explicit workspace required
workspaceId = args.workspaceId || getWorkspaceIdFromSlug(args.workspaceSlug);
```

### Database Connections
```javascript
// Workspace-specific database
const dataLakeUri = `${MONGODB_URI}/workspace_${workspaceId}?${MONGODB_PARAMS}`;
const datalake = mongoose.createConnection(dataLakeUri);
```

## Resolver Architecture

### Main Resolver Wrappers
Each query/mutation has a wrapper that handles:
1. Workspace ID resolution
2. Authentication validation
3. Permission checking
4. Routing to specific resolvers

```javascript
objects: async (parent, args, context) => {
  let workspaceId = args.workspaceId || getWorkspaceIdFromSlug(args.workspaceSlug);
  
  // API key workspace restriction
  if (!workspaceId && context.user?.isApiKey && context.user.restrictedWorkspaceId) {
    workspaceId = context.user.restrictedWorkspaceId;
  }
  
  if (!workspaceId) {
    throw new Error('Workspace not found.');
  }
  
  return await objectsResolvers.objects(parent, { ...args, workspaceId }, context);
}
```

### Specific Resolvers
Located in `/queries/` and `/mutations/` directories:
- `objects/`: Data querying and retrieval
- `member/`: Workspace membership management
- `logs/`: System logging and audit trails
- `configs/`: Workspace configuration
- `queries/`: Saved query management
- `destinations/`: Data destination management
- `facts/`: Analytics and aggregations
- `apiKeys/`: API key management

## Objects Resolver (Primary Data Access)

### Security Features
```javascript
// Permission validation
if (user.bypassMemberCheck) {
  // API key - permissions pre-validated by API gateway
  // Enforce workspace restriction
  if (user.restrictedWorkspaceId) {
    if (workspaceId && workspaceId !== user.restrictedWorkspaceId) {
      return null; // Block access to wrong workspace
    }
    effectiveWorkspaceId = user.restrictedWorkspaceId;
  }
} else {
  // JWT user - check member permissions
  const member = await Member.findOne({ 
    workspaceId, 
    userId: user.sub,
    permissions: "query:objects" 
  });
  hasPermission = !!member;
}
```

### Data Access Patterns
```javascript
// Single object query
if (objectId) {
  const object = await collection.findOne({ 
    _id: new mongoose.Types.ObjectId(objectId) 
  });
  return { objects: [object], totalCount: 1, hasNextPage: false };
}

// Paginated query
const [objects, totalCount] = await Promise.all([
  collection.find({}).skip(skip).limit(limit).toArray(),
  collection.countDocuments()
]);
```

## Authentication Middleware

### Token Processing
```javascript
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  
  if (authHeader?.startsWith('Bearer ')) {
    // API Key authentication
    const bearerToken = authHeader.split(' ')[1];
    const apiKey = await lookupApiKey(bearerToken);
    
    req.user = {
      sub: 'api-key-user',
      isApiKey: true,
      bypassMemberCheck: true,
      restrictedWorkspaceId: apiKey.workspace
    };
  } else {
    // JWT authentication
    const decryptedToken = await decryptToken(authHeader);
    req.user = JSON.parse(decryptedToken);
  }
};
```

## Database Schema

### Workspace Databases
Each workspace database contains collections like:
- `peoples`: Contact/person records
- `deals`: Sales opportunity records
- `consolidated_accounts`: Account aggregations
- `tokens`: OAuth tokens for integrations
- `queries`: Saved queries
- `events`: Activity logs

### Main Database (`airank`)
- `workspaces`: Workspace metadata
- `members`: User-workspace relationships
- `apiKeys`: API key definitions and permissions

## Error Handling

### Authentication Errors
```javascript
// Missing workspace
if (!workspaceId) {
  throw new Error('Workspace not found.');
}

// Invalid API key
if (!apiKey) {
  return res.status(401).json({ error: 'Invalid API key' });
}

// Permission denied
if (!hasPermission) {
  return null; // GraphQL null response
}
```

### Database Errors
```javascript
try {
  await datalake.asPromise();
  // Database operations
} catch (error) {
  console.error('Database error:', error);
  throw new Error('Failed to query objects');
} finally {
  await datalake.close();
}
```

## Security Considerations

### Workspace Isolation
- **Critical**: API keys cannot access other workspaces
- **Validation**: Multiple layers of workspace checking
- **Enforcement**: Database-level isolation via separate connections

### Permission Model
```javascript
// API Key permissions (pre-validated by API Gateway)
user.bypassMemberCheck = true; // Skip member lookup
user.restrictedWorkspaceId = apiKey.workspace; // Enforce workspace

// JWT permissions (validated per request)
const member = await Member.findOne({
  workspaceId,
  userId: user.sub,
  permissions: requiredPermission
});
```

### Data Access Control
- All queries require workspace context
- Member permissions are checked for JWT users
- API key workspace restrictions are enforced
- Database connections are workspace-specific

## Configuration

### Environment Variables
- `MONGODB_URI`: Base MongoDB connection string
- `MONGODB_PARAMS`: Connection parameters
- `JWT_SECRET`: JWT decryption secret
- `PORT`: Server port (default: 3002)

### GraphQL Schema
- Type definitions in individual resolver files
- Merged schema with Apollo Server
- Introspection enabled in development

## Development Features

### Debugging
- Detailed logging for authentication flow
- Workspace resolution logging
- Database connection status
- Query execution tracing

### Hot Reloading
- Nodemon for development
- Automatic restart on file changes
- Environment variable reloading

## Production Considerations

### Performance
- Connection pooling for workspace databases
- Efficient query patterns with pagination
- Proper indexing on workspace collections

### Monitoring
- Request logging with user context
- Error tracking and alerting
- Database connection health checks
- Query performance metrics

### Security
- Input validation and sanitization
- Rate limiting (handled by API Gateway)
- Audit logging for sensitive operations
- Secure token handling

## API Examples

### Query Objects (API Key)
```graphql
# No workspace needed - uses restricted workspace
query {
  objects(collectionName: "peoples") {
    objects {
      _id
      data
    }
    totalCount
    hasNextPage
  }
}
```

### Query Objects (JWT)
```graphql
# Workspace required for JWT users
query {
  objects(workspaceId: "6824f4a47c8028d89b6ff8d6", collectionName: "peoples") {
    objects {
      _id
      data
    }
    totalCount
    hasNextPage
  }
}
```

### Create API Key
```graphql
mutation {
  createApiKey(
    workspaceSlug: "airank-dev"
    name: "MCP Server Key"
    permissions: ["query:objects", "/graphql:post"]
  ) {
    _id
    bearer
    permissions
  }
}
```

## Troubleshooting

### Common Issues

1. **Workspace not found**
   - Check workspace ID format
   - Verify workspace exists in database
   - Ensure API key has correct workspace association

2. **Permission denied**
   - Verify user has required permissions
   - Check member status for JWT users
   - Validate API key permissions

3. **Database connection errors**
   - Check MongoDB connection string
   - Verify workspace database exists
   - Check network connectivity

### Debug Mode
Enable detailed logging to see:
- Authentication flow details
- Workspace resolution process
- Database connection status
- Query execution plans

### Health Checks
- `/health` endpoint for service status
- Database connectivity validation
- Authentication system status 
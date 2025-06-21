# AI Rank Core Architecture

## System Overview

The AI Rank Core system consists of two main services that work together to provide secure, multi-tenant data access:

1. **API Gateway** (Port 3001) - Authentication, authorization, and request routing
2. **GraphQL Server** (Port 3002) - Data querying and workspace isolation

## Architecture Diagram

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Client Apps   │    │   MCP Servers   │    │  External APIs  │
│                 │    │                 │    │                 │
│ • Web App       │    │ • Claude MCP    │    │ • REST Clients  │
│ • Mobile App    │    │ • Custom Tools  │    │ • Webhooks      │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          │ JWT Tokens           │ Bearer Tokens        │ API Keys
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                    ┌─────────────▼─────────────┐
                    │      API Gateway         │
                    │      (Port 3001)         │
                    │                          │
                    │ • Authentication         │
                    │ • Authorization          │
                    │ • Rate Limiting          │
                    │ • IP/Domain Restrictions │
                    │ • Request Routing        │
                    └─────────────┬─────────────┘
                                  │
                                  │ Authenticated Requests
                                  │
                    ┌─────────────▼─────────────┐
                    │    GraphQL Server        │
                    │     (Port 3002)          │
                    │                          │
                    │ • Workspace Isolation    │
                    │ • Data Querying          │
                    │ • Permission Validation  │
                    │ • Database Connections   │
                    └─────────────┬─────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │     MongoDB Cluster      │
                    │                          │
                    │ • airank (main)          │
                    │ • workspace_xxx          │
                    │ • workspace_yyy          │
                    │ • workspace_zzz          │
                    └──────────────────────────┘
```

## Authentication Flow

### JWT Token Flow (Web Applications)
```
1. User logs in → JWT token issued
2. Client sends request with JWT token
3. API Gateway decrypts and validates JWT
4. Request forwarded to GraphQL with user context
5. GraphQL validates workspace membership
6. Data returned based on user permissions
```

### Bearer Token Flow (MCP/API Integrations)
```
1. API key created for workspace
2. Client sends request with Bearer token
3. API Gateway validates API key and permissions
4. Request forwarded to GraphQL with workspace restriction
5. GraphQL enforces workspace isolation
6. Data returned only from restricted workspace
```

## Security Layers

### Layer 1: API Gateway Security
- **Rate Limiting**: 200 requests/minute per identifier
- **IP Restrictions**: Optional IP allowlists per API key
- **Domain Restrictions**: Optional domain allowlists per API key
- **Permission Validation**: Fine-grained permission checking
- **Authentication**: JWT decryption and API key validation

### Layer 2: GraphQL Security
- **Workspace Isolation**: Database-level separation
- **Member Validation**: JWT user workspace membership
- **API Key Restrictions**: Enforced workspace boundaries
- **Data Access Control**: Collection-level permissions

### Layer 3: Database Security
- **Multi-Tenant Isolation**: Separate databases per workspace
- **Connection Security**: Authenticated MongoDB connections
- **Data Encryption**: MongoDB encryption at rest
- **Network Security**: VPC and firewall protection

## Workspace Isolation

### Database Structure
```
MongoDB Cluster
├── airank (main database)
│   ├── workspaces (workspace metadata)
│   ├── members (user-workspace relationships)
│   ├── apiKeys (API key definitions)
│   └── users (user accounts)
├── workspace_6824f4a47c8028d89b6ff8d6
│   ├── peoples (contacts)
│   ├── deals (opportunities)
│   ├── consolidated_accounts (accounts)
│   └── events (activity logs)
└── workspace_7935e5b58d9139e8a7c7g9e7
    ├── peoples
    ├── deals
    └── ...
```

### Access Control Matrix

| User Type | Workspace Access | Permission Model | Validation Layer |
|-----------|------------------|------------------|------------------|
| JWT User | Multi-workspace | Member-based | GraphQL Server |
| API Key | Single workspace | Pre-validated | API Gateway + GraphQL |
| Anonymous | None | N/A | API Gateway |

## Request Processing Pipeline

### 1. Request Reception (API Gateway)
```javascript
// Rate limiting check
if (requestCount > limit) return 429;

// Authentication
if (Bearer token) {
  apiKey = validateApiKey(token);
  checkIpRestrictions(apiKey, clientIp);
  checkDomainRestrictions(apiKey, origin);
} else {
  user = decryptJWT(token);
}

// Authorization
validatePermissions(user/apiKey, endpoint, method);
```

### 2. Request Forwarding
```javascript
// Add authentication context
headers['Authorization'] = originalAuthHeader;

// Proxy to GraphQL server
response = await proxy(graphqlServer, request);
```

### 3. GraphQL Processing
```javascript
// Extract user context
user = extractUserFromAuth(authHeader);

// Resolve workspace
if (user.isApiKey) {
  workspaceId = user.restrictedWorkspaceId;
} else {
  workspaceId = args.workspaceId || resolveFromSlug(args.workspaceSlug);
}

// Validate access
if (user.isApiKey && workspaceId !== user.restrictedWorkspaceId) {
  return null; // Block cross-workspace access
}

// Execute query
return await queryWorkspaceDatabase(workspaceId, query);
```

## Data Flow Examples

### MCP Server Querying Data
```
1. MCP Server → API Gateway
   POST /graphql
   Authorization: Bearer abc123...
   Body: { query: "{ objects(collectionName: \"peoples\") { ... } }" }

2. API Gateway validates:
   ✓ API key exists
   ✓ Has "query:objects" permission
   ✓ Has "/graphql:post" permission
   ✓ IP/domain restrictions pass

3. API Gateway → GraphQL Server
   POST /graphql
   Authorization: Bearer abc123...
   Body: { query: "{ objects(collectionName: \"peoples\") { ... } }" }

4. GraphQL Server:
   ✓ Looks up API key workspace: 6824f4a47c8028d89b6ff8d6
   ✓ Uses restricted workspace (no workspaceId in query)
   ✓ Connects to workspace_6824f4a47c8028d89b6ff8d6
   ✓ Queries peoples collection

5. Response: { data: { objects: [...] } }
```

### Web App User Querying Data
```
1. Web App → API Gateway
   POST /graphql
   Authorization: eyJhbGciOiJkaXI...
   Body: { query: "{ objects(workspaceId: \"6824f4a47c8028d89b6ff8d6\", ...) }" }

2. API Gateway:
   ✓ Decrypts JWT token
   ✓ Extracts user ID
   ✓ Forwards to GraphQL

3. GraphQL Server:
   ✓ Validates user membership in workspace
   ✓ Checks "query:objects" permission
   ✓ Connects to workspace_6824f4a47c8028d89b6ff8d6
   ✓ Queries data

4. Response: { data: { objects: [...] } }
```

## Configuration Management

### Environment Variables
```bash
# Database
MONGODB_URI=mongodb://localhost:27017
MONGODB_PARAMS=retryWrites=true&w=majority

# Authentication
JWT_SECRET=your-jwt-secret-key

# Services
API_GATEWAY_PORT=3001
GRAPHQL_PORT=3002

# External Services
REDIS_URL=redis://localhost:6379
```

### Service Discovery
- **Development**: localhost URLs
- **Production**: Docker service names
- **Auto-detection**: Based on `NODE_ENV`

## Monitoring and Observability

### Logging
- **API Gateway**: Request/response logging, auth events
- **GraphQL**: Query execution, database connections
- **Structured**: JSON format for log aggregation

### Metrics
- **Request Rate**: Requests per second by endpoint
- **Error Rate**: 4xx/5xx responses by service
- **Response Time**: P50/P95/P99 latencies
- **Database**: Connection pool usage, query performance

### Health Checks
- **API Gateway**: `/health` endpoint
- **GraphQL**: Database connectivity check
- **Dependencies**: MongoDB, Redis availability

## Deployment Architecture

### Development
```
localhost:3001 (API Gateway) → localhost:3002 (GraphQL) → localhost:27017 (MongoDB)
```

### Production
```
Load Balancer → API Gateway Cluster → GraphQL Cluster → MongoDB Replica Set
```

### Scaling Considerations
- **Horizontal**: Multiple instances of each service
- **Database**: MongoDB sharding for large workspaces
- **Caching**: Redis for rate limiting and session storage
- **CDN**: Static asset delivery

## Security Best Practices

### API Key Management
- Generate keys with sufficient entropy (32+ characters)
- Store keys securely (consider hashing in production)
- Implement key rotation policies
- Monitor key usage patterns

### Workspace Isolation
- Never trust client-provided workspace IDs for API keys
- Validate workspace access at multiple layers
- Use separate database connections per workspace
- Implement audit logging for cross-workspace attempts

### Network Security
- Use HTTPS/TLS for all communications
- Implement proper CORS policies
- Use VPC/private networks in production
- Regular security audits and penetration testing 
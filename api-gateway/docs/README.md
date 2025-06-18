# API Gateway Documentation

## Overview

The API Gateway serves as the entry point for all API requests in the Outrun system. It handles authentication, authorization, rate limiting, IP restrictions, and request routing to downstream services.

## Architecture

```
Client Request → API Gateway → Downstream Service (GraphQL/REST)
                    ↓
            [Auth + Permissions + Rate Limiting]
```

## Authentication Methods

### 1. JWT Token Authentication
- **Used for**: Web application users
- **Header**: `Authorization: <encrypted-jwt-token>`
- **Process**: 
  1. Token is decrypted using AES-256-GCM
  2. JWT payload is extracted and verified
  3. User context is established

### 2. Bearer Token Authentication (API Keys)
- **Used for**: MCP servers, external integrations
- **Header**: `Authorization: Bearer <api-key>`
- **Process**:
  1. API key is looked up in the `apiKeys` collection
  2. Permissions and restrictions are validated
  3. Workspace context is established

## Middleware Chain

### For Standard Routes
```
Request → Rate Limiting → API Key Auth → IP Check → Domain Check → Authorization → Route Handler
```

### For GraphQL Routes
```
Request → Rate Limiting → Auth Detection → Full Middleware Chain → GraphQL Proxy
```

## API Key Security Features

### Workspace Isolation
- Each API key is associated with a specific workspace
- API keys cannot access data from other workspaces
- Workspace ID is validated against the API key's restricted workspace

### Permission System
- Fine-grained permissions (e.g., `query:objects`, `/graphql:post`)
- Wildcard support for flexible permission matching
- Permissions are validated before routing to downstream services

### IP Restrictions
- Optional IP allowlist per API key
- Requests from non-allowed IPs are rejected
- Uses `do-connecting-ip` header for IP detection

### Domain Restrictions
- Optional domain allowlist per API key
- Origin header is validated against allowed domains
- CORS headers are automatically set

## Rate Limiting

- **Identifier**: Authorization header or IP address
- **Limit**: 200 requests per minute per identifier
- **Storage**: Redis for distributed rate limiting
- **Behavior**: Returns 429 status when limit exceeded

## Request Flow

### 1. Authentication Phase
```javascript
// JWT Token
if (authHeader && !authHeader.startsWith('Bearer ')) {
  // Decrypt and verify JWT token
  // Set user context with JWT payload
}

// Bearer Token (API Key)
if (authHeader && authHeader.startsWith('Bearer ')) {
  // Look up API key in database
  // Validate key exists and is active
  // Set API key context
}
```

### 2. Authorization Phase
```javascript
// Check permissions
const permission = `${endpoint}:${method}`;
// Match against API key permissions with wildcard support
// Validate workspace access for workspace-specific endpoints
```

### 3. Routing Phase
```javascript
// Proxy request to downstream service
// Forward Authorization header
// Handle response and errors
```

## GraphQL Specific Handling

### Authentication Detection
The GraphQL route handler automatically detects the authentication method:

```javascript
if (authHeader.startsWith('Bearer ')) {
  // API Key flow - use full middleware chain
  authenticateApiKey → checkIp → checkDomain → authorize
} else {
  // JWT flow - direct proxy with auth forwarding
}
```

### Request Processing
- Raw body is captured for GraphQL queries
- Authentication headers are forwarded to GraphQL server
- Workspace context is handled by the GraphQL server

## Configuration

### Environment Variables
- `MONGODB_URI`: MongoDB connection string
- `MONGODB_PARAMS`: MongoDB connection parameters
- `REDIS_URL`: Redis connection for rate limiting
- `JWT_SECRET`: Secret for JWT token decryption

### Database Collections
- `apiKeys`: API key storage with permissions and restrictions
- `workspaces`: Workspace metadata for validation

## Error Handling

### Authentication Errors
- `401 Unauthorized`: Invalid or missing credentials
- `401 Forbidden`: IP/domain restrictions violated
- `401 Insufficient permissions`: Permission validation failed

### Rate Limiting Errors
- `429 Too Many Requests`: Rate limit exceeded

### Server Errors
- `500 Internal Server Error`: Database or processing errors

## Security Considerations

### API Key Storage
- API keys are stored as plaintext in the database
- Consider implementing key hashing for production
- Keys should be generated with sufficient entropy

### Workspace Isolation
- Critical for multi-tenant security
- Validated at multiple layers (API gateway + downstream services)
- Prevents cross-workspace data access

### Permission Validation
- Permissions are checked before routing
- Wildcard matching allows flexible permission schemes
- Failed permission checks are logged

## Monitoring and Logging

### Request Logging
- All requests are logged with method, path, and auth status
- GraphQL queries are logged with full body
- Permission checks and results are logged

### Error Logging
- Authentication failures
- Permission violations
- Rate limiting events
- Database connection issues

## Development vs Production

### Development Mode (`isProduction = false`)
- Detailed logging enabled
- Uses localhost URLs for service discovery
- CORS headers are permissive

### Production Mode (`isProduction = true`)
- Reduced logging
- Uses Docker service names for routing
- Stricter security headers

## API Key Management

### Creating API Keys
API keys are created through the GraphQL `createApiKey` mutation with:
- `name`: Human-readable identifier
- `permissions`: Array of permission strings
- `allowedIps`: Optional IP allowlist
- `allowedDomains`: Optional domain allowlist
- `workspace`: Associated workspace ID

### Permission Examples
```javascript
// Object querying
"query:objects"

// GraphQL access
"/graphql:post"

// Wildcard permissions
"/api/v1/*:get"
```

## Troubleshooting

### Common Issues

1. **401 Unauthorized**
   - Check API key exists in database
   - Verify Authorization header format
   - Check IP/domain restrictions

2. **403 Insufficient Permissions**
   - Verify API key has required permissions
   - Check permission string format
   - Ensure workspace access is correct

3. **429 Rate Limited**
   - Check Redis connection
   - Verify rate limiting configuration
   - Consider increasing limits for legitimate use

### Debug Mode
Enable detailed logging by setting `isProduction = false` to see:
- Full request details
- Permission checking process
- Database query results
- Routing decisions 
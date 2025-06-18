# Outrun MCP Server

This is the Model Context Protocol (MCP) server for Outrun, providing AI models with read-only access to workspace data through a standardized protocol.

## Architecture

The MCP server acts as a protocol translator that routes requests through the existing API Gateway:

```
MCP Client (Claude/etc) 
    ↓ MCP Protocol
MCP Server (Port 3004)
    ↓ HTTP + Bearer Token  
API Gateway (Port 3001)
    ↓ JWT Token + Permissions
GraphQL Service (Port 3002)
```

## Key Features

- **Protocol Translation**: Converts MCP protocol requests to GraphQL queries
- **Security**: Uses existing API key authentication and permissions system
- **Read-Only Access**: Only allows query operations, no mutations
- **Workspace Isolation**: Each bearer token is scoped to a specific workspace
- **Rate Limiting**: Inherits rate limiting from the API Gateway

## Available Resources

### `workspace://schema`
Returns the GraphQL schema for introspection by AI models.

### `workspace://info`
Returns workspace information and metadata.

## Available Tools

### `execute-query`
Execute read-only GraphQL queries against the workspace.

**Parameters:**
- `workspaceSlug` (string): The workspace slug to query
- `query` (string): The GraphQL query to execute
- `variables` (object, optional): Variables for the GraphQL query

### `list-objects`
List objects from the workspace with optional filtering.

**Parameters:**
- `workspaceSlug` (string): The workspace slug
- `objectType` (string, optional): Filter by object type
- `limit` (number, optional): Number of objects to return (1-100, default: 10)

### `get-object-count`
Get the count of objects in the workspace.

**Parameters:**
- `workspaceSlug` (string): The workspace slug
- `objectType` (string, optional): Object type to count

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Variables
The MCP server uses the following environment variables:
- `PORT`: Server port (default: 3004)
- `API_GATEWAY_URL`: URL of the API Gateway (default: http://outrun-core-api-gateway:3001)

### 3. Start the Server
```bash
# Development
npm run dev

# Production
npm start
```

## Client Configuration

To use the MCP server with an AI client like Claude Desktop, add this configuration:

```json
{
  "mcpServers": {
    "outrun": {
      "command": "npx",
      "args": [
        "@modelcontextprotocol/server-fetch",
        "https://api.outrun.com/mcp"
      ],
      "env": {
        "OUTRUN_BEARER_TOKEN": "your-bearer-token-here"
      }
    }
  }
}
```

## Bearer Token Creation

Bearer tokens are created through the Outrun UI:

1. Navigate to `/{workspaceSlug}/destinations/add/mcp`
2. Follow the 3-step wizard:
   - **Step 1**: Configure connection name and permissions
   - **Step 2**: Set security restrictions (IPs, domains)
   - **Step 3**: Copy the generated configuration

## Permissions

The MCP server requires the following permissions on the bearer token:
- `query:objects`: Read access to workspace objects
- `query:workspaces`: Read access to workspace information  
- `/graphql:post`: Execute GraphQL queries through the API gateway

## Security

- **Read-Only**: Only query operations are allowed, mutations are blocked
- **Bearer Token**: Each request must include a valid bearer token
- **Workspace Scoping**: Tokens are scoped to specific workspaces
- **IP/Domain Restrictions**: Optional IP and domain allowlists
- **Rate Limiting**: Inherits rate limiting from the API Gateway

## Testing

Run the test suite to verify the server is working correctly:

```bash
node test-mcp.js
```

## Development

The MCP server is included in the development environment:

```bash
# Start all services including MCP
npm run dev

# Or use the legacy command
npm run dev:legacy
```

The server will be available at `http://localhost:3004` and included in the API Gateway routing.

## Integration

The MCP server integrates with the existing Outrun infrastructure:

- **API Gateway**: Routes MCP requests and handles authentication
- **GraphQL Service**: Executes the actual data queries
- **MongoDB**: Data storage (accessed via GraphQL)
- **Redis**: Rate limiting and session management

## Troubleshooting

### Common Issues

1. **Authentication Errors**: Ensure the bearer token is valid and has the correct permissions
2. **Workspace Access**: Verify the bearer token is scoped to the correct workspace
3. **Rate Limiting**: Check if you're hitting rate limits in the API Gateway
4. **Network Issues**: Ensure the MCP server can reach the API Gateway

### Debug Mode

Set `NODE_ENV=development` to enable debug logging and detailed error messages.

### Health Check

The server provides a health check endpoint:
```bash
curl http://localhost:3004/health
```

## License

This MCP server is part of the Outrun platform and follows the same licensing terms. 
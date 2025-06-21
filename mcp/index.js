// airank-core/mcp/index.js

const express = require('express');
const { randomUUID } = require('node:crypto');
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { isInitializeRequest } = require("@modelcontextprotocol/sdk/types.js");
const axios = require('axios');
const { z } = require('zod');
require('dotenv').config();

const app = express();
app.use(express.json());

// Configure API Gateway client
const apiGatewayUrl = process.env.API_GATEWAY_URL || 'http://airank-core-api-gateway:3001';
const graphqlClient = axios.create({
  baseURL: apiGatewayUrl,
  timeout: 30000
});

// Map to store transports by session ID
const transports = {};

// Helper function to forward GraphQL requests to API Gateway
const forwardToGraphQL = async (query, variables, bearerToken) => {
  try {
    console.log('Forwarding GraphQL request to API Gateway:', { query: query.substring(0, 100) + '...', variables });
    
    const response = await graphqlClient.post('/graphql', {
      query,
      variables
    }, {
      headers: {
        'Authorization': bearerToken,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(response.data.errors)}`);
    }
    
    return response.data;
  } catch (error) {
    console.error('GraphQL request failed:', error.message);
    throw new Error(`GraphQL request failed: ${error.response?.data?.error?.message || error.message}`);
  }
};

// Create MCP server factory function
const createMcpServer = (bearerToken) => {
  const server = new McpServer({
    name: "AI Rank Data Access",
    version: "1.0.0"
  });

  // Resource: Workspace Schema Discovery
  server.resource(
    "workspace-schema",
    "workspace://schema",
    async (uri) => {
      const introspectionQuery = `
        query IntrospectionQuery {
          __schema {
            queryType { 
              name 
              fields { 
                name 
                description
                type { name kind }
                args { name type { name kind } }
              } 
            }
            types { 
              name 
              kind 
              description
              fields { 
                name 
                description
                type { name kind }
              }
            }
          }
        }
      `;
      
      const result = await forwardToGraphQL(introspectionQuery, {}, bearerToken);
      
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(result.data.__schema, null, 2),
          mimeType: "application/json"
        }]
      };
    }
  );

  // Resource: Workspace Information
  server.resource(
    "workspace-info", 
    "workspace://info",
    async (uri) => {
      const query = `
        query GetWorkspaces {
          workspaces {
            _id
            name
            slug
            createdAt
          }
        }
      `;
      
      const result = await forwardToGraphQL(query, {}, bearerToken);
      
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(result.data.workspaces, null, 2),
          mimeType: "application/json"
        }]
      };
    }
  );

  // Tool: Execute Read-Only Query
  server.tool(
    "execute-query",
    { 
      workspaceSlug: z.string().describe("The workspace slug to query"),
      query: z.string().describe("The GraphQL query to execute (read-only operations only)"),
      variables: z.record(z.any()).optional().describe("Variables for the GraphQL query")
    },
    async ({ workspaceSlug, query, variables = {} }) => {
      // Basic validation to ensure only read operations
      const trimmedQuery = query.trim().toLowerCase();
      if (trimmedQuery.startsWith('mutation') || trimmedQuery.includes('mutation')) {
        throw new Error('Only read-only queries are allowed. Mutations are not permitted.');
      }
      
      const result = await forwardToGraphQL(query, { workspaceSlug, ...variables }, bearerToken);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result.data, null, 2)
        }]
      };
    }
  );

  // Tool: List Objects
  server.tool(
    "list-objects",
    {
      workspaceSlug: z.string().describe("The workspace slug"),
      objectType: z.string().optional().describe("Filter by object type"),
      limit: z.number().min(1).max(100).default(10).describe("Number of objects to return")
    },
    async ({ workspaceSlug, objectType, limit }) => {
      const query = `
        query ListObjects($workspaceSlug: String!, $objectType: String, $limit: Int) {
          workspace(slug: $workspaceSlug) {
            objects(type: $objectType, limit: $limit) {
              id
              type
              properties
              createdAt
              updatedAt
            }
          }
        }
      `;
      
      const result = await forwardToGraphQL(
        query, 
        { workspaceSlug, objectType, limit }, 
        bearerToken
      );
      
      return {
        content: [{
          type: "text", 
          text: JSON.stringify(result.data, null, 2)
        }]
      };
    }
  );

  // Tool: Get Object Count
  server.tool(
    "get-object-count",
    {
      workspaceSlug: z.string().describe("The workspace slug"),
      objectType: z.string().optional().describe("Object type to count")
    },
    async ({ workspaceSlug, objectType }) => {
      const query = `
        query GetObjectCount($workspaceSlug: String!, $objectType: String) {
          workspace(slug: $workspaceSlug) {
            objectCount(type: $objectType)
          }
        }
      `;
      
      const result = await forwardToGraphQL(
        query,
        { workspaceSlug, objectType },
        bearerToken
      );
      
      return {
        content: [{
          type: "text",
          text: `Object count: ${result.data.workspace.objectCount}`
        }]
      };
    }
  );

  return server;
};

// Handle POST requests for client-to-server communication
app.post('/mcp', async (req, res) => {
  try {
    // Extract bearer token from Authorization header
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bearer token required in Authorization header',
        },
        id: null,
      });
    }

    const bearerToken = authHeader;
    const sessionId = req.headers['mcp-session-id'];
    let transport;

    if (sessionId && transports[sessionId]) {
      // Reuse existing transport
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New initialization request
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          transports[sessionId] = transport;
        }
      });

      // Clean up transport when closed
      transport.onclose = () => {
        if (transport.sessionId) {
          delete transports[transport.sessionId];
        }
      };

      // Create MCP server with bearer token
      const server = createMcpServer(bearerToken);
      await server.connect(transport);
    } else {
      return res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      });
    }

    // Handle the request
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

// Reusable handler for GET and DELETE requests
const handleSessionRequest = async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  
  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
};

// Handle GET requests for server-to-client notifications via SSE
app.get('/mcp', handleSessionRequest);

// Handle DELETE requests for session termination
app.delete('/mcp', handleSessionRequest);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'mcp-server' });
});

const port = process.env.PORT || 3004;
app.listen(port, () => {
  console.log(`MCP Server listening on port ${port}`);
  console.log(`API Gateway URL: ${apiGatewayUrl}`);
});
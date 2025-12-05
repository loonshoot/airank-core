// api-gateway/index.js

const express = require('express');
const httpProxy = require('http-proxy');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const stream = require('stream');
// const jwt = require('jsonwebtoken'); // Import JWT library (No longer needed)
require('dotenv').config(); // Load environment variables from .env
const { promisify } = require('util');
const crypto = require('crypto');
const hkdf = promisify(crypto.hkdf);

// Import jose dynamically
let jwtDecrypt, jwtEncrypt;
(async () => {
  const jose = await import('jose');
  jwtDecrypt = jose.jwtDecrypt;
  jwtEncrypt = jose.jwtEncrypt;
})();

const app = express();
const proxy = httpProxy.createProxyServer();
const port = process.env.API_GATEWAY_PORT || 4001; // Use environment variable or fallback to 4001

// Global CORS middleware - runs before all other middleware
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, do-connecting-ip');

  // Handle preflight OPTIONS requests immediately
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  next();
});

const routesFilePath = path.join(__dirname, 'routes.json');
const isProduction = process.env.NODE_ENV === 'production';

let routesConfig;

const redis = require('redis');
const redisClient = redis.createClient({ url: process.env.REDIS_URL }); // Configure your Redis connection
redisClient.connect();

try {
  const routesFileData = fs.readFileSync(routesFilePath, 'utf8');
  routesConfig = JSON.parse(routesFileData);
} catch (error) {
  console.error('Error reading routes file:', error);
  process.exit(1);
}

// After routes config setup, add a simple environment variable for proxy URL modification

// For development, let's check if we have a ngrok URL to use
if (!isProduction && process.env.REDIS_URL) {
  try {
    // Check Redis for ngrok URL once at startup
    redisClient.get('airank:dev:ngrok:url').then(ngrokUrl => {
      if (ngrokUrl) {
        console.log(`Found ngrok URL in Redis: ${ngrokUrl}`);
        process.env.NGROK_URL = ngrokUrl;
      }
    }).catch(err => {
      console.warn('Error getting ngrok URL from Redis:', err.message);
    });
  } catch (error) {
    console.warn('Error setting up ngrok URL check:', error.message);
  }
}

// MongoDB connection
const mongoUri = `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`;
mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    console.log('Connected to MongoDB');

    // Define the API Key schema and model
    const apiKeySchema = new mongoose.Schema({
      bearer: String,
      permissions: [String],
      name: String,
      allowedIps: [String],
      allowedDomains: [String],
      workspace: String,
      createdBy: String
    });

    const ApiKey = mongoose.model('ApiKey', apiKeySchema, 'apiKeys');

    // Rate Limiting Schema and Model
    const rateLimitSchema = new mongoose.Schema({
      identifier: String, // apiKey or IP address
      timestamp: { type: Date, expires: 60, default: Date.now }, // Expires after 1 minute
      count: { type: Number, default: 0 }
    });

    const RateLimit = mongoose.model('RateLimit', rateLimitSchema, 'rateLimits');

    // Log Schema and Model
    const logSchema = new mongoose.Schema({
      type: { type: String, enum: ['graphql', 'rest'], required: true },
      userId: String,
      request: {
        method: String,
        path: String,
        headers: Object,
        body: mongoose.Schema.Types.Mixed
      },
      response: {
        statusCode: Number,
        error: String,
        body: mongoose.Schema.Types.Mixed
      },
      timestamp: { type: Date, default: Date.now }
    });

    // Function to redact sensitive data
    const redactString = (str) => {
      if (!str || typeof str !== 'string' || str.length < 4) return str;
      return str.slice(0, 2) + '***' + str.slice(-2);
    };

    const redactObject = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;
      const redacted = {};
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'object' && value !== null) {
          redacted[key] = redactObject(value);
        } else if (typeof value === 'string') {
          redacted[key] = redactString(value);
        } else {
          redacted[key] = value;
        }
      }
      return redacted;
    };

    // Middleware for handling preflight requests (OPTIONS)
    app.options('*', (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, do-connecting-ip');
      res.status(200).end();
    });

    // JWT Authentication middleware (using our custom decryption)
    const authenticateJWT = async (req, res, next) => {
        
      // Set CORS headers 
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, do-connecting-ip');
  
      const authHeader = req.headers['authorization'];
      console.log("Auth Header:" + authHeader)
      // Check if Bearer token is provided
      if (!authHeader) {
        console.log('Forbidden: JWT token missing or invalid format');
        return res.status(401).send({
          error: {
            message: 'Forbidden: JWT token missing or invalid format',
            code: 'AUTH_ERROR'
          }
        });
      }
      // This middleware is for JWT tokens only - Bearer tokens are handled separately
      if (authHeader.startsWith('Bearer')) {
        console.log('Bearer token detected - this should be handled by API key auth');
        return res.status(401).send({
          error: {
            message: 'Bearer tokens should use API key authentication',
            code: 'AUTH_ERROR'
          }
        });
      }

      const token = authHeader;

      try {
        // Decrypt the JWT token using jose
        const decodedToken = await decryptToken(token, process.env.JWT_SECRET); 
        req.user = decodedToken; // Store decoded user data

        // Check for token expiration
        if (decodedToken.exp < Math.floor(Date.now() / 1000)) {
          console.error('JWT Authentication failed: Token expired');
          return res.status(401).send({
            error: {
              message: 'Unauthorized: JWT token expired',
              code: 'AUTH_ERROR'
            }
          });
        }

        if (!isProduction) {
          console.log(req.user)
          console.log('JWT Authentication successful.');
        }

        next();
      } catch (error) {
        console.error('JWT Authentication failed:', error);
        return res.status(401).send({
          error: {
            message: 'Unauthorized: Invalid JWT token',
            code: 'AUTH_ERROR'
          }
        });
      }
    };

    // API Key Authentication middleware (for REST APIs)
    const authenticateApiKey = async (req, res, next) => {
        
      // Set CORS headers 
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, do-connecting-ip');
  
      const authHeader = req.headers['authorization'];
      if (!authHeader) {
        console.log('Forbidden: API key missing');
        return res.status(401).send({
          error: {
            message: 'Forbidden: API key missing',
            code: 'AUTH_ERROR'
          }
        });
      }

      const parts = authHeader.split(' ');
      if (parts.length !== 2 || parts[0] !== 'Bearer') {
        console.log('Forbidden: Invalid Authorization header format');
        return res.status(401).send({
          error: {
            message: 'Forbidden: Invalid Authorization header format',
            code: 'AUTH_ERROR'
          }
        });
      }

      const apiKey = parts[1];

      try {
        const keyDoc = await ApiKey.findOne({ bearer: apiKey }).exec();
        if (!keyDoc) {
          console.log('Forbidden: Invalid API key');
          return res.status(401).send({
            error: {
              message: 'Forbidden: Invalid API key',
              code: 'AUTH_ERROR'
            }
          });
        }
        req.apiKey = keyDoc;
        next();
      } catch (err) {
        console.error('Error authenticating API key:', err);
        res.status(500).send({
          error: {
            message: 'Internal Server Error',
            code: 'SERVER_ERROR'
          }
        });
      }
    };

  // IP and API Key based Rate Limiting Middleware
  const checkRateLimit = async (req, res, next) => {
    let identifier;

    // Prioritize user ID from JWT if available
    if (req.headers['authorization']) {
      identifier = req.headers['authorization'];
    } else if (req.headers['do-connecting-ip']) {
      identifier = req.headers['do-connecting-ip'];
    } else {
      return res.status(429).json({ error: 'No identifer received' });
    }

    console.log(identifier)

    try {
      const rateLimitKey = `ratelimit:${identifier}`;
      const count = await redisClient.incr(rateLimitKey); // Atomic increment in Redis
  
      if (count > 200) {
        return res.status(429).json({ error: 'Too Many Requests' });
      }
  
      // Set expiry (1 minute) for the rate limit
      redisClient.expire(rateLimitKey, 60);
      next();
    } catch (error) {
      console.error('Rate limiting error:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  };

    const checkIp = (req, res, next) => {
      const clientIp = req.headers['do-connecting-ip']; 
      const allowedIps = req.apiKey.allowedIps;
      if (allowedIps.length > 0 && !allowedIps.includes(clientIp)) {
        console.log(`Forbidden: IP address ${clientIp} not allowed`);
        return res.status(401).send({
          error: {
            message: 'Forbidden: IP address not allowed',
            code: 'AUTH_ERROR'
          }
        });
      }
      next();
    };

    const checkDomain = (req, res, next) => {
      const origin = req.headers['origin'];
      const allowedDomains = req.apiKey.allowedDomains;
      if (allowedDomains.length > 0 && !allowedDomains.includes(origin)) {
        console.log(`Forbidden: Origin ${origin} not allowed`);
        return res.status(401).send({
          error: {
            message: 'Forbidden: Origin not allowed',
            code: 'AUTH_ERROR'
          }
        });
      }
      next();
    };

    const authorize = async (req, res, next) => {
      const endpoint = (req.baseUrl + req.path).replace(/\/$/, '');
      const method = req.method.toLowerCase();
      const permission = `${endpoint}:${method}`;

      if (!isProduction) {
        console.log('Requested permissions:', permission);
        console.log('API Key Permissions:', req.apiKey.permissions);
      }
      
      // For MCP GraphQL requests, we don't have workspaceID in the path
      // Instead, workspace context comes from the GraphQL query variables
      const workspaceID = req.params.workspaceID;
      if (workspaceID && req.apiKey.workspace !== workspaceID) {
        console.error('Unauthorized: Workspace ID mismatch');
        return res.status(401).send({
          error: {
            message: 'Forbidden: Workspace ID mismatch',
            code: 'AUTH_ERROR'
          }
        });
      }

      // Permission matching with wildcard support
      for (const allowedPermission of req.apiKey.permissions) {
        const regex = new RegExp(`^${allowedPermission.replace(/:[^:]*/g, '(.*)')}$`);
        if (regex.test(permission)) {
          console.log('Permission granted for:', permission);
          return next();
        }
      }

      console.error('Insufficient permissions for:', permission);
      return res.status(401).send({
        error: {
          message: 'Forbidden: Insufficient permissions',
          code: 'AUTH_ERROR'
        }
      });
    };

    // Add raw body parser for GraphQL requests
    const getRawBody = (req) => {
      return new Promise((resolve) => {
        let data = '';
        req.on('data', chunk => {
          data += chunk;
        });
        req.on('end', () => {
          resolve(data);
        });
      });
    };

    // Add Workspace model
    const workspaceSchema = new mongoose.Schema({
      _id: String,
      slug: String
    });

    const Workspace = mongoose.model('Workspace', workspaceSchema, 'workspaces');

    const routeHandler = (targetUrl) => {
      return async (req, res) => {
        let workspaceId;
        let logDb;
        
        // Get the full URL path
        const fullPath = req.originalUrl || req.url;
        console.log('Full Request Path:', fullPath);
        console.log('Method:', req.method);
        console.log('Content-Type:', req.headers['content-type']);
        
        if (fullPath.includes('/graphql')) {
          console.log('Processing GraphQL request');
          // For GraphQL requests, read the raw body
          const rawBody = await getRawBody(req);
          console.log('Raw Body:', rawBody);
          
          let graphqlPayload;
          
          try {
            if (rawBody) {
              graphqlPayload = JSON.parse(rawBody);
              // Store the parsed body for logging
              req.body = graphqlPayload;
              
              // Extract operation type and name for path
              const operationType = graphqlPayload.query?.trim().startsWith('mutation') ? 'mutations' : 'queries';
              const operationMatch = graphqlPayload.query?.match(/(?:query|mutation)\s+(\w+)/);
              const operationName = operationMatch?.[1] || 'anonymous';
              req.graphqlPath = `/${operationType}/${operationName}`;
              
              // Reconstruct the request stream
              req.removeAllListeners('data');
              req.removeAllListeners('end');
              
              // Create a new readable stream from the raw body
              const Readable = require('stream').Readable;
              const bodyStream = new Readable();
              bodyStream._read = () => {}; // _read is required but you can noop it
              bodyStream.push(rawBody);
              bodyStream.push(null);
              
              // Replace the original request with our new stream
              Object.assign(req, bodyStream);
              
              // Check if workspaceSlug is in variables
              if (graphqlPayload.variables?.workspaceSlug) {
                console.log('Found workspaceSlug:', graphqlPayload.variables.workspaceSlug);
                const workspace = await Workspace.findOne({ 
                  slug: graphqlPayload.variables.workspaceSlug 
                });
                
                if (workspace) {
                  console.log('Found workspace:', workspace._id);
                  workspaceId = workspace._id;
                  logDb = mongoose.createConnection(
                    `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`
                  );
                } else {
                  console.log('No workspace found for slug:', graphqlPayload.variables.workspaceSlug);
                }
              }
            }
          } catch (err) {
            console.error('Error processing GraphQL payload:', err);
          }
        }

        // If no workspace-specific DB, use airank DB
        if (!logDb) {
          logDb = mongoose.createConnection(
            `${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`
          );
        }

        const Log = logDb.model('Log', logSchema, 'logs');

        // Prepare log entry
        const logEntry = {
          type: (req.originalUrl || req.url).includes('/graphql') ? 'graphql' : 'rest',
          userId: req.user?.sub || req.apiKey?.createdBy,
          request: {
            method: req.method,
            path: req.graphqlPath || req.path,
            headers: redactObject(req.headers),
            body: req.body ? redactObject(JSON.parse(JSON.stringify(req.body))) : undefined
          }
        };

        // Construct the target URL correctly
        let proxyUrl = `${targetUrl}`;
    
        if (!isProduction) {
          // Extract domain
          const domainMatch = targetUrl.match(/^(.*):\d+/);
          const domainPort = targetUrl.match(/:(\d+)/);
          if (domainMatch) {
            const domain = domainMatch[0];
            const localUrl = 'http://localhost' + domainPort[0];
            proxyUrl = proxyUrl.replace(domain, localUrl);
          }
        }
        
        console.log(`Proxying to: ${proxyUrl} (original: ${targetUrl}, isProduction: ${isProduction})`);
    
        // For requests coming to a webhook route and we have an ngrok URL, add a header to identify it
        if (req.path.includes('/api/v1/webhook') && !isProduction && process.env.NGROK_URL) {
          req.headers['x-forwarded-host'] = new URL(process.env.NGROK_URL).host;
          req.headers['x-ngrok-url'] = process.env.NGROK_URL;
          console.log(`Webhook request received via ngrok: ${process.env.NGROK_URL}`);
        }

        // Forward the Authorization header
        const authHeader = req.headers['authorization'];
        if (authHeader) {
          req.headers['Authorization'] = authHeader;
        } 

        // Set up response interception
        const originalWrite = res.write;
        const originalEnd = res.end;
        const chunks = [];

        res.write = function (chunk) {
          if (chunk) {
            chunks.push(Buffer.from(chunk));
          }
          return originalWrite.apply(res, arguments);
        };

        res.end = function (chunk) {
          if (chunk) {
            chunks.push(Buffer.from(chunk));
          }

          // Get the complete response body
          const body = Buffer.concat(chunks).toString('utf8');
          
          // Create the log entry
          logEntry.response = {
            statusCode: res.statusCode,
            error: res.statusCode >= 400 ? body : undefined,
            body: body ? redactObject(JSON.parse(body)) : undefined
          };

          // Save log entry asynchronously
          Log.create(logEntry).catch(err => {
            console.error('Error saving log entry:', err);
          }).finally(() => {
            logDb.close();
          });

          // Call original end with original arguments
          return originalEnd.apply(res, arguments);
        };

        // Modify the proxy.web call to NOT include the buffer option
        const proxyOptions = {
          target: proxyUrl,
          changeOrigin: true,
          headers: {
            'Content-Type': 'application/json'
          }
        };

        proxy.web(req, res, proxyOptions, (err) => {
          if (err) {
            console.error(`Error forwarding request to ${proxyUrl}: ${err.message}`);
            logEntry.response = {
              statusCode: 500,
              error: err.message,
              body: 'Internal Server Error'
            };
            
            // Save error log entry
            Log.create(logEntry).catch(logErr => {
              console.error('Error saving log entry:', logErr);
            }).finally(() => {
              logDb.close();
            });

            res.status(500).send({
              error: {
                message: 'Internal Server Error',
                code: 'SERVER_ERROR'
              }
            });
          }
        });
      };
    };

    proxy.on('error', (err, req, res) => {
      console.error('Proxy error:', err);
      res.status(500).send({
        error: {
          message: 'Proxy error',
          code: 'SERVER_ERROR'
        }
      });
    });

    // Dynamically set up routes from config
    routesConfig.routes.forEach(route => {
      let targetUrl = route.target;

      if (route.type === 'rest') {
        if (route.headerlessAuth) {
          // Skip authentication header check for routes with headerlessAuth: true
          app.use(route.path, checkRateLimit, routeHandler(targetUrl));
        } else {
          // Normal authentication flow for other routes
          app.use(route.path, checkRateLimit, authenticateApiKey, checkIp, checkDomain, authorize, routeHandler(targetUrl));
        }
      } else if (route.type === 'graphql') {
        // For GraphQL, support both JWT tokens (direct access) and API keys (MCP access)
        const graphqlAuthHandler = async (req, res, next) => {
          const authHeader = req.headers['authorization'];
          
          if (!authHeader) {
            return res.status(401).send({
              error: { message: 'Authorization header missing', code: 'AUTH_ERROR' }
            });
          }

          // Check if it's a Bearer token (API key for MCP) or JWT token
          if (authHeader.startsWith('Bearer ')) {
            // This is an API key from MCP server - use API key auth with full middleware chain
            return authenticateApiKey(req, res, (err) => {
              if (err) return next(err);
              // For API keys, also run IP/domain checks and authorization
              checkIp(req, res, (err) => {
                if (err) return next(err);
                checkDomain(req, res, (err) => {
                  if (err) return next(err);
                  authorize(req, res, next);
                });
              });
            });
          } else {
            // This is a JWT token - use JWT auth (no additional checks needed)
            return authenticateJWT(req, res, next);
          }
        };
        
        app.use(route.path, checkRateLimit, graphqlAuthHandler, routeHandler(targetUrl));
      } else {
        console.warn(`Unknown route type: ${route.type}`);
      }
    });

    app.listen(port, () => {
      console.log(`API Gateway listening on port ${port}`);
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

// JWT Encryption function
async function encryptToken(payload, secret) {
  const encryptionKey = await getDerivedEncryptionKey(secret, "");
  const encryptedToken = await jwtEncrypt(payload, encryptionKey);
  return encryptedToken;
}

async function getDerivedEncryptionKey(keyMaterial, salt) {
  const info = Buffer.from('NextAuth.js Generated Encryption Key', 'utf8');
  const derivedKey = await hkdf('sha256', keyMaterial, salt, info, 32);
  return new Uint8Array(derivedKey);
}
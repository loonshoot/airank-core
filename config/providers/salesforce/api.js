const mongoose = require('mongoose');
const crypto = require('crypto');
const axios = require('axios');
const { TokenSchema, SourceSchema } = require('../../data/models');
const fs = require('fs');
const path = require('path');
const redis = require('redis');

// Redis client management - with retries and better error handling
let redisClient = null;
let redisConnectionFailed = false;

async function getRedisClient() {
  // If we've already failed to connect, don't keep trying
  if (redisConnectionFailed) {
    return null;
  }
  
  // If we already have a connected client, return it
  if (redisClient && redisClient.isReady) {
    return redisClient;
  }
  
  // Check if Redis URL is configured
  if (!process.env.REDIS_URL) {
    console.warn('Salesforce API: REDIS_URL not set in environment variables');
    redisConnectionFailed = true;
    return null;
  }
  
  try {
    // Create a new client if needed
    if (!redisClient) {
      redisClient = redis.createClient({ url: process.env.REDIS_URL });
      
      // Handle disconnect events
      redisClient.on('error', (err) => {
        console.warn('Salesforce API: Redis connection error:', err.message);
      });
    }
    
    // Connect if not already connected
    if (!redisClient.isReady) {
      await redisClient.connect();
      console.log('Salesforce API: Successfully connected to Redis');
    }
    
    return redisClient;
  } catch (error) {
    console.error('Salesforce API: Failed to connect to Redis:', error.message);
    redisConnectionFailed = true;
    return null;
  }
}

// Function to get a valid token (refreshes if necessary)
async function getValidToken(TokenModel, token, workspaceId) {
  return new Promise(async (resolve, reject) => {
    let currentTokenData = token.toObject ? token.toObject() : token;
    
    if (!currentTokenData || !currentTokenData.expiryTime || !currentTokenData.encryptedAuthToken || !currentTokenData.encryptedAuthTokenIV) {
        console.error('[getValidToken] Invalid tokenData received:', JSON.stringify(currentTokenData));
        return reject(new Error('Invalid token data received in getValidToken'));
    }

    const currentTime = Date.now();
    const timeRemaining = currentTokenData.expiryTime - currentTime;

    if (timeRemaining <= 0) {
      console.log('[getValidToken] Token expired or invalid, attempting refresh...');
      try {
        // Refresh token AND get the updated data back
        const refreshedTokenData = await refreshToken(TokenModel, currentTokenData, workspaceId);
        if (!refreshedTokenData) {
            return reject(new Error('Refresh token function did not return updated token data'));
        }
        console.log('[getValidToken] Token refreshed successfully');
        // Use the refreshed token data for decryption
        currentTokenData = refreshedTokenData; // Update the data we are working with
        const decryptedToken = decryptToken(
          currentTokenData.encryptedAuthToken,
          currentTokenData.encryptedAuthTokenIV
        );
        resolve(decryptedToken);
      } catch (refreshError) {
        console.error('[getValidToken] Refresh token failed:', refreshError);
        reject(refreshError);
      }
    } else {
      // Token is still valid, decrypt and return it
      console.log('[getValidToken] Token is valid');
      try {
        const decryptedToken = decryptToken(
          currentTokenData.encryptedAuthToken,
          currentTokenData.encryptedAuthTokenIV
        );
        resolve(decryptedToken);
      } catch (decryptError) {
          console.error('[getValidToken] Decryption failed for valid token:', decryptError);
          reject(decryptError);
      }
    }
  });
}

// Function to refresh the token
async function refreshToken(TokenModel, tokenData, workspaceId) {
  return new Promise(async (resolve, reject) => {
    if (!tokenData || !tokenData.encryptedRefreshToken || !tokenData.encryptedRefreshTokenIV) {
        console.error('[refreshToken] Invalid tokenData for refresh:', JSON.stringify(tokenData));
        return reject(new Error('Invalid token data for refresh'));
    }

    try {
        const decryptedRefreshToken = decryptToken(
            tokenData.encryptedRefreshToken,
            tokenData.encryptedRefreshTokenIV
        );

        // Check if instanceUrl exists, if not use default Salesforce URL
        if (!tokenData.instanceUrl) {
            console.warn('[refreshToken] Token is missing instanceUrl, using default login.salesforce.com.');
            tokenData.instanceUrl = 'https://login.salesforce.com';
        }

        // Refresh the token using Salesforce's OAuth API
        const response = await axios.post(
            `${tokenData.instanceUrl}/services/oauth2/token`,
            new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: process.env.SALESFORCE_CLIENT_ID,
                client_secret: process.env.SALESFORCE_CLIENT_SECRET,
                refresh_token: decryptedRefreshToken
            }).toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        const issueTime = Date.now();
        let expiresInSeconds = parseInt(response.data.expires_in, 10);
        if (isNaN(expiresInSeconds)) {
          console.warn(`[refreshToken] Salesforce token refresh response did not include a valid expires_in value. Received: ${response.data.expires_in}. Defaulting to 2 hours (7200 seconds).`);
          expiresInSeconds = 7200; // Default to 2 hours if not provided or invalid
        }
        const expiryTime = issueTime + (expiresInSeconds * 1000);
        const newEncryptedToken = encryptData(response.data.access_token, process.env.CRYPTO_SECRET);

        // Prepare update object
        const updateObject = {
            encryptedAuthToken: newEncryptedToken.encryptedData,
            encryptedAuthTokenIV: newEncryptedToken.iv,
            issueTime: issueTime,
            expiryTime: expiryTime,
            instanceUrl: response.data.instance_url // Update instance URL if it changed
        };

        // Check if response includes a new refresh token (token rotation is enabled)
        if (response.data.refresh_token) {
            console.log('[refreshToken] Received new refresh token (rotation enabled)');
            const newEncryptedRefreshToken = encryptData(response.data.refresh_token, process.env.CRYPTO_SECRET);
            updateObject.encryptedRefreshToken = newEncryptedRefreshToken.encryptedData;
            updateObject.encryptedRefreshTokenIV = newEncryptedRefreshToken.iv;
        }

        // Update token in database using the provided TokenModel
        const updateResult = await TokenModel.findByIdAndUpdate(tokenData._id, {
            $set: updateObject
        }, { new: true }); // { new: true } returns the updated document

        if (!updateResult) {
            console.error(`[refreshToken] Failed to find and update token ${tokenData._id}`);
            return reject(new Error('Failed to update token after refresh'));
        }
        
        console.log('Salesforce token refreshed successfully');
        resolve(updateResult.toObject ? updateResult.toObject() : updateResult); // Resolve with the updated token data

    } catch (error) {
        // Enhanced error logging for refresh token failures
        if (error.response?.data?.error === 'invalid_grant') {
            console.error('[refreshToken] Refresh token is expired or invalid. User needs to re-authenticate.');
            
            // Add a helpful error message to the token record
            try {
                await TokenModel.findByIdAndUpdate(tokenData._id, {
                    $push: { 
                        errorMessages: {
                            message: 'Refresh token expired. Please re-authenticate with Salesforce.',
                            timestamp: new Date()
                        }
                    }
                });
            } catch (dbError) {
                console.error('[refreshToken] Failed to update token error messages:', dbError);
            }
        }
        
        console.error('[refreshToken] Error during token refresh:', error.response?.data || error.message);
        reject(error);
    }
  });
}

// Helper function to decrypt tokens
function decryptToken(encryptedToken, encryptedTokenIV) {
  const secret = process.env.CRYPTO_SECRET;

  if (typeof encryptedToken !== 'string' || typeof encryptedTokenIV !== 'string' || typeof secret !== 'string') {
      console.error('[decryptToken] Invalid input provided for decryption.', { 
          tokenDefined: !!encryptedToken, 
          ivDefined: !!encryptedTokenIV, 
          secretDefined: !!secret 
      });
      throw new Error('Invalid input for decryption');
  }
  
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    Buffer.from(secret, 'hex'),
    Buffer.from(encryptedTokenIV, 'hex')
  );
  let decryptedToken = decipher.update(encryptedToken, 'hex', 'utf8');
  decryptedToken += decipher.final('utf8');
  return decryptedToken;
}

async function createConnection(workspaceId) {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  const datalake = mongoose.createConnection(dataLakeUri);
  datalake.model('Token', TokenSchema, 'tokens');
  await datalake.asPromise();
  return datalake;
}

// Function to encrypt data using the CRYPTO_SECRET and a random IV
function encryptData(data, secretKey) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(secretKey, 'hex'), iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return {
    iv: iv.toString('hex'),
    encryptedData: encrypted
  };
}

async function registerSalesforceCredentials(code, workspaceId, redirectUri) {
  try {
    // Create a URL object to check if the redirect URI has any query parameters
    const redirectUriObj = new URL(redirectUri, 'http://localhost');
    
    console.log(`[registerSalesforceCredentials] Exchanging auth code for tokens with redirect_uri: ${redirectUri}`);

    const requestBody = {
      grant_type: 'authorization_code',
      client_id: process.env.SALESFORCE_CLIENT_ID,
      client_secret: process.env.SALESFORCE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      code: code
      // NOTE: Don't add scope here - Salesforce doesn't support it during token exchange
      // Scopes must be requested during the initial authorization redirect
    };

    // Make request to get token from auth code
    const tokenResponse = await axios.post(
      'https://login.salesforce.com/services/oauth2/token',
      new URLSearchParams(requestBody).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    if (tokenResponse.status === 200) {
      // Log token data for debugging (without exposing sensitive values)
      console.log('[registerSalesforceCredentials] Token response received. Includes:', {
        access_token: tokenResponse.data.access_token ? 'Present' : 'Missing',
        refresh_token: tokenResponse.data.refresh_token ? 'Present' : 'Missing',
        instanceUrl: tokenResponse.data.instance_url,
        scope: tokenResponse.data.scope,
        expiresIn: tokenResponse.data.expires_in
      });

      if (!tokenResponse.data.refresh_token) {
        console.warn('[registerSalesforceCredentials] No refresh token in response. User may need to reauthorize with full scope.');
        throw new Error('No refresh token was provided by Salesforce. Check scope permissions or Salesforce connected app settings.');
      }

      const authToken = tokenResponse.data.access_token;
      const refreshToken = tokenResponse.data.refresh_token;
      const tokenType = tokenResponse.data.token_type;
      const instanceUrl = tokenResponse.data.instance_url;
      const issueTime = Date.now();

      let expiresInSeconds = parseInt(tokenResponse.data.expires_in, 10);
      if (isNaN(expiresInSeconds)) {
        console.warn(`[registerSalesforceCredentials] Salesforce token response did not include a valid expires_in value. Received: ${tokenResponse.data.expires_in}. Defaulting to 2 hours (7200 seconds).`);
        expiresInSeconds = 7200; // Default to 2 hours if not provided or invalid
      }
      const expiryTime = issueTime + (expiresInSeconds * 1000);

      // Get user info from Salesforce
      const userResponse = await axios.get(`${instanceUrl}/services/oauth2/userinfo`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });

      const email = userResponse.data.email;
      const displayName = userResponse.data.display_name || userResponse.data.name;
      const userId = userResponse.data.user_id;
      const orgId = userResponse.data.organization_id;

      console.log(`[registerSalesforceCredentials] User identified: ${email} (${displayName}), Organization ID: ${orgId}`);

      // Try to check permissions for debugging
      try {
        const permissionCheckResponse = await axios.get(
          `${instanceUrl}/services/data/v58.0/sobjects/Account/describe`,
          {
            headers: {
              'Authorization': `Bearer ${authToken}`
            }
          }
        );
        
        const visibleFields = permissionCheckResponse.data.fields ? permissionCheckResponse.data.fields.length : 0;
        console.log(`[registerSalesforceCredentials] Permission check: Account object has ${visibleFields} visible fields`);
      } catch (permError) {
        console.warn(`[registerSalesforceCredentials] Permission check failed: ${permError.message}`);
      }

      // Connect to database to store credentials
      const datalake = await createConnection(workspaceId);

      // Encrypt sensitive data
      const encryptedAuthToken = encryptData(authToken, process.env.CRYPTO_SECRET);
      const encryptedRefreshToken = encryptData(refreshToken, process.env.CRYPTO_SECRET);

      // Parse scopes
      const scopes = tokenResponse.data.scope ? tokenResponse.data.scope.split(' ') : [];
      console.log(`[registerSalesforceCredentials] Scopes granted: ${scopes.join(', ')}`);

      // Create token update object
      const updateObj = {
        externalId: orgId,
        displayName: displayName,
        email: email,
        encryptedAuthToken: encryptedAuthToken.encryptedData,
        encryptedAuthTokenIV: encryptedAuthToken.iv,
        encryptedRefreshToken: encryptedRefreshToken.encryptedData,
        encryptedRefreshTokenIV: encryptedRefreshToken.iv,
        issueTime,
        expiryTime,
        tokenType,
        instanceUrl,
        userId,
        service: "salesforce",
        scopes: scopes,
        errorMessages: []
      };

      // Update or create token
      const tokenResult = await datalake.model('Token').findOneAndUpdate(
        { externalId: orgId, email, service: 'salesforce' },
        updateObj,
        { new: true, upsert: true }
      );

      console.log(`[registerSalesforceCredentials] Token saved successfully with ID: ${tokenResult._id}`);

      // Get all salesforce tokens for this workspace
      const remainingTokens = await datalake.model('Token').find({ service: 'salesforce' });
      await datalake.close();

      return {
        email,
        displayName,
        externalId: orgId,
        remainingTokens: remainingTokens.map(token => ({
          _id: token._id,
          email: token.email,
          displayName: token.displayName,
          externalId: token.externalId,
          errorMessages: token.errorMessages
        }))
      };
    } else {
      throw new Error(`Error registering Salesforce credentials: ${tokenResponse.status}`);
    }
  } catch (error) {
    console.error('Error registering Salesforce credentials:', error);
    throw error;
  }
}

// Function to create a Pub/Sub subscription
async function createPubSubSubscription(token, instanceUrl, clientId, channel, config, sourceId, workspaceId) {
  // Get configuration - if not provided, import from default location
  if (!config) {
    try {
      config = require('../../sources/salesforce/config.json');
    } catch (error) {
      console.warn('Could not load Salesforce config, using default settings');
      config = {
        features: {
          pubsub: {
            enabled: false,
            autoDetect: true
          }
        }
      };
    }
  }

  // Check if Pub/Sub is enabled in config
  const pubsubEnabled = config.features?.pubsub?.enabled === true;
  const autoDetect = config.features?.pubsub?.autoDetect !== false; // Default to true if not specified

  // Skip if Pub/Sub is explicitly disabled and autoDetect is false
  if (!pubsubEnabled && !autoDetect) {
    console.log('Skipping Pub/Sub subscription creation - feature disabled in config');
    return { success: false, reason: 'feature_disabled' };
  }

  try {
    // Get the appropriate webhook base URL (ngrok in dev, APP_URL in prod)
    const baseUrl = await getWebhookBaseUrl();
    const webhookUrl = `${baseUrl}/api/v1/webhook/salesforce`;
    
    console.log(`Creating Pub/Sub subscription for channel ${channel} with webhook URL: ${webhookUrl}`);
    
    const response = await axios.post(
      `${instanceUrl}/services/data/v58.0/event/eventSubscription`,
      {
        channelName: channel,
        clientId: clientId,
        deliveryMethod: "CALLBACK",
        callbackUrl: webhookUrl,
        description: `Outrun subscription for ${channel} (${process.env.NODE_ENV || 'development'})`
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // If we successfully created Pub/Sub subscription, update source config if sourceId is provided
    if (sourceId && workspaceId) {
      try {
        console.log('Pub/Sub subscription created successfully. Updating source with importMethod: pub/sub');
        
        // Create a MongoDB connection to update the source
        const mongoose = require('mongoose');
        const { SourceSchema } = require('../../data/models');
        
        const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
        const workspaceConnection = await mongoose.createConnection(dataLakeUri).asPromise();
        const Source = workspaceConnection.model('Source', SourceSchema);
        
        // Update source with single importMethod field
        const updateResult = await Source.updateOne(
          { _id: sourceId },
          { $set: { 'importMethod': 'pub/sub' } }
        );
        
        console.log(`Source update result: matched=${updateResult.matchedCount}, modified=${updateResult.modifiedCount}`);
        
        await workspaceConnection.close();
      } catch (dbError) {
        console.error('Failed to update source configuration:', dbError);
      }
    }
    
    return { 
      success: true, 
      data: response.data,
      webhookUrl: webhookUrl
    };
  } catch (error) {
    // If autoDetect is enabled, record this API failure
    if (autoDetect && error.response && error.response.status === 404) {
      console.log('Pub/Sub API not available in this Salesforce org (404 Not Found). This is normal for some Salesforce editions.');
      
      // Update the source configuration if sourceId is provided
      if (sourceId && workspaceId) {
        try {
          console.log('Pub/Sub API is not available. Updating source with importMethod: polling');
          
          // Create a MongoDB connection to update the source
          const mongoose = require('mongoose');
          const { SourceSchema } = require('../../data/models');
          
          const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
          const workspaceConnection = await mongoose.createConnection(dataLakeUri).asPromise();
          const Source = workspaceConnection.model('Source', SourceSchema);
          
          // Update source with single importMethod field
          const updateResult = await Source.updateOne(
            { _id: sourceId },
            { $set: { 'importMethod': 'polling' } }
          );
          
          console.log(`Source update result: matched=${updateResult.matchedCount}, modified=${updateResult.modifiedCount}`);
          
          await workspaceConnection.close();
        } catch (dbError) {
          console.error('Failed to update source configuration:', dbError);
        }
      }
      
      return { 
        success: false, 
        reason: 'api_not_available',
        message: 'Pub/Sub API not available in this Salesforce org' 
      };
    }
    
    console.error('Error creating Pub/Sub subscription:', error.message);
    return { 
      success: false, 
      reason: 'api_error',
      message: error.message, 
      status: error.response?.status 
    };
  }
}

// Function to list available Pub/Sub channels
async function listPubSubChannels(token, instanceUrl, config, sourceId, workspaceId) {
  // Get configuration - if not provided, import from default location
  if (!config) {
    try {
      config = require('../../sources/salesforce/config.json');
    } catch (error) {
      console.warn('Could not load Salesforce config, using default settings');
      config = {
        features: {
          pubsub: {
            enabled: false,
            autoDetect: true
          }
        }
      };
    }
  }

  // Check if Pub/Sub is enabled in config
  const pubsubEnabled = config.features?.pubsub?.enabled === true;
  const autoDetect = config.features?.pubsub?.autoDetect !== false; // Default to true if not specified

  // Skip if Pub/Sub is explicitly disabled and autoDetect is false
  if (!pubsubEnabled && !autoDetect) {
    console.log('Skipping Pub/Sub channel listing - feature disabled in config');
    return { success: false, reason: 'feature_disabled', channels: [] };
  }

  try {
    const response = await axios.get(
      `${instanceUrl}/services/data/v58.0/event/eventSchema`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // If we successfully accessed Pub/Sub API, update source config if sourceId is provided
    if (sourceId && workspaceId) {
      try {
        console.log('Pub/Sub API is available. Updating source with importMethod: pub/sub');
        
        // Create a MongoDB connection to update the source
        const mongoose = require('mongoose');
        const { SourceSchema } = require('../../data/models');
        
        const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
        const workspaceConnection = await mongoose.createConnection(dataLakeUri).asPromise();
        const Source = workspaceConnection.model('Source', SourceSchema);
        
        // Update source with single importMethod field
        const updateResult = await Source.updateOne(
          { _id: sourceId },
          { $set: { 'importMethod': 'pub/sub' } }
        );
        
        console.log(`Source update result: matched=${updateResult.matchedCount}, modified=${updateResult.modifiedCount}`);
        
        await workspaceConnection.close();
      } catch (dbError) {
        console.error('Failed to update source configuration:', dbError);
      }
    }
    
    return { success: true, channels: response.data };
  } catch (error) {
    // If autoDetect is enabled, record this API failure
    if (autoDetect && error.response && error.response.status === 404) {
      console.log('Pub/Sub API not available in this Salesforce org (404 Not Found). This is normal for some Salesforce editions.');
      
      // Update the source configuration if sourceId is provided
      if (sourceId && workspaceId) {
        try {
          console.log('Pub/Sub API is not available. Updating source with importMethod: polling');
          
          // Create a MongoDB connection to update the source
          const mongoose = require('mongoose');
          const { SourceSchema } = require('../../data/models');
          
          const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
          const workspaceConnection = await mongoose.createConnection(dataLakeUri).asPromise();
          const Source = workspaceConnection.model('Source', SourceSchema);
          
          // Update source with single importMethod field
          const updateResult = await Source.updateOne(
            { _id: sourceId },
            { $set: { 'importMethod': 'polling' } }
          );
          
          console.log(`Source update result: matched=${updateResult.matchedCount}, modified=${updateResult.modifiedCount}`);
          
          await workspaceConnection.close();
        } catch (dbError) {
          console.error('Failed to update source configuration:', dbError);
        }
      }
      
      return { 
        success: false, 
        reason: 'api_not_available',
        message: 'Pub/Sub API not available in this Salesforce org',
        channels: [] 
      };
    }
    
    console.error('Error listing Pub/Sub channels:', error.message);
    return { 
      success: false, 
      reason: 'api_error',
      message: error.message, 
      status: error.response?.status,
      channels: [] 
    };
  }
}

// Function to publish an event to a Pub/Sub channel
async function publishToPubSub(token, instanceUrl, channel, payload, config) {
  // Get configuration - if not provided, import from default location
  if (!config) {
    try {
      config = require('../../sources/salesforce/config.json');
    } catch (error) {
      console.warn('Could not load Salesforce config, using default settings');
      config = {
        features: {
          pubsub: {
            enabled: false,
            autoDetect: true
          }
        }
      };
    }
  }

  // Check if Pub/Sub is enabled in config
  const pubsubEnabled = config.features?.pubsub?.enabled === true;
  const autoDetect = config.features?.pubsub?.autoDetect !== false; // Default to true if not specified

  // Skip if Pub/Sub is explicitly disabled and autoDetect is false
  if (!pubsubEnabled && !autoDetect) {
    console.log('Skipping Pub/Sub publish - feature disabled in config');
    return { success: false, reason: 'feature_disabled' };
  }

  try {
    const response = await axios.post(
      `${instanceUrl}/services/data/v58.0/event/eventPublish`,
      {
        channelName: channel,
        payload: payload
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return { success: true, data: response.data };
  } catch (error) {
    // If autoDetect is enabled, record this API failure
    if (autoDetect && error.response && error.response.status === 404) {
      console.log('Pub/Sub API not available in this Salesforce org (404 Not Found). This is normal for some Salesforce editions.');
      // If we could update the config file here to disable Pub/Sub, that would be ideal
      // But for now we'll just return a specific error
      return { 
        success: false, 
        reason: 'api_not_available',
        message: 'Pub/Sub API not available in this Salesforce org' 
      };
    }
    
    console.error('Error publishing to Pub/Sub:', error.message);
    return { 
      success: false, 
      reason: 'api_error',
      message: error.message, 
      status: error.response?.status 
    };
  }
}

// Function to get Salesforce client ID from environment variables
function getSalesforceClientId() {
  const clientId = process.env.SALESFORCE_CLIENT_ID;
  
  if (!clientId) {
    throw new Error('SALESFORCE_CLIENT_ID environment variable is not set');
  }
  
  return clientId;
}

// Utility function to get the webhook URL (either ngrok in dev or APP_URL in prod)
async function getWebhookBaseUrl() {
  const isProduction = process.env.NODE_ENV === 'production';
  
  // In production, just use the configured APP_URL
  if (isProduction) {
    return process.env.APP_URL || 'http://localhost:3001';
  }
  
  // In development, get the ngrok URL from Redis
  try {
    const client = await getRedisClient();
    if (client) {
      const ngrokUrl = await client.get('outrun:dev:ngrok:url');
      
      if (ngrokUrl) {
        console.log('Salesforce API: Using ngrok URL from Redis:', ngrokUrl);
        return ngrokUrl;
      }
    }
  } catch (error) {
    // Log but continue to fallback
    console.warn('Salesforce API: Error getting ngrok URL:', error.message);
  }
  
  // Log a warning for dev mode without ngrok
  console.warn('Salesforce API: No ngrok URL found, using APP_URL - webhooks may not work externally');
  
  // Fall back to APP_URL if no ngrok URL found
  return process.env.APP_URL || 'http://localhost:3001';
}

// Export the functions
module.exports = {
  getValidToken,
  refreshToken,
  createConnection,
  encryptData,
  registerSalesforceCredentials,
  createPubSubSubscription,
  listPubSubChannels,
  publishToPubSub,
  getSalesforceClientId,
  getWebhookBaseUrl
}; 
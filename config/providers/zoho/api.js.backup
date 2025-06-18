// config/providers/zoho/api.js

const mongoose = require('mongoose');
const crypto = require('crypto');
const axios = require('axios');
// Assuming TokenSchema is available from '../../data/models'
// const { TokenSchema } = require('../../data/models'); // This will be uncommented later

// Environment variables (ensure these are set in your .env file)
// ZOHO_CLIENT_ID
// ZOHO_CLIENT_SECRET
// APP_URI (e.g., http://localhost:3000/oauth/callback/zoho)
// CRYPTO_SECRET

const ZOHO_ACCOUNTS_BASE_URL = 'https://accounts.zoho.com';
const ZOHO_API_BASE_URL = 'https://www.zohoapis.com/crm/v8'; // Latest version with full regional support

// Regional endpoints - will be determined dynamically
const ZOHO_OAUTH_ENDPOINTS = {
  AUTHORIZATION: `${ZOHO_ACCOUNTS_BASE_URL}/oauth/v2/auth`,
  TOKEN: `${ZOHO_ACCOUNTS_BASE_URL}/oauth/v2/token`,
  USER_INFO: `${ZOHO_API_BASE_URL}/users?type=CurrentUser` // Example, confirm from Zoho docs
};

// Function to get region-specific token endpoint
const getTokenEndpoint = (accountsServer) => {
  if (accountsServer) {
    return `${accountsServer}/oauth/v2/token`;
  }
  return ZOHO_OAUTH_ENDPOINTS.TOKEN;
};

// --- Token Encryption/Decryption (Adapted from HubSpot) ---
const ALGORITHM = 'aes-256-cbc';

// Helper function to ensure the key is exactly 32 bytes for AES-256-CBC
const getValidKey = () => {
  if (!process.env.CRYPTO_SECRET) {
    throw new Error('CRYPTO_SECRET is not defined in environment variables.');
  }
  
  // Hash the CRYPTO_SECRET to ensure it's exactly 32 bytes
  return crypto.createHash('sha256').update(process.env.CRYPTO_SECRET).digest();
};

const encryptData = (text) => {
  const key = getValidKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
};

const decryptToken = (encryptedText) => {
  const key = getValidKey();
  
  if (!encryptedText || typeof encryptedText !== 'string' || !encryptedText.includes(':')) {
      console.error('Invalid encrypted text format for decryption:', encryptedText);
      throw new Error('Invalid encrypted text format.');
  }
  const parts = encryptedText.split(':');
  if (parts.length !== 2) {
      console.error('Invalid encrypted text format - missing IV or encrypted data:', encryptedText);
      throw new Error('Invalid encrypted text format.');
  }
  const iv = Buffer.from(parts[0], 'hex');
  const encryptedData = Buffer.from(parts[1], 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encryptedData);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
};


// --- OAuth Functions ---
const generateAuthUrl = (workspaceId, scope) => {
  console.log('generateAuthUrl called with:', { workspaceId, scope });
  if (!process.env.ZOHO_CLIENT_ID || !process.env.APP_URI) {
    throw new Error('ZOHO_CLIENT_ID or APP_URI is not defined in environment variables.');
  }

  const redirectUri = `${process.env.APP_URI}/api/callback/sources/add/zohocrm`;
  const authUrl = new URL(ZOHO_OAUTH_ENDPOINTS.AUTHORIZATION);

  authUrl.searchParams.append('client_id', process.env.ZOHO_CLIENT_ID);
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('redirect_uri', redirectUri);
  authUrl.searchParams.append('scope', scope); // e.g., 'ZohoCRM.modules.ALL,ZohoCRM.users.READ'
  authUrl.searchParams.append('state', workspaceId); // Using workspaceId as state for simplicity
  authUrl.searchParams.append('access_type', 'offline'); // To get a refresh token
  // authUrl.searchParams.append('prompt', 'consent'); // Optional: forces consent screen if you always want users to re-approve

  console.log(`Generated Zoho Auth URL: ${authUrl.toString()}`);
  return authUrl.toString();
};

const exchangeCodeForTokens = async (code, accountsServer = null, redirectUri = null) => {
  console.log('exchangeCodeForTokens called with code:', code, 'accountsServer:', accountsServer, 'redirectUri:', redirectUri);
  if (!process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET || !process.env.APP_URI) {
    throw new Error('ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, or APP_URI is not defined in environment variables.');
  }

  // Use provided redirectUri or fall back to sources default
  const finalRedirectUri = redirectUri || `${process.env.APP_URI}/api/callback/sources/add/zohocrm`;
  const params = new URLSearchParams();
  params.append('client_id', process.env.ZOHO_CLIENT_ID);
  params.append('client_secret', process.env.ZOHO_CLIENT_SECRET);
  params.append('code', code);
  params.append('grant_type', 'authorization_code');
  params.append('redirect_uri', finalRedirectUri);

  try {
    // Use region-specific token endpoint if provided
    const tokenEndpoint = getTokenEndpoint(accountsServer);
    console.log(`Exchanging code for tokens with Zoho. Endpoint: ${tokenEndpoint}`);
    console.log('Request payload:', {
      client_id: process.env.ZOHO_CLIENT_ID ? '******' : 'NOT_SET',
      grant_type: 'authorization_code',
      redirect_uri: finalRedirectUri,
      code_length: code ? code.length : 0
    });
    const response = await axios.post(tokenEndpoint, params);
    console.log('Successfully exchanged code for tokens:', response.data);
    console.log('API domain from token response:', response.data.api_domain);
    return response.data; // Expected: { access_token, refresh_token, expires_in, api_domain, token_type }
  } catch (error) {
    const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error('Error exchanging code for Zoho tokens:', errorMessage);
    console.error('Request params:', {
        client_id: process.env.ZOHO_CLIENT_ID ? '******' : 'NOT_SET',
        client_secret: process.env.ZOHO_CLIENT_SECRET ? '******' : 'NOT_SET',
        code: code ? '******' : 'NOT_SET',
        grant_type: 'authorization_code',
        redirect_uri: finalRedirectUri
    });
    
    // Provide specific error message for invalid_code
    if (error.response?.data?.error === 'invalid_code') {
      throw new Error('OAuth authorization code is invalid or has expired. Please try authenticating again.');
    }
    
    throw new Error(`Failed to exchange Zoho authorization code: ${errorMessage}`);
  }
};

const refreshAccessToken = async (refreshToken, accountsServer = null) => {
  console.log('refreshAccessToken called with refreshToken (first 10 chars):', refreshToken ? refreshToken.substring(0,10) + '...' : 'undefined', 'accountsServer:', accountsServer);
  if (!process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET) {
    throw new Error('ZOHO_CLIENT_ID or ZOHO_CLIENT_SECRET is not defined in environment variables.');
  }

  const params = new URLSearchParams();
  params.append('client_id', process.env.ZOHO_CLIENT_ID);
  params.append('client_secret', process.env.ZOHO_CLIENT_SECRET);
  params.append('refresh_token', refreshToken);
  params.append('grant_type', 'refresh_token');

  try {
    // Use region-specific token endpoint if provided
    const tokenEndpoint = getTokenEndpoint(accountsServer);
    console.log(`Refreshing Zoho access token. Endpoint: ${tokenEndpoint}`);
    const response = await axios.post(tokenEndpoint, params);
    console.log('Successfully refreshed access token:', response.data);
    // Zoho typically returns: { access_token, expires_in, api_domain, token_type }
    // It usually does NOT return a new refresh_token.
    return response.data;
  } catch (error) {
    const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error('Error refreshing Zoho access token:', errorMessage);
    console.error('Request params (sensitive values redacted):', {
        client_id: process.env.ZOHO_CLIENT_ID ? '******' : 'NOT_SET',
        client_secret: process.env.ZOHO_CLIENT_SECRET ? '******' : 'NOT_SET',
        refresh_token: refreshToken ? '******' : 'NOT_SET',
        grant_type: 'refresh_token'
    });
    // It's crucial to handle cases where the refresh token itself is invalid/revoked.
    if (error.response && error.response.data && error.response.data.error === 'invalid_token') {
        // This specific error indicates the refresh token is no longer valid.
        // The application should prompt the user to re-authenticate.
        console.error('Zoho refresh token is invalid. Re-authentication required.');
        throw new Error('Zoho refresh token invalid. Re-authentication required.');
    }
    throw new Error(`Failed to refresh Zoho access token: ${errorMessage}`);
  }
};

const fetchZohoUserInfo = async (accessToken, apiDomain = null, accountsServer = null) => {
    console.log('fetchZohoUserInfo called with accessToken (first 10 chars):', accessToken ? accessToken.substring(0,10) + '...' : 'undefined', 'apiDomain:', apiDomain, 'accountsServer:', accountsServer);
    if (!accessToken) {
        throw new Error('Access token is required to fetch Zoho user info.');
    }

    // For user profile info, we need to use the Accounts API, not the CRM API
    // The aaaserver.profile.READ scope is for the accounts server, not CRM
    const userInfoEndpoint = accountsServer 
        ? `${accountsServer}/oauth/user/info`
        : 'https://accounts.zoho.com/oauth/user/info';

    try {
        console.log(`Fetching user info from Zoho. Endpoint: ${userInfoEndpoint}`);
        console.log(`Using API domain: ${apiDomain || 'global default'}`);
        const response = await axios.get(userInfoEndpoint, {
            headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
        });

        // Log the raw response for debugging purposes, as Zoho's structure can vary.
        console.log('Raw Zoho user info response:', JSON.stringify(response.data, null, 2));

        // The Accounts API returns user info directly, not in a 'users' array like the CRM API
        if (response.data) {
            const userInfo = response.data;
            console.log('Successfully fetched and processed Zoho user info:', userInfo);
            // Extract key information from Accounts API response
            return {
                id: userInfo.ZUID || userInfo.user_id || userInfo.id, // Zoho User ID
                email: userInfo.Email || userInfo.email,
                name: userInfo.Display_Name || userInfo.display_name || userInfo.name || `${userInfo.First_Name || userInfo.first_name || ''} ${userInfo.Last_Name || userInfo.last_name || ''}`.trim(),
                // Add any other relevant fields: orgId, locale, etc.
                raw: userInfo // Optionally return the raw info for more flexibility
            };
        } else {
            console.error('Zoho user info response does not contain expected user data:', response.data);
            throw new Error('Failed to parse user information from Zoho response.');
        }
    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error('Error fetching Zoho user info:', errorMessage);
        if (error.response && error.response.status === 401) {
             console.error('Zoho API access denied (401). The access token might be invalid or expired.');
             throw new Error('Zoho API access denied. Token may be invalid or expired.');
        }
        throw new Error(`Failed to fetch Zoho user info: ${errorMessage}`);
    }
};


// --- Token Management & Database Interaction ---

// Token schema definition
const TokenSchema = new mongoose.Schema({
  workspaceId: String,
  provider: String,
  providerUserId: String,
  email: String,
  name: String,
  encryptedAccessToken: String,
  encryptedRefreshToken: String,
  accessTokenExpiresAt: Date,
  scope: String,
  externalId: String,
  displayName: String,
  scopes: [String],
  errorMessages: [String],
  service: String,
  encryptedApiDomain: String
}, { timestamps: true });

async function createConnection(workspaceId) {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  const datalake = mongoose.createConnection(dataLakeUri);
  datalake.model('Token', TokenSchema, 'tokens');
  await datalake.asPromise();
  return datalake;
}

// Token refresh lock to prevent multiple simultaneous refresh attempts
const tokenRefreshLocks = new Map();

const getValidToken = async (TokenModel, token, workspaceId, redisClient = null) => {
  console.log(`getValidToken called for workspaceId: ${workspaceId}, token ID: ${token ? token._id || token.id : 'N/A'}`);
  
  // Convert Mongoose document to plain object if needed
  const tokenObj = token.toObject ? token.toObject() : token;
  
  console.log('Token validation - checking fields:', {
    hasEncryptedAccessToken: !!tokenObj.encryptedAccessToken,
    hasEncryptedRefreshToken: !!tokenObj.encryptedRefreshToken,
    hasAccessTokenExpiresAt: !!tokenObj.accessTokenExpiresAt,
    encryptedAccessTokenType: typeof tokenObj.encryptedAccessToken,
    encryptedRefreshTokenType: typeof tokenObj.encryptedRefreshToken,
    accessTokenExpiresAtType: typeof tokenObj.accessTokenExpiresAt
  });
  
  if (!tokenObj || !tokenObj.encryptedAccessToken || !tokenObj.encryptedRefreshToken || !tokenObj.accessTokenExpiresAt) {
    console.error('Invalid or incomplete token object provided to getValidToken:', tokenObj);
    throw new Error('Token object is invalid or incomplete. It must contain encryptedAccessToken, encryptedRefreshToken, and accessTokenExpiresAt.');
  }
  if (!TokenModel) {
    throw new Error('TokenModel is required for getValidToken.');
  }

  const now = new Date();
  const expiryDate = new Date(tokenObj.accessTokenExpiresAt);
  // Add 5-minute buffer to prevent multiple simultaneous refresh attempts
  const bufferTime = 5 * 60 * 1000; // 5 minutes in milliseconds
  const isExpired = expiryDate.getTime() - bufferTime < now.getTime();

  // If token is not expired (considering buffer), return it immediately
  if (!isExpired) {
    console.log(`Zoho token for workspace ${workspaceId} (ID: ${tokenObj._id || tokenObj.id}) is not expired, using existing token.`);
    return decryptToken(tokenObj.encryptedAccessToken);
  }

  // Token is expired or will expire soon - refresh it proactively
  console.log(`Zoho token for workspace ${workspaceId} (ID: ${tokenObj._id || tokenObj.id}) is expired or expires soon (${expiryDate}), refreshing now.`);
  return await refreshExpiredToken(TokenModel, token, workspaceId, redisClient);
};

// New function specifically for refreshing tokens when API calls fail
// OAuth refresh rate limiter - 10 requests per 10 minutes globally
let oauthRefreshLimiter = null;

const initOAuthRefreshLimiter = (redisClient) => {
  if (redisClient && !oauthRefreshLimiter) {
    const { RedisRateLimiter } = require('rolling-rate-limiter');
    oauthRefreshLimiter = new RedisRateLimiter({
      client: redisClient,
      namespace: "zoho:oauth:refresh:",
      interval: 600000, // 10 minutes in milliseconds
      maxInInterval: 8 // Conservative: 8 out of 10 allowed requests
    });
    console.log('Initialized OAuth refresh rate limiter: 8 requests per 10 minutes');
  }
};

const refreshExpiredToken = async (TokenModel, token, workspaceId, redisClient = null) => {
  console.log(`refreshExpiredToken called for workspaceId: ${workspaceId}, token ID: ${token ? token._id || token.id : 'N/A'}`);
  
  // Initialize OAuth refresh rate limiter if Redis client is available
  if (redisClient) {
    initOAuthRefreshLimiter(redisClient);
  }
  
  const tokenObj = token.toObject ? token.toObject() : token;
  
  console.log('Token validation - checking fields:', {
    hasEncryptedAccessToken: !!tokenObj.encryptedAccessToken,
    hasEncryptedRefreshToken: !!tokenObj.encryptedRefreshToken,
    hasAccessTokenExpiresAt: !!tokenObj.accessTokenExpiresAt,
    encryptedAccessTokenType: typeof tokenObj.encryptedAccessToken,
    encryptedRefreshTokenType: typeof tokenObj.encryptedRefreshToken,
    accessTokenExpiresAtType: typeof tokenObj.accessTokenExpiresAt
  });
  
  if (!tokenObj || !tokenObj.encryptedAccessToken || !tokenObj.encryptedRefreshToken || !tokenObj.accessTokenExpiresAt) {
    console.error('Invalid or incomplete token object provided to refreshExpiredToken:', tokenObj);
    throw new Error('Token object is invalid or incomplete. It must contain encryptedAccessToken, encryptedRefreshToken, and accessTokenExpiresAt.');
  }
  if (!TokenModel) {
    throw new Error('TokenModel is required for refreshExpiredToken.');
  }

  const tokenId = tokenObj._id || tokenObj.id;
  const lockKey = `${workspaceId}-${tokenId}`;
  
  // Check if another job is already refreshing this token
  if (tokenRefreshLocks.has(lockKey)) {
    console.log(`Zoho token refresh already in progress for workspace ${workspaceId} (ID: ${tokenId}), waiting...`);
    await tokenRefreshLocks.get(lockKey);
    
    // After waiting, re-fetch the token to get the updated version
    const updatedToken = await TokenModel.findById(tokenId);
    if (updatedToken) {
      const updatedTokenObj = updatedToken.toObject ? updatedToken.toObject() : updatedToken;
      console.log(`Zoho token for workspace ${workspaceId} (ID: ${tokenId}) was refreshed by another job.`);
      return decryptToken(updatedTokenObj.encryptedAccessToken);
    }
  }
  
  console.log(`Zoho token for workspace ${workspaceId} (ID: ${tokenId}) needs refresh due to API failure.`);
  
  // Check OAuth refresh rate limit before attempting refresh
  if (oauthRefreshLimiter) {
    try {
      const rateLimitInfo = await oauthRefreshLimiter.wouldLimitWithInfo('global');
      if (rateLimitInfo.blocked) {
        const waitTimeMinutes = Math.ceil(rateLimitInfo.millisecondsUntilAllowed / 60000);
        console.log(`OAuth refresh rate limit reached. Must wait ${waitTimeMinutes} minutes before next refresh attempt.`);
        throw new Error(`OAuth refresh rate limit exceeded. Please wait ${waitTimeMinutes} minutes before retrying. This protects against Zoho's 10 requests per 10 minutes limit.`);
      }
      // Reserve a slot in the rate limiter
      await oauthRefreshLimiter.limit('global');
      console.log(`OAuth refresh rate limit check passed. Remaining requests: ${rateLimitInfo.actionsRemaining - 1}`);
    } catch (rateLimitError) {
      if (rateLimitError.message.includes('rate limit exceeded')) {
        throw rateLimitError; // Re-throw our custom rate limit error
      }
      console.warn('OAuth rate limiter error, proceeding with refresh:', rateLimitError.message);
    }
  }
  
  // Create a promise for this refresh operation and store it in the lock
  const refreshPromise = (async () => {
    const decryptedRefreshToken = decryptToken(tokenObj.encryptedRefreshToken);
    
    // Get the accountsServer from encryptedApiDomain if available
    let accountsServer = null;
    if (tokenObj.encryptedApiDomain) {
      try {
        accountsServer = decryptToken(tokenObj.encryptedApiDomain);
        console.log('Using stored accountsServer for refresh:', accountsServer);
      } catch (error) {
        console.warn('Failed to decrypt accountsServer from token, using default:', error.message);
      }
    }
    
    const refreshedTokenData = await refreshAccessToken(decryptedRefreshToken, accountsServer);

    // Check if the refresh response contains an error
    if (refreshedTokenData.error) {
      console.error(`Zoho token refresh failed with error: ${refreshedTokenData.error}`);
      throw new Error(`Zoho token refresh failed: ${refreshedTokenData.error}`);
    }

    const newAccessToken = refreshedTokenData.access_token;
    const expiresIn = refreshedTokenData.expires_in;
    
    // Validate that we received the required fields
    if (!newAccessToken || typeof expiresIn === 'undefined') {
      console.error('Zoho refresh response missing required fields:', refreshedTokenData);
      throw new Error('Invalid refresh response: missing access_token or expires_in');
    }
    
    const now = new Date();
    const newExpiryDate = new Date(now.getTime() + (expiresIn * 1000));

    const updateData = {
      encryptedAccessToken: encryptData(newAccessToken),
      accessTokenExpiresAt: newExpiryDate,
      // Zoho refresh tokens are typically long-lived and might not be returned on refresh.
      // Only update if a new one is explicitly provided by Zoho.
      ...(refreshedTokenData.refresh_token && { encryptedRefreshToken: encryptData(refreshedTokenData.refresh_token) }),
      // Update api_domain if provided in refresh response, but keep existing encryptedApiDomain if none provided
      ...(refreshedTokenData.api_domain && { encryptedApiDomain: encryptData(refreshedTokenData.api_domain) })
    };

    // Update the token in the database
    const tokenIdToUpdate = tokenObj._id || tokenObj.id;
    if (!tokenIdToUpdate) {
        console.error('Cannot update token as _id or id is missing from the token object.');
        throw new Error('Token ID is missing, cannot update.');
    }

    await TokenModel.findByIdAndUpdate(tokenIdToUpdate, updateData, { new: true });
    console.log(`Zoho token refreshed and updated successfully for token ID: ${tokenIdToUpdate} in workspace ${workspaceId}`);
    return newAccessToken;
  })();
  
  // Store the promise in the lock and clean up when done
  tokenRefreshLocks.set(lockKey, refreshPromise);
  
  try {
    const result = await refreshPromise;
    tokenRefreshLocks.delete(lockKey);
    return result;
  } catch (error) {
    tokenRefreshLocks.delete(lockKey);
    console.error(`Error refreshing Zoho token for workspace ${workspaceId}, token ID ${tokenObj._id || tokenObj.id}:`, error.message);
    // If refresh failed due to invalid_token, it's a critical error.
    if (error.message.includes('Zoho refresh token invalid') || error.message.includes('invalid_code')) {
        // Potentially mark the token as invalid in the DB or notify admins.
        console.error(`CRITICAL: Zoho refresh token for ${tokenObj._id || tokenObj.id} is invalid. Manual re-authentication needed.`);
    }
    throw error; // Re-throw the error to be handled by the caller
  }
};



const registerZohoCredentials = async (code, workspaceId, scope, tokenId = null, accountsServer = null, redirectUri = null) => {
  console.log(`registerZohoCredentials called for workspaceId: ${workspaceId}, scope: ${scope}, tokenId: ${tokenId}, accountsServer: ${accountsServer}, redirectUri: ${redirectUri}`);
  if (!code || !workspaceId || !scope) {
    throw new Error('code, workspaceId, and scope are required for registerZohoCredentials.');
  }

  try {
    // 1. Exchange code for tokens
    console.log('Exchanging authorization code for Zoho tokens...');
    const tokenData = await exchangeCodeForTokens(code, accountsServer, redirectUri);
    const { access_token, refresh_token, expires_in, api_domain } = tokenData;

    if (!access_token || !refresh_token || typeof expires_in === 'undefined') {
      console.error('Failed to retrieve complete token data from Zoho:', tokenData);
      throw new Error('Incomplete token data received from Zoho. Access token, refresh token, or expires_in is missing.');
    }
    console.log('Zoho tokens obtained successfully. API Domain:', api_domain);

    // 2. Fetch user info
    console.log('Fetching Zoho user information...');
    const userInfo = await fetchZohoUserInfo(access_token, api_domain, accountsServer); // Expects { id, email, name, raw }
    if (!userInfo || !userInfo.id || !userInfo.email) {
        console.error('Failed to retrieve complete user info from Zoho:', userInfo);
        throw new Error('Incomplete user information received from Zoho. User ID or email is missing.');
    }
    console.log('Zoho user information fetched successfully:', { id: userInfo.id, email: userInfo.email });

    // 3. Encrypt tokens and prepare data for saving
    console.log('Encrypting tokens...');
    const encryptedAccessToken = encryptData(access_token);
    const encryptedRefreshToken = encryptData(refresh_token); // Zoho provides refresh_token on initial auth
    const now = new Date();
    const accessTokenExpiresAt = new Date(now.getTime() + (expires_in * 1000));

    // 4. Create database connection and save token
    console.log('Creating database connection...');
    const datalake = await createConnection(workspaceId);
    
    const tokenDetails = {
      workspaceId,
      provider: 'zoho',
      providerUserId: userInfo.id.toString(),
      email: userInfo.email,
      name: userInfo.name,
      encryptedAccessToken,
      encryptedRefreshToken,
      accessTokenExpiresAt,
      scope,
      service: 'zoho',
      externalId: userInfo.id.toString(),
      displayName: userInfo.name || userInfo.email,
      scopes: scope ? scope.split(' ') : [],
      errorMessages: [],
      // Store the accounts server URL for regional API calls
      // Prioritize accountsServer from OAuth callback over api_domain from token response
      ...((accountsServer || api_domain) && { 
        encryptedApiDomain: encryptData(accountsServer || api_domain) 
      })
    };
    
    console.log('Saving accounts server info:', {
      accountsServer,
      api_domain,
      using: accountsServer || api_domain,
      willSaveEncryptedApiDomain: !!(accountsServer || api_domain)
    });
    console.log('Token details prepared for database operation.');

    // 5. Save or update token in DB
    let existingToken;
    if (tokenId) {
      console.log(`Updating existing Zoho token with ID: ${tokenId} for workspace ${workspaceId}`);
      existingToken = await datalake.model('Token').findByIdAndUpdate(
        tokenId,
        tokenDetails,
        { new: true }
      );
    } else {
      console.log(`Creating new Zoho token for workspace ${workspaceId}`);
      existingToken = await datalake.model('Token').findOneAndUpdate(
        { externalId: userInfo.id.toString(), email: userInfo.email, service: 'zoho' },
        tokenDetails,
        { new: true, upsert: true }
      );
    }

    // 6. Get all remaining tokens for response
    const remainingTokens = await datalake.model('Token').find({ service: 'zoho' });
    await datalake.close();

    console.log(`Zoho token operation completed successfully for workspace ${workspaceId}`);
    return {
      message: 'Zoho credentials registered successfully',
      remainingTokens: remainingTokens.map(token => ({
        _id: token._id,
        email: token.email,
        scopes: token.scopes,
        errorMessages: token.errorMessages,
        displayName: token.displayName,
        externalId: token.externalId
      }))
    };
  } catch (error) {
    console.error(`Error in registerZohoCredentials for workspace ${workspaceId}:`, error.message);
    if (error.response && error.response.data) {
        console.error('Underlying error data from Zoho:', JSON.stringify(error.response.data));
    }
    // More specific error handling can be added here if needed
    throw error; // Re-throw the error to be handled by the caller (e.g., OAuth callback route)
  }
};


// --- Exports ---
module.exports = {
  generateAuthUrl,
  registerZohoCredentials,
  getValidToken,
  refreshExpiredToken, // For refreshing tokens when API calls fail
  encryptData, // Export if needed by other parts of the Zoho integration
  decryptToken, // Export if needed
  // Potentially export other helpers or constants if required
  // ZOHO_API_BASE_URL,
  // exchangeCodeForTokens, // Usually internal
  // refreshAccessToken, // Usually internal
};

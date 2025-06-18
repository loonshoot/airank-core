const mongoose = require('mongoose');
const crypto = require('crypto');
const axios = require('axios'); 
const { TokenSchema } = require('../../data/models');

// Function to get a valid token (refreshes if necessary)
function getValidToken(TokenModel, token, workspaceId) {
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
function refreshToken(TokenModel, tokenData, workspaceId) {
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

        // Refresh the token using Atlassian OAuth API
        const response = await axios.post('https://auth.atlassian.com/oauth/token',
            {
                grant_type: 'refresh_token',
                client_id: process.env.ATLASSIAN_CLIENT_ID,
                client_secret: process.env.ATLASSIAN_CLIENT_SECRET,
                refresh_token: decryptedRefreshToken
            },
            {
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        const issueTime = Date.now();
        const expiryTime = issueTime + (response.data.expires_in * 1000);
        const newEncryptedToken = encryptData(response.data.access_token, process.env.CRYPTO_SECRET);

        // Update token in database using the provided TokenModel
        const updateResult = await TokenModel.findByIdAndUpdate(tokenData._id, {
            $set: {
                encryptedAuthToken: newEncryptedToken.encryptedData,
                encryptedAuthTokenIV: newEncryptedToken.iv,
                issueTime: issueTime,
                expiryTime: expiryTime,
                // If a new refresh token was provided
                ...(response.data.refresh_token && {
                    encryptedRefreshToken: encryptData(response.data.refresh_token, process.env.CRYPTO_SECRET).encryptedData,
                    encryptedRefreshTokenIV: encryptData(response.data.refresh_token, process.env.CRYPTO_SECRET).iv
                })
            }
        }, { new: true }); // { new: true } returns the updated document

        if (!updateResult) {
            console.error(`[refreshToken] Failed to find and update token ${tokenData._id}`);
            return reject(new Error('Failed to update token after refresh'));
        }
        
        console.log('Atlassian token refreshed successfully');
        resolve(updateResult.toObject ? updateResult.toObject() : updateResult); // Resolve with the updated token data

    } catch (error) {
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

// Function to get an Atlassian token from an authorization code - renamed to match the callback
async function atlassianGetToken(code) {
  try {
    const redirectUri = process.env.APP_URI + "/api/callback/sources/add/atlassian";
    
    // Exchange the authorization code for an access token
    const response = await axios.post('https://auth.atlassian.com/oauth/token',
      {
        grant_type: 'authorization_code',
        client_id: process.env.ATLASSIAN_CLIENT_ID,
        client_secret: process.env.ATLASSIAN_CLIENT_SECRET,
        code: code,
        redirect_uri: redirectUri
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error('Error getting Atlassian token:', error.response?.data || error.message);
    throw error;
  }
}

async function registerAtlassianCredentials(code, workspaceId, scope, tokenId) {
  try {
    const redirectUri = process.env.APP_URI + "/api/callback/sources/add/atlassian";
    console.log('Using redirect URI:', redirectUri); // Add logging
    
    // Exchange the authorization code for an access token
    const response = await axios.post('https://auth.atlassian.com/oauth/token',
      {
        grant_type: 'authorization_code',
        client_id: process.env.ATLASSIAN_CLIENT_ID,
        client_secret: process.env.ATLASSIAN_CLIENT_SECRET,
        code: code,
        redirect_uri: redirectUri
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.data.access_token || !response.data.refresh_token) {
      throw new Error('Missing access_token or refresh_token in Atlassian response');
    }

    // Get user info from Atlassian
    const userResponse = await axios.get('https://api.atlassian.com/me', {
      headers: {
        'Authorization': `Bearer ${response.data.access_token}`,
        'Accept': 'application/json'
      }
    });

    if (!userResponse.data || !userResponse.data.email) {
      throw new Error('Failed to get user info from Atlassian');
    }

    // Create connection to the workspace's database
    const datalake = await createConnection(workspaceId);
    const TokenModel = datalake.model('Token');

    // Encrypt tokens
    const encryptedAuthToken = encryptData(response.data.access_token, process.env.CRYPTO_SECRET);
    const encryptedRefreshToken = encryptData(response.data.refresh_token, process.env.CRYPTO_SECRET);

    const issueTime = Date.now();
    const expiryTime = issueTime + (response.data.expires_in * 1000);

    // Create or update token
    const tokenData = {
      service: 'atlassian',
      email: userResponse.data.email,
      displayName: userResponse.data.name,
      externalId: userResponse.data.account_id,
      encryptedAuthToken: encryptedAuthToken.encryptedData,
      encryptedAuthTokenIV: encryptedAuthToken.iv,
      encryptedRefreshToken: encryptedRefreshToken.encryptedData,
      encryptedRefreshTokenIV: encryptedRefreshToken.iv,
      issueTime: issueTime,
      expiryTime: expiryTime,
      scopes: response.data.scope ? response.data.scope.split(' ') : [],
      tokenType: response.data.token_type || 'Bearer'
    };

    let token;
    if (tokenId) {
      token = await TokenModel.findByIdAndUpdate(tokenId, tokenData, { new: true });
    } else {
      token = await TokenModel.create(tokenData);
    }

    // Close the database connection
    await datalake.close();

    // Return only the necessary data
    return {
      message: 'Successfully registered Atlassian credentials',
      remainingTokens: [{
        _id: token._id.toString(),
        email: token.email,
        displayName: token.displayName,
        externalId: token.externalId,
        scopes: token.scopes,
        errorMessages: []
      }]
    };

  } catch (error) {
    console.error('Error registering Atlassian credentials:', error.response?.data || error.message);
    
    // If it's an Axios error with response data, throw that
    if (error.response?.data) {
      throw new Error(error.response.data.error_description || error.response.data.error || error.message);
    }
    
    throw error;
  }
}

// Export the functions
module.exports = {
  getValidToken,
  refreshToken,
  createConnection,
  encryptData,
  decryptToken,
  registerAtlassianCredentials,
  atlassianGetToken
}; 
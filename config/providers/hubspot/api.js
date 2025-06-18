// batcher/providers/google.js

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
    // Removed createConnection/findOne, assuming TokenModel is now correctly scoped
    // const datalake = await createConnection(workspaceId);
    // const token = await datalake.model('Token').findOne({ _id: tokenData._id });
    // if (!token) ... reject ...

    // Directly use the passed tokenData if TokenModel is correct
    if (!tokenData || !tokenData.encryptedRefreshToken || !tokenData.encryptedRefreshTokenIV) {
        console.error('[refreshToken] Invalid tokenData for refresh:', JSON.stringify(tokenData));
        return reject(new Error('Invalid token data for refresh'));
    }

    try {
        const decryptedRefreshToken = decryptToken(
            tokenData.encryptedRefreshToken,
            tokenData.encryptedRefreshTokenIV
        );

        // Refresh the token using HubSpot's API
        const response = await axios.post('https://api.hubapi.com/oauth/v1/token',
            new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: process.env.HUBSPOT_CLIENT_ID,
                client_secret: process.env.HUBSPOT_CLIENT_SECRET,
                redirect_uri: process.env.APP_URI + '/api/callback/sources/add/hubspot',
                refresh_token: decryptedRefreshToken
            }).toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8'
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
                expiryTime: expiryTime
            }
        }, { new: true }); // { new: true } returns the updated document

        if (!updateResult) {
            console.error(`[refreshToken] Failed to find and update token ${tokenData._id}`);
            return reject(new Error('Failed to update token after refresh'));
        }
        
        console.log('HubSpot token refreshed successfully');
        resolve(updateResult.toObject ? updateResult.toObject() : updateResult); // Resolve with the updated token data

    } catch (error) {
        console.error('[refreshToken] Error during token refresh:', error.response?.data || error.message);
        reject(error);
    }
    // Removed finally block with datalake.close()
  });
}

// Helper function to decrypt tokens
function decryptToken(encryptedToken, encryptedTokenIV) {
  // console.log(`[decryptToken] Attempting decryption. Token starts with: ${encryptedToken?.substring(0, 10)}, IV starts with: ${encryptedTokenIV?.substring(0, 10)}`); // REMOVED
  
  const secret = process.env.CRYPTO_SECRET;
  // console.log(`[decryptToken] Using CRYPTO_SECRET type: ${typeof secret}, starts with: ${secret?.substring(0, 5)}`); // REMOVED

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
  // console.log('[decryptToken] Decryption successful.'); // REMOVED
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

async function registerHubspotCredentials(code, workspaceId, scope, tokenId) {
  try {
    const redirectUri = process.env.APP_URI + "/api/callback/sources/add/hubspot";
    
    const requestBody = {
      grant_type: 'authorization_code',
      client_id: process.env.HUBSPOT_CLIENT_ID,
      client_secret: process.env.HUBSPOT_CLIENT_SECRET,
      redirect_uri: redirectUri,
      code: code
    };

    const response = await axios.post('https://api.hubapi.com/oauth/v1/token', 
      new URLSearchParams(requestBody).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8'
        }
      }
    );

    if (response.status === 200) {
      const authToken = response.data.access_token;
      const refreshToken = response.data.refresh_token;
      const tokenType = response.data.token_type;
      const issueTime = Date.now();
      const expiryTime = issueTime + (response.data.expires_in * 1000);

      const userResponse = await axios.get(`https://api.hubapi.com/oauth/v1/access-tokens/${authToken}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });

      const email = userResponse.data.user;
      const scopesArray = userResponse.data.scopes || [];

      const datalake = await createConnection(workspaceId);

      const encryptedAuthToken = encryptData(authToken, process.env.CRYPTO_SECRET);
      const encryptedRefreshToken = encryptData(refreshToken, process.env.CRYPTO_SECRET);

      const externalId = userResponse.data.hub_id;
      
      const updateObj = {
        externalId,
        displayName: userResponse.data.hub_domain,
        email,
        encryptedAuthToken: encryptedAuthToken.encryptedData,
        encryptedAuthTokenIV: encryptedAuthToken.iv,
        encryptedRefreshToken: encryptedRefreshToken.encryptedData,
        encryptedRefreshTokenIV: encryptedRefreshToken.iv,
        issueTime,
        expiryTime,
        tokenType,
        scopes: scopesArray,
        service: "hubspot",
        errorMessages: []
      };

      let existingToken;
      if (tokenId) {
        existingToken = await datalake.model('Token').findByIdAndUpdate(
          tokenId,
          updateObj,
          { new: true }
        );
      } else {
        existingToken = await datalake.model('Token').findOneAndUpdate(
          { externalId, email, service: 'hubspot' },
          updateObj,
          { new: true, upsert: true }
        );
      }

      const remainingTokens = await datalake.model('Token').find({ service: 'hubspot' });
      await datalake.close();

      return {
        scopes: scopesArray,
        email,
        remainingTokens: remainingTokens.map(token => ({
          _id: token._id,
          scopes: token.scopes,
          email: token.email,
          errorMessages: token.errorMessages
        }))
      };
    } else {
      throw new Error(`Error registering Hubspot credentials: ${response.status}`);
    }
  } catch (error) {
    console.error('Error registering Hubspot credentials:', error);
    throw error;
  }
}

// Export the functions
module.exports = {
  getValidToken,
  refreshToken,
  createConnection,
  encryptData,
  registerHubspotCredentials
};
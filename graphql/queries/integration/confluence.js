const axios = require('axios');
const crypto = require('crypto');
const mongoose = require('mongoose');

module.exports = {
  getTenants: async (workspaceId, tokenId) => {
    try {
      const datalake = await createConnection(workspaceId);
      const token = await datalake.model('Token').findOne({ _id: tokenId });

      if (!token) {
        console.error(`Token with ID '${tokenId}' not found`);
        return null;
      }

      // Get the decrypted token
      const { decryptedToken } = await module.exports.getValidToken(token, workspaceId);

      // Check for Token Expiration
      if (Date.now() > token.expiryTime) {
        console.error("Token has expired.");
        return null; 
      }

      // Make the API request using the decrypted token to get Confluence sites
      const response = await axios.get('https://api.atlassian.com/oauth/token/accessible-resources', {
        headers: {
          Authorization: `Bearer ${decryptedToken}`
        }
      });

      // Process the response to get the tenants (Confluence sites)
      // The response format is different from Google Search Console
      const tenants = response.data 
                    ? response.data.map(site => ({
                        id: site.id,
                        name: site.name
                      }))
                    : []; 

      await datalake.close();
      return tenants;

    } catch (error) {
      console.error('Error getting Confluence sites:', error);
      throw error;
    }
  },
  refreshToken: async (tokenId, workspaceId) => {
    try {
      const datalake = await createConnection(workspaceId);
      const token = await datalake.model('Token').findOne({ _id: tokenId });

      if (!token) {
        console.error(`Token with ID '${tokenId}' not found`);
        return null;
      }

      // Decrypt the refresh token
      const decipher = crypto.createDecipheriv(
        'aes-256-cbc',
        Buffer.from(process.env.CRYPTO_SECRET, 'hex'),
        Buffer.from(token.encryptedRefreshTokenIV, 'hex')
      );
      let decryptedRefreshToken = decipher.update(token.encryptedRefreshToken, 'hex', 'utf8');
      decryptedRefreshToken += decipher.final('utf8');

      // Refresh the token using Atlassian's API
      const response = await axios.post('https://auth.atlassian.com/oauth/token', {
        grant_type: 'refresh_token',
        client_id: process.env.ATLASSIAN_CLIENT_ID,
        client_secret: process.env.ATLASSIAN_CLIENT_SECRET,
        refresh_token: decryptedRefreshToken
      });

      // Update the token in the database
      const issueTime = Date.now();
      const expiryTime = issueTime + (response.data.expires_in * 1000);
      const encryptedAuthToken = encryptData(response.data.access_token, process.env.CRYPTO_SECRET);
      
      await datalake.model('Token').updateOne(
        { _id: tokenId },
        {
          $set: {
            encryptedAuthToken: encryptedAuthToken.encryptedData,
            encryptedAuthTokenIV: encryptedAuthToken.iv,
            issueTime: issueTime,
            expiryTime: expiryTime,
          }
        }
      );

      console.log('Atlassian token refreshed successfully!');
      return 'authToken';

    } catch (error) {
      console.error('Error refreshing Atlassian token:', error);
      return null;
    }
  },

  getValidToken: async (token, workspaceId) => {
    try {
      const currentTime = Date.now();
      const timeRemaining = token.expiryTime - currentTime;

      let activeKey = 'authToken';
      let encryptedToken = token.encryptedAuthToken;
      let encryptedTokenIV = token.encryptedAuthTokenIV;

      if (timeRemaining <= 60) {
        activeKey = await module.exports.refreshToken(token._id, workspaceId);
        if (activeKey === 'authToken') {
          const datalake = await createConnection(workspaceId);
          const updatedToken = await datalake.model('Token').findOne({ _id: token._id });
          encryptedToken = updatedToken.encryptedAuthToken;
          encryptedTokenIV = updatedToken.encryptedAuthTokenIV;
          await datalake.close();
        }
      }

      // Decrypt the token using the stored IV
      const decipher = crypto.createDecipheriv(
        'aes-256-cbc',
        Buffer.from(process.env.CRYPTO_SECRET, 'hex'),
        Buffer.from(encryptedTokenIV, 'hex')
      );
      let decryptedToken = decipher.update(encryptedToken, 'hex', 'utf8');
      decryptedToken += decipher.final('utf8');

      return { activeKey, decryptedToken };
    } catch (error) {
      console.error('Error getting valid Atlassian token:', error);
      throw error;
    }
  }
};

async function createConnection(workspaceId) {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  const datalake = mongoose.createConnection(dataLakeUri);

  datalake.model('Token', new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.ObjectId, required: true },
    email: { type: String, required: true },
    encryptedAuthToken: { type: String, required: true }, 
    encryptedAuthTokenIV: { type: String, required: true },
    encryptedRefreshToken: { type: String, required: true },
    encryptedRefreshTokenIV: { type: String, required: true },
    service: { type: String, required: true },
    issueTime: { type: Number, required: true },
    expiryTime: { type: Number, required: true },
    tokenType: { type: String, required: true },
    scopes: { type: [String], required: true },
    errorMessages: { type: [String], default: [] },
    displayName: { type: String },
    externalId: { type: String }
  }));

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
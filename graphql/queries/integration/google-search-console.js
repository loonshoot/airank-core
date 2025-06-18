// graphql/queries/integration/google-search-console.js
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

      // Check for Token Expiration (e.g., using the `token.expiryTime` or `Date.now()` - `token.issueTime`)
      if (Date.now() > token.expiryTime) {
        console.error("Token has expired.");
        return null; 
      }

      // Make the API request using the decrypted token
      const response = await axios.get('https://www.googleapis.com/webmasters/v3/sites', {
        headers: {
          Authorization: `Bearer ${decryptedToken}`
        }
      });

      // Process the response to get the tenants
      const tenants = response.data.siteEntry 
                      ? response.data.siteEntry.map(site => ({
                          id: site.siteUrl,
                          name: site.siteUrl
                        }))
                      : []; // Return an empty array if siteEntry is undefined

      await datalake.close();
      return tenants;

    } catch (error) {
      console.error('Error getting tenants:', error);
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

      console.log("Refreshed Token: " + decryptedRefreshToken)

      // Refresh the token using Google's API
      const response = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: decryptedRefreshToken,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: 'refresh_token'
      });

      // Update the token in the database
      const issueTime = Date.now(); // Use milliseconds for issueTime
      const expiryTime = issueTime + (response.data.expires_in * 1000); // Calculate expiryTime in seconds
      const encryptedAuthToken = encryptData(response.data.access_token, process.env.CRYPTO_SECRET); // Encrypt the new auth token
      await datalake.model('Token').updateOne(
        { _id: tokenId },
        {
          $set: {
            encryptedAuthToken: encryptedAuthToken.encryptedData, // Store encrypted auth token
            encryptedAuthTokenIV: encryptedAuthToken.iv, // Store the IV for decryption
            issueTime: issueTime,
            expiryTime: expiryTime,
          }
        }
      );

      console.log('Token refreshed successfully!');
      return 'authToken';

    } catch (error) {
      console.error('Error refreshing token:', error);
      return null;
    }
  },

  getValidToken: async (token, workspaceId) => {
    try {
      const currentTime = Date.now(); // Use milliseconds for currentTime
      console.log("Current time:" + currentTime)
      const timeRemaining = token.expiryTime - currentTime;
      console.log("Time Remaining: " + timeRemaining)

      let activeKey = 'authToken';
      let encryptedToken = token.encryptedAuthToken;
      let encryptedTokenIV = token.encryptedAuthTokenIV; // Get the IV from the token object

      console.log("Token Object:", token);

      if (timeRemaining <= 60) {
        activeKey = await module.exports.refreshToken(token._id, workspaceId);
        if (activeKey === 'authToken') {
          const datalake = await createConnection(workspaceId);
          const updatedToken = await datalake.model('Token').findOne({ _id: token._id });
          encryptedToken = updatedToken.encryptedAuthToken;
          encryptedTokenIV = updatedToken.encryptedAuthTokenIV; // Get the updated IV 
          await datalake.close()
        }
      }

      // Decrypt the token using the stored IV
      const decipher = crypto.createDecipheriv(
        'aes-256-cbc',
        Buffer.from(process.env.CRYPTO_SECRET, 'hex'),
        Buffer.from(encryptedTokenIV, 'hex') // Use the updated IV
      );
      let decryptedToken = decipher.update(encryptedToken, 'hex', 'utf8');
      decryptedToken += decipher.final('utf8');
      
      console.log("Token: " + decryptedToken)

      return { activeKey, decryptedToken };
    } catch (error) {
      console.error('Error getting valid token:', error);
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
    encryptedAuthTokenIV: { type: String, required: true }, // Ensure this is in your schema
    encryptedRefreshToken: { type: String, required: true },
    encryptedRefreshTokenIV: { type: String, required: true },
    service: { type: String, required: true },
    issueTime: { type: Number, required: true }, // Use Number for issueTime and expiryTime
    expiryTime: { type: Number, required: true }, 
    tokenType: { type: String, required: true },
    scopes: { type: [String], required: true },
    errorMessages: { type: [String], default: [] }
  }));

  await datalake.asPromise();
  return datalake;
}

// Function to encrypt data using the CRYPTO_SECRET and a random IV
function encryptData(data, secretKey) {
  const iv = crypto.randomBytes(16); // Generate a random IV
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(secretKey, 'hex'), iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return {
    iv: iv.toString('hex'),
    encryptedData: encrypted
  };
}
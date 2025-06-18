// batcher/providers/google.js

const mongoose = require('mongoose');
const crypto = require('crypto');
const axios = require('axios'); 
const { TokenSchema } = require('../../data/models');

// Function to get a valid token (refreshes if necessary)
function getValidToken(token, workspaceId) {
  return new Promise((resolve, reject) => {
    const currentTime = Date.now();
    const timeRemaining = token.expiryTime - currentTime;

    let activeKey = 'authToken';
    let encryptedToken;
    let encryptedTokenIV;

    // **No need for token.exec() here**
    //  token is already the document, not a query object
    if (!token) {
      reject(new Error('Token not found'));
      return;
    }

    encryptedToken = token.encryptedAuthToken; 
    encryptedTokenIV = token.encryptedAuthTokenIV;

    if (timeRemaining <= 0) { 
      refreshToken(token._id, workspaceId) 
        .then(key => {
          activeKey = key;
          if (activeKey === 'authToken') {
            createConnection(workspaceId)
              .then(datalake => {
                datalake.model('Token').findOne({ _id: token._id })
                  .then(updatedToken => { 
                    encryptedToken = updatedToken.encryptedAuthToken;
                    encryptedTokenIV = updatedToken.encryptedAuthTokenIV;
                    datalake.close()
                      .then(() => {
                        // Decrypt the token using the stored IV
                        const decipher = crypto.createDecipheriv(
                          'aes-256-cbc',
                          Buffer.from(process.env.CRYPTO_SECRET, 'hex'),
                          Buffer.from(encryptedTokenIV, 'hex')
                        );
                        let decryptedToken = decipher.update(encryptedToken, 'hex', 'utf8');
                        decryptedToken += decipher.final('utf8');

                        resolve({ activeKey, decryptedToken });
                      })
                      .catch(err => {
                        reject(err);
                      });
                  })
                  .catch(err => {
                    reject(err);
                  });
              })
              .catch(err => {
                reject(err);
              });
          } else {
            // Decrypt the token using the stored IV
            const decipher = crypto.createDecipheriv(
              'aes-256-cbc',
              Buffer.from(process.env.CRYPTO_SECRET, 'hex'),
              Buffer.from(encryptedTokenIV, 'hex')
            );
            let decryptedToken = decipher.update(encryptedToken, 'hex', 'utf8');
            decryptedToken += decipher.final('utf8');

            resolve({ activeKey, decryptedToken });
          }
        })
        .catch(err => {
          reject(err);
        });
    } else {
      // Decrypt the token using the stored IV
      const decipher = crypto.createDecipheriv(
        'aes-256-cbc',
        Buffer.from(process.env.CRYPTO_SECRET, 'hex'),
        Buffer.from(encryptedTokenIV, 'hex')
      );
      let decryptedToken = decipher.update(encryptedToken, 'hex', 'utf8');
      decryptedToken += decipher.final('utf8');

      resolve({ activeKey, decryptedToken });
    }
  });
}

// Function to refresh the token
function refreshToken(tokenId, workspaceId) {
  return new Promise((resolve, reject) => {
    createConnection(workspaceId)
      .then(datalake => {
        datalake.model('Token').findOne({ _id: tokenId })
          .then(token => {
            if (!token) {
              console.error(`Token with ID '${tokenId}' not found`);
              resolve(null);
              return;
            }

            // Decrypt the refresh token
            const decipher = crypto.createDecipheriv(
              'aes-256-cbc',
              Buffer.from(process.env.CRYPTO_SECRET, 'hex'),
              Buffer.from(token.encryptedRefreshTokenIV, 'hex')
            );
            let decryptedRefreshToken = decipher.update(token.encryptedRefreshToken, 'hex', 'utf8');
            decryptedRefreshToken += decipher.final('utf8');

            // Refresh the token using Google's API
            axios.post('https://oauth2.googleapis.com/token', {
              client_id: process.env.GOOGLE_CLIENT_ID,
              client_secret: process.env.GOOGLE_CLIENT_SECRET,
              refresh_token: decryptedRefreshToken,
              redirect_uri: process.env.GOOGLE_REDIRECT_URI,
              grant_type: 'refresh_token'
            })
              .then(response => {
                // Update the token in the database
                const issueTime = Date.now(); // Use milliseconds for issueTime
                const expiryTime = issueTime + (response.data.expires_in * 1000); // Calculate expiryTime in seconds
                const encryptedAuthToken = encryptData(response.data.access_token, process.env.CRYPTO_SECRET); 
                datalake.model('Token').updateOne(
                  { _id: tokenId },
                  {
                    $set: {
                      encryptedAuthToken: encryptedAuthToken.encryptedData, 
                      encryptedAuthTokenIV: encryptedAuthToken.iv, 
                      issueTime: issueTime,
                      expiryTime: expiryTime, 
                    }
                  }
                )
                  .then(() => {
                    console.log('Google token refreshed successfully');
                    resolve('authToken');
                  })
                  .catch(err => {
                    console.error('Error updating token:', err);
                    resolve(null);
                  });
              })
              .catch(error => {
                console.error('Error refreshing token:', error);
                resolve(null);
              });
          })
          .catch(err => {
            console.error('Error finding token:', err);
            resolve(null);
          });
      })
      .catch(err => {
        console.error('Error creating connection:', err);
        resolve(null);
      });
  });
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

async function registerGoogleCredentials(code, workspaceId, scope, tokenId) {
  try {
    const redirectUri = process.env.APP_URI + "/api/callback/sources/add/google-search-console";
    const requestBody = {
      code: code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    };

    const response = await axios.post('https://accounts.google.com/o/oauth2/token', requestBody, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    if (response.status === 200) {
      const authToken = response.data.access_token;
      const refreshToken = response.data.refresh_token;
      const tokenType = response.data.token_type;

      if (!authToken || !refreshToken) {
        throw new Error('Received undefined tokens from Google API');
      }

      const issueTime = Date.now();
      const expiryTime = issueTime + (response.data.expires_in * 1000);

      const peopleApiUrl = 'https://people.googleapis.com/v1/people/me?personFields=emailAddresses';
      const peopleResponse = await axios.get(peopleApiUrl, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });

      const email = peopleResponse.data.emailAddresses[0].value;
      const scopesArray = scope.split(/\s+/);

      const datalake = await createConnection(workspaceId);

      const encryptedAuthToken = encryptData(authToken, process.env.CRYPTO_SECRET);
      const encryptedRefreshToken = encryptData(refreshToken, process.env.CRYPTO_SECRET);
      
      const updateObj = {
        email,
        encryptedAuthToken: encryptedAuthToken.encryptedData,
        encryptedAuthTokenIV: encryptedAuthToken.iv,
        encryptedRefreshToken: encryptedRefreshToken.encryptedData,
        encryptedRefreshTokenIV: encryptedRefreshToken.iv,
        issueTime: issueTime,
        expiryTime: expiryTime,
        tokenType: tokenType,
        scopes: scopesArray,
        service: "google",
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
          { email },
          updateObj,
          { new: true, upsert: true }
        );
      }

      const remainingTokens = await datalake.model('Token').find({ service: 'google' });
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
      throw new Error(`Error registering external credentials: ${response.status}`);
    }
  } catch (error) {
    console.error('Error registering Google credentials:', error);
    throw error;
  }
}

// Export the functions
module.exports = {
  getValidToken,
  refreshToken,
  createConnection,
  encryptData,
  registerGoogleCredentials
};
// mutations/registerExternalCredentials/index.js
const Agenda = require('agenda'); // Import the Agenda library
require('dotenv').config(); 
const { Member } = require('../../queries/member');
const fs = require('fs').promises;
const path = require('path');

// Function to capitalize first letter
const capitalizeFirstLetter = (string) => {
  return string.charAt(0).toUpperCase() + string.slice(1);
};

// Function to load all providers
const loadProviders = async () => {
  // Use __dirname to get the current file's directory and navigate up to the providers directory
  const providersDir = path.join(__dirname, '../../../config/providers');
  const providers = {};

  try {
    const dirs = await fs.readdir(providersDir);
    console.log('Found provider directories:', dirs);
    
    for (const dir of dirs) {
      const apiPath = path.join(providersDir, dir, 'api.js');
      console.log('Loading provider from:', apiPath);
      try {
        // Delete cache first to ensure we get fresh modules
        delete require.cache[require.resolve(apiPath)];
        // Use absolute path for require
        const providerModule = require(apiPath);
        const functionName = `register${capitalizeFirstLetter(dir)}Credentials`;
        
        if (typeof providerModule[functionName] === 'function') {
          providers[dir] = providerModule[functionName];
          console.log(`Successfully loaded provider: ${dir}`);
        } else {
          console.warn(`Warning: ${functionName} not found in ${apiPath}`);
        }
      } catch (err) {
        console.error(`Error loading provider ${dir}:`, err);
        console.error('Full error:', err.stack);
      }
    }

    console.log('Loaded providers:', Object.keys(providers));
  } catch (err) {
    console.error('Error loading providers:', err);
    console.error('Attempted providers directory:', providersDir);
    console.error('Full error:', err.stack);
  }

  return providers;
};

// Cache for providers
let providersCache = null;

// Async function to register external credentials
async function registerExternalCredentials(parent, args, { user }) {
  if (user) {
    // Find member with the user's email
    const member = await Member.findOne({ 
      workspaceId: args.workspaceId, 
      userId: user.sub,
      permissions: "mutation:registerExternalCredentials"
    });

    if (member) { // If member found and has permission
      try {
        // Validate inputs
        if (!args.service || !args.code) {
          throw new Error('Missing required fields: service, code');
        }

        // Load providers if not cached
        if (!providersCache) {
          providersCache = await loadProviders();
        }

        // Get the registration function for the service
        const registrationFunction = providersCache[args.service];
        if (!registrationFunction) {
          throw new Error(`Provider ${args.service} not found or registration function not available. Available providers: ${Object.keys(providersCache).join(', ')}`);
        }

        // Call the provider's registration function
        let result;
        if (args.service === 'salesforce') {
          const appUrl = process.env.APP_URI;
          if (!appUrl) {
            console.error('APP_URI is not defined in environment variables for airank-core.');
            throw new Error('APP_URI is not configured for salesforce redirect_uri construction.');
          }
          const salesforceCallbackPath = '/api/callback/salesforce'; // Hardcoded path
          const redirectUri = `${appUrl}${salesforceCallbackPath}`;
          result = await registrationFunction(args.code, args.workspaceId, redirectUri, args.tokenId);
        } else if (args.service === 'zoho') {
          // For Zoho, pass the accountsServer and redirectUri parameters
          result = await registrationFunction(args.code, args.workspaceId, args.scope, args.tokenId, args.accountsServer, args.redirectUri);
        } else {
          // For other services, pass args.scope as the third parameter as it was (or adjust as needed per service)
          result = await registrationFunction(args.code, args.workspaceId, args.scope, args.tokenId);
        }

        // Check for successful response
        if (result) {
          return result;
        } else {
          throw new Error(`Error registering external credentials: ${args.service}`);
        }
        
      } catch (error) {
        console.error('Error registering external credentials:', error);
        throw error;
      }
    } else {
      console.error('User not authorized to register external credentials');
      return null;
    }
  } else {
    console.error('User not authenticated or userId not found');
    return null;
  }
}

// Export the registerExternalCredentials function
module.exports = { registerExternalCredentials };
const { Member } = require('../../queries/member');
const fs = require('fs').promises;
const path = require('path');

// Function to capitalize first letter
const capitalizeFirstLetter = (string) => {
  return string.charAt(0).toUpperCase() + string.slice(1);
};

// Function to load all providers
const loadProviders = async () => {
  const providersDir = path.join(__dirname, '../../../config/providers');
  const providers = {};

  try {
    const dirs = await fs.readdir(providersDir);
    console.log('Found provider directories for refresh:', dirs);
    
    for (const dir of dirs) {
      const apiPath = path.join(providersDir, dir, 'api.js');
      console.log('Loading provider from:', apiPath);
      try {
        // Delete cache first to ensure we get fresh modules
        delete require.cache[require.resolve(apiPath)];
        const providerModule = require(apiPath);
        const functionName = `refresh${capitalizeFirstLetter(dir)}Credentials`;
        
        if (typeof providerModule[functionName] === 'function') {
          providers[dir] = providerModule[functionName];
          console.log(`Successfully loaded refresh provider: ${dir}`);
        } else {
          console.warn(`Warning: ${functionName} not found in ${apiPath}`);
        }
      } catch (err) {
        console.error(`Error loading refresh provider ${dir}:`, err);
        console.error('Full error:', err.stack);
      }
    }

    console.log('Loaded refresh providers:', Object.keys(providers));
  } catch (err) {
    console.error('Error loading refresh providers:', err);
    console.error('Full error:', err.stack);
  }

  return providers;
};

// Cache for providers
let providersCache = null;

// Async function to refresh external credentials
async function refreshExternalCredentials(parent, args, { user }) {
  if (user) {
    // Find member with the user's email and permission
    const member = await Member.findOne({ 
      workspaceId: args.workspaceId, 
      userId: user.sub,
      permissions: "mutation:refreshExternalCredentials"
    });

    if (member) {
      try {
        // Validate inputs
        if (!args.service || !args.tokenId) {
          throw new Error('Missing required fields: service, tokenId');
        }

        // Load providers if not cached
        if (!providersCache) {
          providersCache = await loadProviders();
        }

        // Get the refresh function for the service
        const refreshFunction = providersCache[args.service];
        if (!refreshFunction) {
          throw new Error(`Provider ${args.service} not found or refresh function not available. Available providers: ${Object.keys(providersCache).join(', ')}`);
        }

        // Call the provider's refresh function
        let result;
        if (args.service === 'salesforce') {
          const appUrl = process.env.APP_URI;
          if (!appUrl) {
            console.error('APP_URI is not defined in environment variables for outrun-core.');
            throw new Error('APP_URI is not configured for salesforce redirect_uri construction.');
          }
          const salesforceCallbackPath = '/api/callback/salesforce';
          const redirectUri = `${appUrl}${salesforceCallbackPath}`;
          result = await refreshFunction(args.tokenId, args.workspaceId, redirectUri, args.scope);
        } else if (args.service === 'zoho') {
          // For Zoho, pass the redirectUri and accountsServer parameters
          result = await refreshFunction(args.tokenId, args.workspaceId, args.scope, args.redirectUri, args.accountsServer);
        } else {
          // For other services
          result = await refreshFunction(args.tokenId, args.workspaceId, args.scope);
        }

        // Check for successful response
        if (result) {
          return result;
        } else {
          throw new Error(`Error refreshing external credentials for ${args.service}`);
        }
        
      } catch (error) {
        console.error('Error refreshing external credentials:', error);
        throw error;
      }
    } else {
      console.error('User not authorized to refresh external credentials');
      throw new Error('Unauthorized to refresh external credentials');
    }
  } else {
    console.error('User not authenticated');
    throw new Error('User not authenticated');
  }
}

// Export the refreshExternalCredentials function
module.exports = { refreshExternalCredentials };
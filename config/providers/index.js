const OpenAIProvider = require('./openai/client');
const GoogleProvider = require('./google/client');

class ProviderFactory {
    constructor() {
        this.providers = new Map();
        this.initializeProviders();
    }

    // Initialize all providers
    initializeProviders() {
        // Initialize OpenAI if API key is available
        if (process.env.OPENAI_API_KEY) {
            try {
                const openaiProvider = new OpenAIProvider();
                if (openaiProvider.client) {
                    this.providers.set('openai', openaiProvider);
                    console.log('✅ OpenAI provider initialized');
                }
            } catch (error) {
                console.error('❌ Failed to initialize OpenAI provider:', error.message);
            }
        } else {
            console.warn('🟡 OpenAI API key not found, skipping OpenAI provider');
        }

        // Initialize Google if credentials are available (handles both Gemini and Anthropic via Vertex AI)
        if (process.env.GCP_PROJECT_ID) {
            try {
                const googleProvider = new GoogleProvider();
                if (googleProvider.vertexAI || googleProvider.anthropicVertex) {
                    this.providers.set('google', googleProvider);
                    console.log('✅ Google Vertex AI provider initialized (includes Gemini and Anthropic models)');
                }
            } catch (error) {
                console.error('❌ Failed to initialize Google provider:', error.message);
            }
        } else {
            console.warn('🟡 GCP_PROJECT_ID not found, skipping Google provider');
        }
    }

    // Get a specific provider
    getProvider(providerName) {
        return this.providers.get(providerName);
    }

    // Get all providers
    getAllProviders() {
        return Object.fromEntries(this.providers);
    }

    // Get all available models across all providers
    getAllAvailableModels() {
        const models = {};
        
        this.providers.forEach((provider, providerName) => {
            if (provider.getAvailableModels) {
                models[providerName] = provider.getAvailableModels();
            }
        });
        
        return models;
    }

    // Check if any providers are available
    hasProviders() {
        return this.providers.size > 0;
    }

    // Get provider info
    getProviderInfo() {
        const info = {};
        
        this.providers.forEach((provider, providerName) => {
            if (provider.getProviderInfo) {
                info[providerName] = provider.getProviderInfo();
            } else {
                info[providerName] = {
                    name: providerName,
                    initialized: true
                };
            }
        });
        
        return info;
    }
}

module.exports = ProviderFactory; 
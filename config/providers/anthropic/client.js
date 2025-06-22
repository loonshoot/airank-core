const { Anthropic } = require('@anthropic-ai/sdk');
const { RateLimiter } = require('limiter');

// Rate limits for Anthropic models (requests per minute)
const RATE_LIMITS = {
    'claude-3-sonnet-20240229': { rpm: 50, tpm: 40000 },
    'claude-3-haiku-20240307': { rpm: 50, tpm: 50000 },
    'claude-3-opus-20240229': { rpm: 50, tpm: 20000 },
    'claude-3-5-sonnet-20241022': { rpm: 50, tpm: 40000 }
};

class AnthropicProvider {
    constructor(apiKey, redisClient) {
        if (!apiKey) {
            throw new Error('Anthropic API key is required');
        }
        
        this.client = new Anthropic({ apiKey });
        this.redisClient = redisClient;
        this.rateLimiters = new Map();
        
        // Initialize rate limiters for each model
        Object.keys(RATE_LIMITS).forEach(modelId => {
            const limits = RATE_LIMITS[modelId];
            this.rateLimiters.set(modelId, {
                requests: new RateLimiter({ tokensPerInterval: limits.rpm, interval: 'minute' }),
                tokens: new RateLimiter({ tokensPerInterval: limits.tpm, interval: 'minute' })
            });
        });
    }

    // Check Redis-based rate limit
    async checkRedisRateLimit(modelId, type = 'requests') {
        const key = `anthropic:${modelId}:${type}`;
        const limits = RATE_LIMITS[modelId];
        
        if (!limits) {
            console.warn(`No rate limits defined for Anthropic model: ${modelId}`);
            return true;
        }

        const limit = type === 'requests' ? limits.rpm : limits.tpm;
        const current = await this.redisClient.incr(key);
        
        if (current === 1) {
            await this.redisClient.expire(key, 60); // 1 minute expiry
        }

        return current <= limit;
    }

    // Wait for rate limit reset
    async waitForRateLimit(modelId, type = 'requests') {
        const key = `anthropic:${modelId}:${type}`;
        const ttl = await this.redisClient.ttl(key);
        
        if (ttl > 0) {
            console.log(`Anthropic rate limit hit for ${modelId} (${type}), waiting ${ttl} seconds...`);
            await new Promise(resolve => setTimeout(resolve, ttl * 1000));
        }
    }

    // Estimate token count (rough approximation)
    estimateTokens(text) {
        return Math.ceil(text.length / 4);
    }

    // Make a message request with rate limiting
    async createMessage(modelId, messages, options = {}) {
        const startTime = Date.now();
        
        // Check rate limits
        const canMakeRequest = await this.checkRedisRateLimit(modelId, 'requests');
        if (!canMakeRequest) {
            await this.waitForRateLimit(modelId, 'requests');
        }

        // Estimate token usage for rate limiting
        const inputText = messages.map(m => m.content).join(' ');
        const estimatedTokens = this.estimateTokens(inputText) + (options.max_tokens || 1000);

        const canUseTokens = await this.checkRedisRateLimit(modelId, 'tokens');
        if (!canUseTokens) {
            await this.waitForRateLimit(modelId, 'tokens');
        }

        try {
            const response = await this.client.messages.create({
                model: modelId,
                max_tokens: options.max_tokens || 1000,
                temperature: options.temperature || 0.7,
                messages,
                ...options
            });

            const responseTime = Date.now() - startTime;
            
            return {
                content: response.content[0].text,
                tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
                inputTokens: response.usage.input_tokens,
                outputTokens: response.usage.output_tokens,
                responseTime,
                model: response.model,
                stopReason: response.stop_reason
            };
        } catch (error) {
            console.error(`Anthropic API error for ${modelId}:`, error.message);
            
            // Handle rate limit errors specifically
            if (error.status === 429) {
                console.log(`Anthropic rate limit exceeded for ${modelId}, waiting before retry...`);
                await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 1 minute
                throw new Error(`Rate limit exceeded for ${modelId}`);
            }
            
            throw error;
        }
    }

    // Get available models
    getAvailableModels() {
        return Object.keys(RATE_LIMITS);
    }

    // Get rate limit info for a model
    getRateLimitInfo(modelId) {
        return RATE_LIMITS[modelId] || null;
    }
}

module.exports = AnthropicProvider; 
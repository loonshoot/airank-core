const OpenAI = require('openai');
const { RateLimiter } = require('limiter');

// Rate limits for approved OpenAI models only
const RATE_LIMITS = {
    'gpt-4': { rpm: 500, tpm: 10000 },
    'gpt-4o': { rpm: 500, tpm: 30000 },
    'gpt-4-turbo': { rpm: 500, tpm: 30000 }
};

class OpenAIProvider {
    constructor() {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            console.warn('🟡 OpenAI provider: OPENAI_API_KEY not set');
            return;
        }
        
        this.client = new OpenAI({ apiKey });
        this.name = 'openai';
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
        // For now, use in-memory rate limiting since Redis client isn't available
        // TODO: Integrate with Redis when available
        const rateLimiter = this.rateLimiters.get(modelId);
        if (!rateLimiter) {
            return true;
        }

        const limiter = type === 'requests' ? rateLimiter.requests : rateLimiter.tokens;
        try {
            await limiter.removeTokens(1);
            return true;
        } catch (error) {
            return false;
        }
    }

    // Wait for rate limit reset
    async waitForRateLimit(modelId, type = 'requests') {
        // Simple backoff strategy
        console.log(`OpenAI rate limit hit for ${modelId} (${type}), waiting 60 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 60000));
    }

    // Estimate token count (rough approximation)
    estimateTokens(text) {
        return Math.ceil(text.length / 4);
    }

    // Make a chat completion request with rate limiting
    async chatCompletion(modelId, messages, options = {}) {
        const startTime = Date.now();
        
        // Check rate limits
        const canMakeRequest = await this.checkRedisRateLimit(modelId, 'requests');
        if (!canMakeRequest) {
            await this.waitForRateLimit(modelId, 'requests');
        }

        // Estimate token usage for rate limiting
        const inputText = messages.map(m => m.content).join(' ');
        const estimatedInputTokens = this.estimateTokens(inputText);
        const estimatedOutputTokens = options.max_tokens || 1000;
        const totalEstimatedTokens = estimatedInputTokens + estimatedOutputTokens;

        const canUseTokens = await this.checkRedisRateLimit(modelId, 'tokens');
        if (!canUseTokens) {
            await this.waitForRateLimit(modelId, 'tokens');
        }

        try {
            // o1 models use different parameter names
            const isO1Model = modelId.includes('o1');
            const requestParams = {
                model: modelId,
                messages,
                ...options
            };
            
            // o1 models use max_completion_tokens instead of max_tokens and don't support temperature
            if (isO1Model) {
                requestParams.max_completion_tokens = options.max_tokens || 1000;
                // o1 models don't support temperature parameter
                delete requestParams.temperature;
            } else {
                requestParams.max_tokens = options.max_tokens || 1000;
                requestParams.temperature = options.temperature || 0.7;
            }
            
            const response = await this.client.chat.completions.create(requestParams);

            const responseTime = Date.now() - startTime;
            
            return {
                content: response.choices[0].message.content,
                tokensUsed: response.usage.total_tokens,
                inputTokens: response.usage.prompt_tokens,
                outputTokens: response.usage.completion_tokens,
                responseTime,
                model: response.model,
                finishReason: response.choices[0].finish_reason
            };
        } catch (error) {
            console.error(`OpenAI API error for ${modelId}:`, error.message);
            
            // Handle rate limit errors specifically
            if (error.status === 429) {
                console.log(`OpenAI rate limit exceeded for ${modelId}, waiting before retry...`);
                await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 1 minute
                throw new Error(`Rate limit exceeded for ${modelId}`);
            }
            
            throw error;
        }
    }

    // Generate text using the model (wrapper around chatCompletion)
    async generateText(modelId, prompt, options = {}) {
        const messages = [
            { role: 'user', content: prompt }
        ];

        const result = await this.chatCompletion(modelId, messages, options);
        
        return {
            response: result.content,
            tokensUsed: result.tokensUsed,
            responseTime: result.responseTime,
            model: result.model,
            provider: 'openai'
        };
    }

    // Check if a model is supported
    isModelSupported(modelId) {
        return Object.keys(RATE_LIMITS).includes(modelId);
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

module.exports = OpenAIProvider; 
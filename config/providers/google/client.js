const { VertexAI } = require('@google-cloud/vertexai');
const { GoogleAuth } = require('google-auth-library');
const { AnthropicVertex } = require('@anthropic-ai/vertex-sdk');
const { RateLimiter } = require('limiter');

class GoogleProvider {
  constructor() {
    this.name = 'google';
    this.rateLimiters = new Map();
    this.vertexAI = null;
    this.anthropicVertex = null;
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID;
    this.location = process.env.GOOGLE_CLOUD_LOCATION || 'us-east5'; // us-east5 supports Claude models
    
    this.initialize();
  }

  async initialize() {
    if (!this.projectId) {
      console.warn('🟡 Google provider: GOOGLE_CLOUD_PROJECT_ID not set');
      return;
    }

    try {
      // Initialize Vertex AI for Gemini models
      this.vertexAI = new VertexAI({
        project: this.projectId,
        location: this.location,
      });

      // Initialize Anthropic Vertex for Claude models
      this.anthropicVertex = new AnthropicVertex({
        projectId: this.projectId,
        region: this.location,
      });

      console.log('✅ Google provider initialized successfully');
    } catch (error) {
      console.error('❌ Google provider initialization failed:', error.message);
    }
  }

  getRateLimiter(modelId, type = 'requests') {
    const key = `${modelId}:${type}`;
    
    if (!this.rateLimiters.has(key)) {
      const limits = this.getModelLimits(modelId, type);
      this.rateLimiters.set(key, new RateLimiter({
        tokensPerInterval: limits.max,
        interval: limits.interval
      }));
    }
    
    return this.rateLimiters.get(key);
  }

  getModelLimits(modelId, type) {
    // Gemini models (via Vertex AI)
    const geminiLimits = {
      'gemini-2.5-pro': {
        requests: { max: 300, interval: 60000 }, // 300 RPM
        tokens: { max: 1000000, interval: 60000 } // 1M TPM
      },
      'gemini-2.5-flash': {
        requests: { max: 1000, interval: 60000 }, // 1000 RPM  
        tokens: { max: 1000000, interval: 60000 } // 1M TPM
      }
    };

    // Claude models (via Vertex AI) - based on Vertex AI documentation
    const claudeLimits = {
      'claude-opus-4@20250514': {
        requests: { max: 25, interval: 60000 }, // 25 QPM
        tokens: { max: 60000, interval: 60000 } // 60k input TPM
      },
      'claude-sonnet-4@20250514': {
        requests: { max: 35, interval: 60000 }, // 35 QPM
        tokens: { max: 280000, interval: 60000 } // 280k input TPM
      }
    };

    const allLimits = { ...geminiLimits, ...claudeLimits };
    return allLimits[modelId]?.[type] || { max: 100, interval: 60000 };
  }

  async generateText(modelId, prompt, options = {}) {
    if (!this.vertexAI && !this.anthropicVertex) {
      throw new Error('Google provider not initialized');
    }

    // Apply rate limiting
    const requestLimiter = this.getRateLimiter(modelId, 'requests');
    const tokenLimiter = this.getRateLimiter(modelId, 'tokens');
    
    await requestLimiter.removeTokens(1);
    
    const startTime = Date.now();

    try {
      let response;
      let tokensUsed = 0;

      // Check if it's a Claude model (Anthropic via Vertex AI)
      if (modelId.startsWith('claude-')) {
        if (!this.anthropicVertex) {
          throw new Error('Anthropic Vertex client not initialized');
        }

        const message = await this.anthropicVertex.messages.create({
          model: modelId,
          max_tokens: options.max_tokens || options.maxTokens || 1024,
          anthropic_version: "vertex-2024-10-22",
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        });

        response = message.content[0].text;
        tokensUsed = message.usage.input_tokens + message.usage.output_tokens;
      } 
      // Gemini models (via Vertex AI)
      else {
        if (!this.vertexAI) {
          throw new Error('Vertex AI client not initialized');
        }

        // Use configuration from shared model config (passed via options)
        const maxTokens = options.max_tokens || options.maxTokens || 1024;
        const model = this.vertexAI.getGenerativeModel({
          model: modelId,
          generationConfig: {
            maxOutputTokens: maxTokens,
            temperature: options.temperature !== undefined ? options.temperature : 0.7,
            topP: options.topP !== undefined ? options.topP : 1.0,
            topK: options.topK !== undefined ? options.topK : 32,
          },
          safetySettings: [
            // Use default safety settings to match web interface behavior
            {
              category: 'HARM_CATEGORY_HARASSMENT',
              threshold: 'BLOCK_MEDIUM_AND_ABOVE'
            },
            {
              category: 'HARM_CATEGORY_HATE_SPEECH', 
              threshold: 'BLOCK_MEDIUM_AND_ABOVE'
            },
            {
              category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
              threshold: 'BLOCK_MEDIUM_AND_ABOVE'
            },
            {
              category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
              threshold: 'BLOCK_MEDIUM_AND_ABOVE'
            }
          ]
        });

        // Use the simple format first, which usually works best
        const result = await model.generateContent(prompt);
        
        // The response structure should be: result.response.candidates[0].content.parts[0].text
        let responseData = result.response;
        
        console.log('🔍 Gemini response structure:', JSON.stringify({
          hasResult: !!result,
          hasResponse: !!responseData,
          hasCandidates: !!(responseData?.candidates),
          candidatesLength: responseData?.candidates?.length || 0,
          firstCandidateStructure: responseData?.candidates?.[0] ? {
            hasContent: !!(responseData.candidates[0].content),
            hasParts: !!(responseData.candidates[0].content?.parts),
            partsLength: responseData.candidates[0].content?.parts?.length || 0,
            firstPartType: responseData.candidates[0].content?.parts?.[0] ? typeof responseData.candidates[0].content.parts[0] : null,
            hasText: !!(responseData.candidates[0].content?.parts?.[0]?.text)
          } : null
        }, null, 2));
        
        // Extract text from the Gemini response structure
        const candidate = responseData?.candidates?.[0];
        
        if (candidate?.content?.parts?.[0]?.text) {
          // Standard response format
          response = candidate.content.parts[0].text;
        } else if (candidate?.finishReason === 'MAX_TOKENS' && !candidate.content?.parts) {
          // Handle case where response was truncated due to max tokens
          console.warn('⚠️ Gemini response was truncated due to MAX_TOKENS limit');
          response = '[Response truncated due to token limit]';
        } else if (candidate?.content?.text) {
          // Alternative response format
          response = candidate.content.text;
        } else {
          // Log the full response to understand the structure
          console.error('🚨 Unexpected Gemini response structure:', JSON.stringify(result, null, 2));
          throw new Error(`Unable to extract text from Gemini response. Expected structure not found.`);
        }
        
        tokensUsed = responseData?.usageMetadata?.totalTokenCount || 0;
      }

      // Apply token-based rate limiting
      await tokenLimiter.removeTokens(tokensUsed);

      const responseTime = Date.now() - startTime;

      return {
        response,
        tokensUsed,
        responseTime,
        model: modelId,
        provider: this.name
      };

    } catch (error) {
      console.error(`❌ Google provider error for ${modelId}:`, error.message);
      throw error;
    }
  }

  isModelSupported(modelId) {
    const supportedModels = [
      // Gemini models
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      // Claude models via Vertex AI
      'claude-opus-4@20250514',
      'claude-sonnet-4@20250514'
    ];
    
    return supportedModels.includes(modelId);
  }

  getProviderInfo() {
    return {
      name: this.name,
      initialized: !!(this.vertexAI || this.anthropicVertex),
      supportedModels: [
        'gemini-2.5-pro',
        'gemini-2.5-flash', 
        'claude-opus-4@20250514',
        'claude-sonnet-4@20250514'
      ]
    };
  }
}

module.exports = GoogleProvider; 
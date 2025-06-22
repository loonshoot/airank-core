// Comprehensive models list - includes current and historic models
// This is the master list that includes all models we've ever supported
const ALL_AVAILABLE_MODELS = [
  // Current models (active) - these appear in the frontend selection
  {
    id: 'gpt-4',
    name: 'GPT-4',
    provider: 'openai',
    description: 'OpenAI\'s most capable model for complex tasks',
    status: 'active'
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    description: 'Most capable GPT-4 model with multimodal capabilities',
    status: 'active'
  },
  {
    id: 'gpt-4-turbo',
    name: 'GPT-4 Turbo',
    provider: 'openai',
    description: 'Optimized GPT-4 model for speed and efficiency',
    status: 'active'
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'google',
    description: 'Google\'s latest and most capable model',
    status: 'active'
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'google',
    description: 'Fast and efficient Gemini 2.5 model',
    status: 'active'
  },
  {
    id: 'claude-opus-4@20250514',
    name: 'Claude Opus 4',
    provider: 'google', // Via Vertex AI
    description: 'Anthropic\'s most powerful model for complex reasoning',
    status: 'historic' // Temporarily disabled due to quota limits - need quota increase
  },
  {
    id: 'claude-sonnet-4@20250514',
    name: 'Claude Sonnet 4',
    provider: 'google', // Via Vertex AI
    description: 'Balanced Claude 4 model for most use cases',
    status: 'historic' // Temporarily disabled due to quota limits - need quota increase
  },
  
  // Historic models (deprecated but still supported for existing users)
  {
    id: 'gpt-4.1-mini',
    name: 'GPT-4.1 Mini',
    provider: 'openai',
    description: 'Compact and efficient GPT-4.1 model',
    status: 'historic'
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    description: 'Smaller version of GPT-4o',
    status: 'historic'
  },
  {
    id: 'o1-mini',
    name: 'O1 Mini',
    provider: 'openai',
    description: 'OpenAI O1 reasoning model (mini)',
    status: 'historic'
  },
  {
    id: 'chatgpt-4o-latest',
    name: 'ChatGPT-4o Latest',
    provider: 'openai',
    description: 'Latest ChatGPT-4o model',
    status: 'historic'
  },
  {
    id: 'gpt-4.1-preview',
    name: 'GPT-4.1 Preview',
    provider: 'openai',
    description: 'Preview version of GPT-4.1',
    status: 'historic'
  }
];

// Get only active models (for job processing)
const getActiveModels = () => {
  return ALL_AVAILABLE_MODELS.filter(model => model.status === 'active');
};

// Get only historic models
const getHistoricModels = () => {
  return ALL_AVAILABLE_MODELS.filter(model => model.status === 'historic');
};

// Get model by ID
const getModelById = (modelId) => {
  return ALL_AVAILABLE_MODELS.find(model => model.id === modelId);
};

// Check if model is historic
const isModelHistoric = (modelId) => {
  const model = getModelById(modelId);
  return model && model.status === 'historic';
};

// Model-specific configuration based on web interface defaults
const getModelConfig = (modelId, task = 'generation') => {
  const configs = {
    // OpenAI Models - Web GUI (ChatGPT) defaults to a balanced, creative setting.
    'gpt-4': {
      generation: { max_tokens: 4096, temperature: 0.7, top_p: 1 },
      sentiment: { max_tokens: 500, temperature: 0.2, top_p: 1 } // More focused for sentiment
    },
    'gpt-4o': {
      generation: { max_tokens: 4096, temperature: 0.7, top_p: 1 },
      sentiment: { max_tokens: 500, temperature: 0.2, top_p: 1 }
    },
    'gpt-4-turbo': {
      generation: { max_tokens: 4096, temperature: 0.7, top_p: 1 },
      sentiment: { max_tokens: 500, temperature: 0.2, top_p: 1 }
    },
    
    // Gemini Models - Web GUI (Google AI Studio) often defaults to a higher temperature for creativity.
    'gemini-2.5-pro': {
      generation: { max_tokens: 2048, temperature: 1.0, topP: 1.0, topK: 32 }, // Higher temp is common
      sentiment: { max_tokens: 2500, temperature: 0.3, topP: 1.0, topK: 20 } // High limit for analyzing long responses
    },
    'gemini-2.5-flash': {
      generation: { max_tokens: 2048, temperature: 1.0, topP: 1.0, topK: 32 },
      sentiment: { max_tokens: 2500, temperature: 0.2, topP: 1.0, topK: 15 } // High limit for analyzing long responses
    },
    
    // Claude Models - Web interface (claude.ai) aims for a balanced and reliable output.
    'claude-opus-4@20250514': {
      generation: { max_tokens: 2048, temperature: 0.7, top_p: 1.0, top_k: 50 }, // Balanced creativity
      sentiment: { max_tokens: 800, temperature: 0.2, top_p: 1.0, top_k: 20 }
    },
    'claude-sonnet-4@20250514': {
      generation: { max_tokens: 2048, temperature: 0.7, top_p: 1.0, top_k: 50 },
      sentiment: { max_tokens: 800, temperature: 0.2, top_p: 1.0, top_k: 20 }
    }
  };

  // Return the specific configuration for the requested model and task
  if (configs[modelId] && configs[modelId][task]) {
    return configs[modelId][task];
  }

  // Fallback to a default generation config if the model or task is not found
  return { max_tokens: 1024, temperature: 0.7, top_p: 1.0, top_k: 40 };
};

module.exports = {
  ALL_AVAILABLE_MODELS,
  getActiveModels,
  getHistoricModels,
  getModelById,
  isModelHistoric,
  getModelConfig
}; 
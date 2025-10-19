const mongoose = require('mongoose');
const ProviderFactory = require('../providers');
const { getActiveModels } = require('../data/availableModels');

// Import models from config
const { 
    Prompt, 
    Brand, 
    Model, 
    PreviousModelResult 
} = require('../data/models');

// Import shared model configuration
const { getModelConfig } = require('../data/availableModels');

// Run prompt against a specific model using providers
const runPromptAgainstModel = async (providers, prompt, model, workspaceId, WorkspacePreviousModelResult) => {
    const { id: modelId, name, provider } = model;
    
    try {
        console.log(`🤖 Running prompt against ${provider}:${modelId}`);
        
        // Get the appropriate provider
        const providerInstance = providers.getProvider(provider);
        if (!providerInstance) {
            throw new Error(`Provider ${provider} not available`);
        }

        // Get model-specific configuration
        const modelConfig = getModelConfig(modelId);
        
        // Call the model using the provider
        const result = await providerInstance.generateText(modelId, prompt.phrase, modelConfig);

        // Store result in database
        const modelResult = new WorkspacePreviousModelResult({
            promptId: prompt._id,
            modelId: modelId, // Store as string, not ObjectId
            prompt: prompt.phrase,
            modelName: name,
            provider,
            response: result.response,
            tokensUsed: result.tokensUsed,
            responseTime: result.responseTime,
            workspaceId
        });

        await modelResult.save();
        
        console.log(`✓ Completed ${name} for prompt: "${prompt.phrase.substring(0, 50)}..."`);
        return modelResult;
        
    } catch (error) {
        console.error(`✗ Failed ${name} for prompt: "${prompt.phrase.substring(0, 50)}...":`, error.message);
        throw error;
    }
};

// Perform sentiment analysis using Gemini via Google provider
const performSentimentAnalysis = async (providers, modelResult, brands, workspaceId, job) => {
    // Create list of all brands to analyze
    const allBrands = [
        { name: brands.ownBrand?.name || 'Not specified', type: 'own' },
        ...brands.competitors.map(b => ({ name: b.name, type: 'competitor' }))
    ];

    const analysisPrompt = `Analyze this text for brand mentions and sentiment. Return ONLY valid JSON.

Brands to check: ${allBrands.map(b => `${b.name} (${b.type})`).join(', ')}

Text: "${modelResult.response}"

JSON format:
{
    "brands": [
        {
            "brandKeywords": "string",
            "type": "own"|"competitor", 
            "mentioned": boolean,
            "sentiment": "positive"|"negative"|"not-determined"
        }
    ],
    "overallSentiment": "positive"|"negative"|"not-determined"
}

Include ALL brands in the array. Return JSON only:`;

    try {
        console.log(`🔍 Analyzing sentiment for result ${modelResult._id}`);
        
        // Touch the job to extend lock before API call
        if (job && typeof job.touch === 'function') {
            job.touch();
        }
        
        // Use Gemini for sentiment analysis via Google provider
        const googleProvider = providers.getProvider('google');
        if (!googleProvider) {
            throw new Error('Google provider not available for sentiment analysis');
        }

        // Get model-specific config for sentiment analysis
        const sentimentConfig = getModelConfig('gemini-2.5-flash', 'sentiment');
        
        const analysisResult = await googleProvider.generateText('gemini-2.5-flash', analysisPrompt, sentimentConfig);
        
        // Parse the JSON response
        let sentimentData;
        try {
            // Extract JSON from response (in case there's additional text)
            const jsonMatch = analysisResult.response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                sentimentData = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('No JSON found in response');
            }
        } catch (parseError) {
            console.error('Failed to parse sentiment analysis JSON:', parseError);
            // Fallback to basic analysis with new structure
            sentimentData = {
                brands: allBrands.map(brand => ({
                    brandKeywords: brand.name,
                    type: brand.type,
                    mentioned: false,
                    sentiment: 'not-determined'
                })),
                overallSentiment: 'not-determined'
            };
        }

        // Update the model result with sentiment analysis
        modelResult.sentimentAnalysis = {
            ...sentimentData,
            analyzedAt: new Date(),
            analyzedBy: 'gemini-2.5-flash'
        };

        await modelResult.save();
        
        console.log(`✓ Sentiment analysis completed for result ${modelResult._id}`);
        return modelResult;
        
    } catch (error) {
        console.error(`✗ Sentiment analysis failed for result ${modelResult._id}:`, error.message);
        throw error;
    }
};

// Main job function
module.exports = async function promptModelTester(job, done) {
    const { workspaceId } = job.attrs.data;
    const redisClient = job.redisClient; // Fixed: Redis client is attached directly to job, not job.attrs
    
    if (!workspaceId) {
        return done(new Error('workspaceId is required'));
    }

    if (!redisClient) {
        return done(new Error('Redis client is required'));
    }

    let workspaceConnection = null;
    
    try {
        console.log(`🚀 Starting prompt-model testing job for workspace ${workspaceId}`);
        
        // Initialize provider factory with Redis client
        const providerFactory = new ProviderFactory();
        
        // Check which providers are available
        const availableProviders = [];
        const googleProvider = providerFactory.getProvider('google');
        const openaiProvider = providerFactory.getProvider('openai');
        const anthropicProvider = providerFactory.getProvider('anthropic');
        
        if (googleProvider) availableProviders.push('google');
        if (openaiProvider) availableProviders.push('openai');
        if (anthropicProvider) availableProviders.push('anthropic');
        
        if (availableProviders.length === 0) {
            throw new Error('No AI providers are available. Check your API keys and credentials.');
        }
        
        console.log(`📡 Available providers: ${availableProviders.join(', ')}`);

        // Connect to workspace-specific database with increased timeout
        console.log('🔌 Connecting to workspace database...');
        
        // Create a new mongoose connection with proper timeout settings
        const mongoUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
        workspaceConnection = mongoose.createConnection(mongoUri, {
            serverSelectionTimeoutMS: 30000, // 30 seconds
            socketTimeoutMS: 45000, // 45 seconds
            maxPoolSize: 10, // Maintain up to 10 socket connections
            minPoolSize: 5, // Maintain at least 5 socket connections
        });

        // Wait for connection to be established
        await new Promise((resolve, reject) => {
            workspaceConnection.once('connected', () => {
                console.log('✅ Connected to workspace database');
                resolve();
            });
            workspaceConnection.once('error', (error) => {
                console.error('❌ Workspace database connection error:', error);
                reject(error);
            });
            // Timeout after 30 seconds
            setTimeout(() => reject(new Error('Workspace database connection timeout')), 30000);
        });
        
        // Get models from workspace database
        const WorkspacePrompt = workspaceConnection.model('Prompt', require('../data/models').PromptSchema);
        const WorkspaceBrand = workspaceConnection.model('Brand', require('../data/models').BrandSchema);
        const WorkspacePreviousModelResult = workspaceConnection.model('PreviousModelResult', require('../data/models').PreviousModelResultSchema);

        // Fetch all prompts and brands with increased timeout and proper error handling
        console.log('📊 Fetching prompts and brands from database...');
        
        let prompts, brands;
        try {
            prompts = await WorkspacePrompt.find({}).maxTimeMS(30000).exec();
            console.log(`✅ Found ${prompts.length} prompts`);
        } catch (error) {
            console.error('❌ Error fetching prompts:', error.message);
            throw new Error(`Failed to fetch prompts: ${error.message}`);
        }
        
        try {
            brands = await WorkspaceBrand.find({}).maxTimeMS(30000).exec();
            console.log(`✅ Found ${brands.length} brands`);
        } catch (error) {
            console.error('❌ Error fetching brands:', error.message);
            throw new Error(`Failed to fetch brands: ${error.message}`);
        }

        if (prompts.length === 0) {
            console.log('⚠️ No prompts found for workspace');
            return done();
        }

        // Get active models and filter to only include those with available providers
        const availableModels = getActiveModels().filter(model => {
            const provider = providerFactory.getProvider(model.provider);
            return provider && provider.isModelSupported(model.id);
        });

        if (availableModels.length === 0) {
            console.log('⚠️ No models match available providers');
            return done();
        }

        console.log(`📊 Found ${prompts.length} prompts, ${brands.length} brands, and ${availableModels.length} available models`);

        // Organize brands for sentiment analysis
        const ownBrand = brands.find(b => b.isOwnBrand === true) || { name: 'Your Company' };
        const competitors = brands.filter(b => b.isOwnBrand === false);
        const brandData = { ownBrand, competitors };

        console.log(`🏷️ Brand info: Own brand: "${ownBrand.name}", Competitors: ${competitors.length}`);
        if (competitors.length > 0) {
            console.log(`🏆 Competitor brands: ${competitors.map(b => b.name).join(', ')}`);
        }

        // Track progress
        const totalOperations = prompts.length * availableModels.length;
        let completedOperations = 0;
        let failedOperations = 0;

        // Run each prompt against each model
        const modelResults = [];
        
        for (const prompt of prompts) {
            console.log(`📝 Processing prompt: "${prompt.phrase.substring(0, 100)}..."`);
            
            for (const model of availableModels) {
                try {
                    // Touch the job to extend lock before expensive model generation
                    if (typeof job.touch === 'function') {
                        job.touch();
                    }
                    
                    const result = await runPromptAgainstModel(providerFactory, prompt, model, workspaceId, WorkspacePreviousModelResult);
                    modelResults.push(result);
                    completedOperations++;
                } catch (error) {
                    console.error(`❌ Failed to run prompt "${prompt.phrase}" against model "${model.name}":`, error.message);
                    failedOperations++;
                }
                
                // Update job progress (if available)
                if (typeof job.progress === 'function') {
                    job.progress(Math.round((completedOperations + failedOperations) / totalOperations * 50)); // 50% for model testing
                }
                
                // Small delay to be respectful to APIs
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        console.log(`🎯 Model testing completed. ${completedOperations} successful, ${failedOperations} failed`);

        // Initialize sentiment analysis tracking variables
        let sentimentCompleted = 0;
        let sentimentFailed = 0;

        // Perform sentiment analysis on all results (only if Google provider is available)
        if (googleProvider && modelResults.length > 0) {
            console.log('🔍 Starting sentiment analysis...');

            for (const modelResult of modelResults) {
                try {
                    await performSentimentAnalysis(providerFactory, modelResult, brandData, workspaceId, job);
                    sentimentCompleted++;
                } catch (error) {
                    console.error(`❌ Sentiment analysis failed for result ${modelResult._id}:`, error.message);
                    sentimentFailed++;
                }
                
                // Update job progress (50% base + 50% for sentiment analysis)
                if (typeof job.progress === 'function') {
                    const sentimentProgress = Math.round((sentimentCompleted + sentimentFailed) / modelResults.length * 50);
                    job.progress(50 + sentimentProgress);
                }
                
                // Small delay between sentiment analysis calls
                await new Promise(resolve => setTimeout(resolve, 200));
            }

            console.log(`🎯 Sentiment analysis completed. ${sentimentCompleted} successful, ${sentimentFailed} failed`);
        } else {
            console.log('⚠️ Skipping sentiment analysis - Google provider not available');
        }

        // Final summary
        const summary = {
            totalPrompts: prompts.length,
            totalModels: availableModels.length,
            totalOperations,
            availableProviders,
            modelTestingResults: {
                successful: completedOperations,
                failed: failedOperations
            },
            sentimentAnalysisResults: googleProvider ? {
                successful: sentimentCompleted || 0,
                failed: sentimentFailed || 0
            } : {
                skipped: 'Google provider not available'
            },
            completedAt: new Date()
        };

        console.log('🎉 Job completed successfully:', summary);
        job.attrs.result = summary;
        
        // Close the workspace database connection
        if (workspaceConnection) {
            await workspaceConnection.close();
            console.log('🔌 Workspace database connection closed');
        }
        
        done();

    } catch (error) {
        console.error('💥 Job failed with error:', error);
        
        // Close the workspace database connection even on error
        if (workspaceConnection) {
            await workspaceConnection.close();
            console.log('🔌 Workspace database connection closed');
        }
        
        done(error);
    }
}; 
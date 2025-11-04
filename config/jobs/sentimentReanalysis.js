const mongoose = require('mongoose');
const ProviderFactory = require('../providers');
const { getModelConfig } = require('../data/availableModels');

// Import models from config
const { 
    Brand, 
    PreviousModelResult 
} = require('../data/models');

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

CRITICAL BRAND NORMALIZATION RULES:
1. The "brandKeywords" field MUST use ONLY the EXACT brand names from the list above
2. DO NOT include product names, card names, or descriptive additions (e.g., "NAB Rewards Signature Card" → "NAB")
3. Aggregate ALL variations of a brand to the single provided name:
   - "Commonwealth Bank", "CBA", "Commonwealth Bank Ultimate Awards Card" → use "Commbank" (if "Commbank" is in the list)
   - "National Australia Bank", "NAB", "NAB Rewards", "NAB Signature" → use "NAB" (if "NAB" is in the list)
   - "ANZ Black", "ANZ Black Credit Card", "ANZ Bank" → use "ANZ" (if "ANZ" is in the list)
   - "Westpac Altitude", "Westpac Altitude Black Card" → use "Westpac" (if "Westpac" is in the list)
4. If ANY form of a brand is mentioned (full name, abbreviation, or with product details), map it to the provided brand name
5. NEVER create new brand variations - use ONLY the exact names from the list above
6. If a brand mentioned is NOT semantically equivalent to any provided brand, do NOT include it

JSON format:
{
    "brands": [
        {
            "brandKeywords": "string (EXACT brand name from list - no variations allowed)",
            "type": "own"|"competitor",
            "mentioned": boolean,
            "sentiment": "positive"|"negative"|"not-determined"
        }
    ],
    "overallSentiment": "positive"|"negative"|"not-determined"
}

Include ALL brands from the provided list in the array. Return JSON only:`;

    try {
        console.log(`🔍 Re-analyzing sentiment for result ${modelResult._id}`);
        
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

        // Update the model result with NEW sentiment analysis structure
        modelResult.sentimentAnalysis = {
            ...sentimentData,
            analyzedAt: new Date(),
            analyzedBy: 'gemini-2.5-flash'
        };

        await modelResult.save();
        
        console.log(`✓ Sentiment re-analysis completed for result ${modelResult._id}`);
        return modelResult;
        
    } catch (error) {
        console.error(`✗ Sentiment re-analysis failed for result ${modelResult._id}:`, error.message);
        throw error;
    }
};

// Main job function - Re-run sentiment analysis only
module.exports = async function sentimentReanalysis(job, done) {
    const { workspaceId } = job.attrs.data;
    
    if (!workspaceId) {
        return done(new Error('workspaceId is required'));
    }

    let workspaceConnection = null;
    
    try {
        console.log(`🔄 Starting sentiment re-analysis job for workspace ${workspaceId}`);
        
        // Initialize provider factory
        const providerFactory = new ProviderFactory();
        
        // Check if Google provider is available
        const googleProvider = providerFactory.getProvider('google');
        if (!googleProvider) {
            throw new Error('Google provider is required for sentiment analysis');
        }
        
        console.log(`📡 Google provider available for sentiment analysis`);

        // Connect to workspace-specific database
        console.log('🔌 Connecting to workspace database...');
        
        const mongoUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
        workspaceConnection = mongoose.createConnection(mongoUri, {
            serverSelectionTimeoutMS: 30000,
            socketTimeoutMS: 45000,
            maxPoolSize: 10,
            minPoolSize: 5,
        });

        // Wait for connection
        await new Promise((resolve, reject) => {
            workspaceConnection.once('connected', () => {
                console.log('✅ Connected to workspace database');
                resolve();
            });
            workspaceConnection.once('error', (error) => {
                console.error('❌ Workspace database connection error:', error);
                reject(error);
            });
            setTimeout(() => reject(new Error('Workspace database connection timeout')), 30000);
        });
        
        // Get models from workspace database
        const WorkspaceBrand = workspaceConnection.model('Brand', require('../data/models').BrandSchema);
        const WorkspacePreviousModelResult = workspaceConnection.model('PreviousModelResult', require('../data/models').PreviousModelResultSchema);

        // Fetch brands
        console.log('📊 Fetching brands from database...');
        const brands = await WorkspaceBrand.find({}).maxTimeMS(30000).exec();
        console.log(`✅ Found ${brands.length} brands`);

        // Fetch existing model results that need sentiment re-analysis
        console.log('📊 Fetching existing model results...');
        const modelResults = await WorkspacePreviousModelResult.find({}).maxTimeMS(30000).exec();
        console.log(`✅ Found ${modelResults.length} existing model results`);

        if (modelResults.length === 0) {
            console.log('⚠️ No existing model results found for sentiment re-analysis');
            return done();
        }

        // Organize brands for sentiment analysis
        const ownBrand = brands.find(b => b.isOwnBrand === true) || { name: 'Your Company' };
        const competitors = brands.filter(b => b.isOwnBrand === false);
        const brandData = { ownBrand, competitors };

        console.log(`🏷️ Brand info: Own brand: "${ownBrand.name}", Competitors: ${competitors.length}`);

        // Track progress
        let sentimentCompleted = 0;
        let sentimentFailed = 0;

        // Re-run sentiment analysis on all existing results
        console.log('🔍 Starting sentiment re-analysis...');
        
        for (const modelResult of modelResults) {
            try {
                await performSentimentAnalysis(providerFactory, modelResult, brandData, workspaceId, job);
                sentimentCompleted++;
            } catch (error) {
                console.error(`❌ Sentiment re-analysis failed for result ${modelResult._id}:`, error.message);
                sentimentFailed++;
            }
            
            // Update job progress
            if (typeof job.progress === 'function') {
                job.progress(Math.round((sentimentCompleted + sentimentFailed) / modelResults.length * 100));
            }
            
            // Small delay to be respectful to APIs
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        console.log(`🎯 Sentiment re-analysis completed. ${sentimentCompleted} successful, ${sentimentFailed} failed`);
        
        // Close workspace connection
        if (workspaceConnection) {
            await workspaceConnection.close();
            console.log('🔌 Workspace database connection closed');
        }

        done();
        
    } catch (error) {
        console.error('❌ Job failed:', error.message);
        
        // Close workspace connection on error
        if (workspaceConnection) {
            try {
                await workspaceConnection.close();
            } catch (closeError) {
                console.error('❌ Error closing workspace connection:', closeError.message);
            }
        }
        
        done(error);
    }
}; 
const mongoose = require('mongoose');
const ProviderFactory = require('../providers');
const { getModelConfig } = require('../data/availableModels');

/**
 * Process batch results and perform sentiment analysis
 * This job is triggered by the listener service when a batch status changes to 'received'
 */
module.exports = async function processBatchResults(job, done) {
  const { workspaceId, documentId } = job.attrs.data;

  if (!workspaceId) {
    return done(new Error('workspaceId is required'));
  }

  if (!documentId) {
    return done(new Error('documentId is required'));
  }

  let workspaceConnection = null;

  try {
    console.log(`🔄 Processing batch results for workspace ${workspaceId}, batch ${documentId}`);

    // Connect to workspace-specific database
    const mongoUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
    workspaceConnection = mongoose.createConnection(mongoUri, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 5,
    });

    await new Promise((resolve, reject) => {
      workspaceConnection.once('connected', () => {
        console.log('✓ Connected to workspace database');
        resolve();
      });
      workspaceConnection.once('error', (error) => {
        console.error('❌ Workspace database connection error:', error);
        reject(error);
      });
      setTimeout(() => reject(new Error('Workspace database connection timeout')), 30000);
    });

    const workspaceDb = workspaceConnection.db;

    // Get the batch document
    const batch = await workspaceDb.collection('batches').findOne({
      _id: new mongoose.Types.ObjectId(documentId)
    });

    if (!batch) {
      throw new Error(`Batch ${documentId} not found`);
    }

    if (batch.isProcessed) {
      console.log('⚠️ Batch already processed, skipping');
      return done();
    }

    console.log(`📦 Batch: ${batch.batchId} (${batch.provider}) - ${batch.results.length} results`);

    // Get brands for sentiment analysis
    const WorkspaceBrand = workspaceConnection.model('Brand', require('../data/models').BrandSchema);
    const brands = await WorkspaceBrand.find({}).exec();

    const ownBrand = brands.find(b => b.isOwnBrand === true) || { name: 'Your Company' };
    const competitors = brands.filter(b => b.isOwnBrand === false);
    const brandData = { ownBrand, competitors };

    console.log(`🏷️ Brands: Own brand "${ownBrand.name}", ${competitors.length} competitors`);

    // Get PreviousModelResult model
    const WorkspacePreviousModelResult = workspaceConnection.model(
      'PreviousModelResult',
      require('../data/models').PreviousModelResultSchema
    );

    // Initialize provider factory for sentiment analysis
    const providerFactory = new ProviderFactory();
    const googleProvider = providerFactory.getProvider('google');

    if (!googleProvider) {
      console.log('⚠️ Google provider not available, skipping sentiment analysis');
    }

    let savedResults = 0;
    let sentimentCompleted = 0;
    let sentimentFailed = 0;

    // Process each result
    for (const result of batch.results) {
      try {
        // Touch the job to extend lock
        if (typeof job.touch === 'function') {
          job.touch();
        }

        // Parse custom_id to get prompt and model info
        // Format: workspaceId-promptId-modelId-timestamp
        const customIdParts = result.custom_id.split('-');
        const promptId = customIdParts[1];
        const modelId = customIdParts[2];

        // Get the prompt from batch metadata
        const promptDoc = await workspaceDb.collection('prompts').findOne({
          _id: new mongoose.Types.ObjectId(promptId)
        });

        if (!promptDoc) {
          console.error(`❌ Prompt ${promptId} not found`);
          continue;
        }

        // Extract response from batch result
        let responseText = '';
        let tokensUsed = 0;

        if (result.response && result.response.body) {
          const body = result.response.body;

          if (body.choices && body.choices.length > 0) {
            responseText = body.choices[0].message?.content || body.choices[0].text || '';
          } else if (body.candidates && body.candidates.length > 0) {
            // Gemini format
            responseText = body.candidates[0].content?.parts?.[0]?.text || '';
          }

          // Extract token usage
          if (body.usage) {
            tokensUsed = body.usage.total_tokens || 0;
          }
        }

        // Get model name from config
        const modelConfig = batch.metadata?.requests?.find(r => r.custom_id === result.custom_id);
        const modelName = modelConfig?.model || modelId;

        // Save model result
        const modelResult = new WorkspacePreviousModelResult({
          promptId: promptDoc._id,
          modelId: modelId,
          prompt: promptDoc.phrase,
          modelName: modelName,
          provider: batch.provider,
          response: responseText,
          tokensUsed: tokensUsed,
          responseTime: 0, // Batch jobs don't have individual response times
          workspaceId: workspaceId,
          batchId: batch.batchId,
          processedAt: new Date()
        });

        await modelResult.save();
        savedResults++;

        // Perform sentiment analysis if Google provider is available
        if (googleProvider && responseText) {
          try {
            const allBrands = [
              { name: brandData.ownBrand?.name || 'Not specified', type: 'own' },
              ...brandData.competitors.map(b => ({ name: b.name, type: 'competitor' }))
            ];

            const analysisPrompt = `Analyze this text for brand mentions and sentiment. Return ONLY valid JSON.

Brands to check: ${allBrands.map(b => `${b.name} (${b.type})`).join(', ')}

Text: "${responseText}"

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

            const sentimentConfig = getModelConfig('gemini-2.5-flash', 'sentiment');
            const analysisResult = await googleProvider.generateText('gemini-2.5-flash', analysisPrompt, sentimentConfig);

            console.log(`📊 Gemini sentiment response:`, analysisResult.response.substring(0, 500));

            // Parse sentiment data
            let sentimentData;
            try {
              const jsonMatch = analysisResult.response.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                sentimentData = JSON.parse(jsonMatch[0]);
                console.log(`✓ Parsed sentiment data - brands:`, sentimentData.brands?.length || 0);
              } else {
                throw new Error('No JSON found in response');
              }
            } catch (parseError) {
              console.warn(`⚠️  Failed to parse sentiment JSON:`, parseError.message);
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

            // Update model result with sentiment
            modelResult.sentimentAnalysis = {
              ...sentimentData,
              analyzedAt: new Date(),
              analyzedBy: 'gemini-2.5-flash'
            };

            await modelResult.save();
            sentimentCompleted++;

            // Small delay between sentiment analysis calls
            await new Promise(resolve => setTimeout(resolve, 200));

          } catch (error) {
            console.error(`❌ Sentiment analysis failed for result ${result.custom_id}:`, error.message);
            sentimentFailed++;
          }
        }

        console.log(`✓ Processed result ${savedResults}/${batch.results.length}`);

      } catch (error) {
        console.error(`❌ Failed to process result ${result.custom_id}:`, error.message);
      }
    }

    // Mark batch as processed
    await workspaceDb.collection('batches').updateOne(
      { _id: batch._id },
      {
        $set: {
          isProcessed: true,
          processedAt: new Date(),
          processingStats: {
            savedResults,
            sentimentCompleted,
            sentimentFailed,
            totalResults: batch.results.length
          }
        }
      }
    );

    console.log(`✅ Batch processing completed: ${savedResults} results saved, ${sentimentCompleted} sentiment analyses`);

    // Close workspace connection
    if (workspaceConnection) {
      await workspaceConnection.close();
      console.log('🔌 Workspace database connection closed');
    }

    done();

  } catch (error) {
    console.error('💥 Batch processing failed:', error);

    if (workspaceConnection) {
      await workspaceConnection.close();
    }

    done(error);
  }
};

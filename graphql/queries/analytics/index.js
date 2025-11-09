const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const { Member } = require('../member');

// Define the Analytics factory for workspace-specific connections
const Analytics = (workspaceId) => {
  const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
  const datalake = mongoose.createConnection(dataLakeUri);

  const PreviousModelResultSchema = new mongoose.Schema({
    promptId: { type: mongoose.Schema.Types.ObjectId, ref: 'Prompt', required: true },
    modelId: { type: String, required: true },
    prompt: { type: String, required: true },
    modelName: { type: String, required: true },
    provider: { type: String, required: true },
    response: { type: String, required: true },
    tokensUsed: { type: Number, required: true },
    responseTime: { type: Number, required: true },
    workspaceId: { type: String, required: true },
    sentimentAnalysis: {
      brands: [{
        brandKeywords: { type: String, required: true },
        type: { type: String, enum: ['own', 'competitor'], required: true },
        mentioned: { type: Boolean, default: false },
        sentiment: { type: String, enum: ['positive', 'negative', 'not-determined'], default: 'not-determined' }
      }],
      overallSentiment: { type: String, enum: ['positive', 'negative', 'not-determined'], default: 'not-determined' },
      analyzedAt: { type: Date },
      analyzedBy: { type: String, default: 'gemini-2.5-flash' }
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  });

  return {
    PreviousModelResult: datalake.model('PreviousModelResult', PreviousModelResultSchema)
  };
};

// Define the typeDefs (schema)
const typeDefs = gql`
  type BrandMention {
    brandName: String!
    brandType: String!
    mentionCount: Int!
    date: String!
  }

  type BrandSentiment {
    brandName: String!
    brandType: String!
    positive: Int!
    negative: Int!
    notDetermined: Int!
    total: Int!
    positivePercentage: Float!
  }

  type ShareOfVoice {
    brandName: String!
    brandType: String!
    mentionCount: Int!
    percentage: Float!
  }

  type DailyMentions {
    date: String!
    brands: [BrandMention!]!
  }

  type AnalyticsSummary {
    totalResults: Int!
    resultsWithSentiment: Int!
    dateRange: DateRange!
    ownBrandMentionPercentage: Float!
    exclusivityRate: Float!
  }

  type DateRange {
    start: String!
    end: String!
  }

  type MentionsByModel {
    modelName: String!
    ownBrandMentions: Int!
    competitorMentions: Int!
    totalMentions: Int!
    ownBrandPercentage: Float!
  }

  type PromptPerformance {
    prompt: String!
    winCount: Int!
    percentage: Float!
  }

  type CoMention {
    brandName: String!
    count: Int!
    percentage: Float!
  }

  type CoMentionAnalysis {
    brandName: String!
    coMentions: [CoMention!]!
  }

  type BrandPositionAnalysis {
    brandName: String!
    brandType: String!
    averagePosition: Float!
    firstMentions: Int!
    totalMentions: Int!
  }

  type SentimentTrend {
    date: String!
    positive: Int!
    negative: Int!
    neutral: Int!
    positivePercentage: Float!
  }

  type CompetitiveBreakdown {
    brandName: String!
    brandType: String!
    sentimentGap: Float!
    averagePosition: Float!
    positivePercentage: Float!
    mentionCount: Int!
  }

  type AnalyticsData {
    summary: AnalyticsSummary!
    dailyMentions: [DailyMentions!]!
    brandSentiments: [BrandSentiment!]!
    shareOfVoice: [ShareOfVoice!]!
    mentionsByModel: [MentionsByModel!]!
    ownBrandPromptPerformance: [PromptPerformance!]!
    competitorPromptPerformance: [PromptPerformance!]!
    coMentionAnalysis: [CoMentionAnalysis!]!
    brandPositionAnalysis: [BrandPositionAnalysis!]!
    sentimentTrend: [SentimentTrend!]!
    competitiveBreakdown: [CompetitiveBreakdown!]!
  }
`;

// Helper function to format date to YYYY-MM-DD
const formatDate = (date) => {
  return date.toISOString().split('T')[0];
};

// Helper function to get date range
const getDateRange = (startDate, endDate) => {
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default 30 days ago
  const end = endDate ? new Date(endDate) : new Date(); // Default today
  
  // Set to beginning/end of day
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  
  return { start, end };
};

// Define the resolvers
const resolvers = {
  analytics: async (_, { workspaceId, startDate, endDate }, { user }) => {
    if (!user || !user.sub) {
      throw new Error('User not authenticated');
    }

    const userId = user.sub;

    // Find member with the user's userId
    const member = await Member.findOne({
      workspaceId,
      userId: userId,
      permissions: "query:analytics"
    });

    if (!member) {
      throw new Error('User not authorized to query analytics');
    }

    const { PreviousModelResult } = Analytics(workspaceId);
    const { start, end } = getDateRange(startDate, endDate);

    // Get workspace brands for filtering
    const dataLakeUri = `${process.env.MONGODB_URI}/workspace_${workspaceId}?${process.env.MONGODB_PARAMS}`;
    const brandConnection = mongoose.createConnection(dataLakeUri);
    const BrandSchema = new mongoose.Schema({
      name: String,
      isOwnBrand: Boolean
    });
    const Brand = brandConnection.model('Brand', BrandSchema);
    const workspaceBrands = await Brand.find({});
    const validBrandNames = new Set(workspaceBrands.map(b => b.name));
    await brandConnection.close();

    try {
      // Get all results with sentiment analysis in date range
      const results = await PreviousModelResult.find({
        createdAt: { $gte: start, $lte: end },
        'sentimentAnalysis.brands': { $exists: true, $ne: [] }
      }).sort({ createdAt: 1 });

      if (results.length === 0) {
        return {
          summary: {
            totalResults: 0,
            resultsWithSentiment: 0,
            dateRange: {
              start: formatDate(start),
              end: formatDate(end)
            },
            ownBrandMentionPercentage: 0,
            exclusivityRate: 0
          },
          dailyMentions: [],
          brandSentiments: [],
          shareOfVoice: [],
          mentionsByModel: [],
          ownBrandPromptPerformance: [],
          competitorPromptPerformance: [],
          coMentionAnalysis: [],
          brandPositionAnalysis: [],
          sentimentTrend: [],
          competitiveBreakdown: []
        };
      }

      // Process data for analytics
      const dailyMentionsMap = new Map();
      const brandSentimentMap = new Map();
      const shareOfVoiceMap = new Map();
      let ownBrandMentions = 0;
      let totalResults = results.length;

      const mentionsByModelMap = new Map();
      const ownBrandPromptPerformanceMap = new Map();
      const competitorPromptPerformanceMap = new Map();

      results.forEach(result => {
        const date = formatDate(new Date(result.createdAt));

        // Track mentions by model with brand breakdown
        if (!mentionsByModelMap.has(result.modelName)) {
          mentionsByModelMap.set(result.modelName, {
            ownBrandMentions: 0,
            competitorMentions: 0,
            totalMentions: 0
          });
        }
        const modelData = mentionsByModelMap.get(result.modelName);

        // Initialize daily mentions for this date
        if (!dailyMentionsMap.has(date)) {
          dailyMentionsMap.set(date, new Map());
        }
        
        result.sentimentAnalysis.brands.forEach(brand => {
          // Only process brands that match the workspace's configured brands
          if (brand.mentioned && validBrandNames.has(brand.brandKeywords)) {
            const brandKey = `${brand.brandKeywords}-${brand.type}`;

            // Track mentions by model with brand type
            if (brand.type === 'own') {
              modelData.ownBrandMentions++;
            } else {
              modelData.competitorMentions++;
            }
            modelData.totalMentions++;

            // Track prompt performance
            if (brand.type === 'own') {
              ownBrandPromptPerformanceMap.set(result.prompt, (ownBrandPromptPerformanceMap.get(result.prompt) || 0) + 1);
            } else {
              competitorPromptPerformanceMap.set(result.prompt, (competitorPromptPerformanceMap.get(result.prompt) || 0) + 1);
            }

            // Track daily mentions
            const dayBrands = dailyMentionsMap.get(date);
            dayBrands.set(brandKey, (dayBrands.get(brandKey) || 0) + 1);

            // Track brand sentiment
            if (!brandSentimentMap.has(brandKey)) {
              brandSentimentMap.set(brandKey, {
                brandName: brand.brandKeywords,
                brandType: brand.type,
                positive: 0,
                negative: 0,
                notDetermined: 0,
                total: 0
              });
            }

            const sentimentData = brandSentimentMap.get(brandKey);
            sentimentData.total++;
            if (brand.sentiment === 'positive') sentimentData.positive++;
            else if (brand.sentiment === 'negative') sentimentData.negative++;
            else sentimentData.notDetermined++;

            // Track share of voice
            shareOfVoiceMap.set(brandKey, (shareOfVoiceMap.get(brandKey) || 0) + 1);

            // Track own brand mentions
            if (brand.type === 'own') {
              ownBrandMentions++;
            }
          }
        });
      });

      // Convert daily mentions to array format
      const dailyMentions = [];
      for (const [date, brands] of dailyMentionsMap) {
        const brandMentions = [];
        for (const [brandKey, count] of brands) {
          const [brandName, brandType] = brandKey.split('-');
          brandMentions.push({
            brandName: brandName.split('-')[0], // Remove type suffix
            brandType,
            mentionCount: count,
            date
          });
        }
        dailyMentions.push({ date, brands: brandMentions });
      }

      // Convert brand sentiments to array format
      const brandSentiments = Array.from(brandSentimentMap.values()).map(sentiment => ({
        ...sentiment,
        positivePercentage: sentiment.total > 0 ? (sentiment.positive / sentiment.total) * 100 : 0
      }));

      // Convert share of voice to array format
      const totalMentions = Array.from(shareOfVoiceMap.values()).reduce((sum, count) => sum + count, 0);
      const shareOfVoice = Array.from(shareOfVoiceMap.entries()).map(([brandKey, count]) => {
        const [brandName, brandType] = brandKey.split('-');
        return {
          brandName: brandName.split('-')[0],
          brandType,
          mentionCount: count,
          percentage: totalMentions > 0 ? (count / totalMentions) * 100 : 0
        };
      });

      // Convert mentions by model to array format
      const mentionsByModel = Array.from(mentionsByModelMap.entries()).map(([modelName, data]) => ({
        modelName,
        ownBrandMentions: data.ownBrandMentions,
        competitorMentions: data.competitorMentions,
        totalMentions: data.totalMentions,
        ownBrandPercentage: data.totalMentions > 0 ? (data.ownBrandMentions / data.totalMentions) * 100 : 0
      })).sort((a, b) => b.totalMentions - a.totalMentions);
      
      // Convert prompt performance to array format
      const totalOwnBrandWins = Array.from(ownBrandPromptPerformanceMap.values()).reduce((sum, count) => sum + count, 0);
      const ownBrandPromptPerformance = Array.from(ownBrandPromptPerformanceMap.entries()).map(([prompt, count]) => ({
        prompt,
        winCount: count,
        percentage: totalOwnBrandWins > 0 ? (count / totalOwnBrandWins) * 100 : 0
      })).sort((a, b) => b.winCount - a.winCount).slice(0, 5);

      const totalCompetitorWins = Array.from(competitorPromptPerformanceMap.values()).reduce((sum, count) => sum + count, 0);
      const competitorPromptPerformance = Array.from(competitorPromptPerformanceMap.entries()).map(([prompt, count]) => ({
        prompt,
        winCount: count,
        percentage: totalCompetitorWins > 0 ? (count / totalCompetitorWins) * 100 : 0
      })).sort((a, b) => b.winCount - a.winCount).slice(0, 5);

      // Calculate exclusivity rate (responses where only own brand is mentioned)
      let exclusiveOwnBrandCount = 0;
      results.forEach(result => {
        const mentionedBrands = result.sentimentAnalysis.brands.filter(b => b.mentioned && validBrandNames.has(b.brandKeywords));
        const hasOwnBrand = mentionedBrands.some(b => b.type === 'own');
        const hasOnlyOwnBrand = hasOwnBrand && mentionedBrands.every(b => b.type === 'own');
        if (hasOnlyOwnBrand) {
          exclusiveOwnBrandCount++;
        }
      });
      const exclusivityRate = totalResults > 0 ? (exclusiveOwnBrandCount / totalResults) * 100 : 0;

      // Calculate co-mention analysis
      const coMentionMap = new Map();
      const ownBrand = workspaceBrands.find(b => b.isOwnBrand);
      if (ownBrand) {
        results.forEach(result => {
          const mentionedBrands = result.sentimentAnalysis.brands.filter(b =>
            b.mentioned && validBrandNames.has(b.brandKeywords)
          );
          const hasOwnBrand = mentionedBrands.some(b => b.type === 'own' && b.brandKeywords === ownBrand.name);

          if (hasOwnBrand) {
            mentionedBrands.forEach(brand => {
              if (brand.type === 'competitor') {
                coMentionMap.set(brand.brandKeywords, (coMentionMap.get(brand.brandKeywords) || 0) + 1);
              }
            });
          }
        });
      }

      const ownBrandTotalMentions = shareOfVoiceMap.get(`${ownBrand?.name}-own`) || 1;
      const coMentionAnalysis = ownBrand ? [{
        brandName: ownBrand.name,
        coMentions: Array.from(coMentionMap.entries()).map(([brandName, count]) => ({
          brandName,
          count,
          percentage: (count / ownBrandTotalMentions) * 100
        })).sort((a, b) => b.count - a.count)
      }] : [];

      // Calculate brand position analysis
      const brandPositionMap = new Map();
      results.forEach(result => {
        const mentionedBrands = result.sentimentAnalysis.brands.filter(b =>
          b.mentioned && validBrandNames.has(b.brandKeywords)
        ).map(b => ({ ...b, brandKey: `${b.brandKeywords}-${b.type}` }));

        // Use actual position field from sentiment analysis, fallback to index for old data
        mentionedBrands.forEach((brand, index) => {
          if (!brandPositionMap.has(brand.brandKey)) {
            brandPositionMap.set(brand.brandKey, {
              brandName: brand.brandKeywords,
              brandType: brand.type,
              positions: [],
              firstCount: 0,
              totalCount: 0
            });
          }
          const posData = brandPositionMap.get(brand.brandKey);
          const position = brand.position || (index + 1); // Use actual position or fallback to index
          posData.positions.push(position);
          posData.totalCount++;
          if (position === 1) posData.firstCount++;
        });
      });

      const brandPositionAnalysis = Array.from(brandPositionMap.values())
        .filter(data => data.brandName && data.positions.length > 0) // Filter out invalid entries
        .map(data => ({
          brandName: data.brandName,
          brandType: data.brandType,
          averagePosition: data.positions.reduce((sum, pos) => sum + pos, 0) / data.positions.length,
          firstMentions: data.firstCount,
          totalMentions: data.totalCount
        }))
        .sort((a, b) => a.averagePosition - b.averagePosition);

      // Calculate sentiment trend over time
      const sentimentTrendMap = new Map();
      results.forEach(result => {
        const date = formatDate(new Date(result.createdAt));
        if (!sentimentTrendMap.has(date)) {
          sentimentTrendMap.set(date, { positive: 0, negative: 0, neutral: 0, total: 0 });
        }
        const trendData = sentimentTrendMap.get(date);

        result.sentimentAnalysis.brands.forEach(brand => {
          if (brand.mentioned && brand.type === 'own' && validBrandNames.has(brand.brandKeywords)) {
            trendData.total++;
            if (brand.sentiment === 'positive') trendData.positive++;
            else if (brand.sentiment === 'negative') trendData.negative++;
            else trendData.neutral++;
          }
        });
      });

      const sentimentTrend = Array.from(sentimentTrendMap.entries())
        .map(([date, data]) => ({
          date,
          positive: data.positive,
          negative: data.negative,
          neutral: data.neutral,
          positivePercentage: data.total > 0 ? (data.positive / data.total) * 100 : 0
        }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      // Calculate competitive breakdown
      const ownBrandPositivity = brandSentiments.find(b => b.brandType === 'own')?.positivePercentage || 0;
      const competitiveBreakdown = brandSentiments.map(brand => {
        const positionData = brandPositionAnalysis.find(p => p.brandName === brand.brandName && p.brandType === brand.brandType);
        return {
          brandName: brand.brandName,
          brandType: brand.brandType,
          sentimentGap: brand.positivePercentage - ownBrandPositivity,
          averagePosition: positionData?.averagePosition || 0,
          positivePercentage: brand.positivePercentage,
          mentionCount: brand.total
        };
      }).sort((a, b) => {
        // Sort own brand first, then by sentiment gap
        if (a.brandType === 'own') return -1;
        if (b.brandType === 'own') return 1;
        return b.sentimentGap - a.sentimentGap;
      });

      return {
        summary: {
          totalResults,
          resultsWithSentiment: results.length,
          dateRange: {
            start: formatDate(start),
            end: formatDate(end)
          },
          ownBrandMentionPercentage: totalResults > 0 ? (ownBrandMentions / totalResults) * 100 : 0,
          exclusivityRate
        },
        dailyMentions,
        brandSentiments,
        shareOfVoice,
        mentionsByModel,
        ownBrandPromptPerformance,
        competitorPromptPerformance,
        coMentionAnalysis,
        brandPositionAnalysis,
        sentimentTrend,
        competitiveBreakdown
      };

    } catch (error) {
      console.error('Error fetching analytics:', error);
      throw new Error(`Failed to fetch analytics: ${error.message}`);
    }
  }
};

module.exports = { typeDefs, resolvers }; 
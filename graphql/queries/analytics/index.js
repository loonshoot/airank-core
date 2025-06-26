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
  }

  type DateRange {
    start: String!
    end: String!
  }

  type AnalyticsData {
    summary: AnalyticsSummary!
    dailyMentions: [DailyMentions!]!
    brandSentiments: [BrandSentiment!]!
    shareOfVoice: [ShareOfVoice!]!
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
            ownBrandMentionPercentage: 0
          },
          dailyMentions: [],
          brandSentiments: [],
          shareOfVoice: []
        };
      }

      // Process data for analytics
      const dailyMentionsMap = new Map();
      const brandSentimentMap = new Map();
      const shareOfVoiceMap = new Map();
      let ownBrandMentions = 0;
      let totalResults = results.length;

      results.forEach(result => {
        const date = formatDate(new Date(result.createdAt));
        
        // Initialize daily mentions for this date
        if (!dailyMentionsMap.has(date)) {
          dailyMentionsMap.set(date, new Map());
        }
        
        result.sentimentAnalysis.brands.forEach(brand => {
          if (brand.mentioned) {
            const brandKey = `${brand.brandKeywords}-${brand.type}`;
            
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

      return {
        summary: {
          totalResults,
          resultsWithSentiment: results.length,
          dateRange: {
            start: formatDate(start),
            end: formatDate(end)
          },
          ownBrandMentionPercentage: totalResults > 0 ? (ownBrandMentions / totalResults) * 100 : 0
        },
        dailyMentions: dailyMentions.sort((a, b) => new Date(a.date) - new Date(b.date)),
        brandSentiments,
        shareOfVoice: shareOfVoice.sort((a, b) => b.mentionCount - a.mentionCount)
      };

    } catch (error) {
      console.error('Error fetching analytics:', error);
      throw new Error(`Failed to fetch analytics: ${error.message}`);
    }
  }
};

module.exports = { typeDefs, resolvers }; 
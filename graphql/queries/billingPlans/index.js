const { gql } = require('apollo-server-express');

const plans = [
  {
    id: 'free',
    name: 'Always Free',
    price: '$0',
    priceId: null,

    // Limits
    brandsLimit: 1,
    promptsLimit: 4,           // 4 queries/month
    modelsLimit: 1,            // Limited to 1 model
    batchFrequency: 'weekly',
    dataRetentionDays: 30,

    // Allowed models (only basic)
    allowedModels: ['gpt-4o-mini'],  // Just one basic model

    features: [
      '1 brand monitored',
      '4 queries per month',
      '1 AI model',
      'Weekly monitoring',
      '30-day data retention'
    ],

    // Metadata
    isFree: true,
    purpose: 'Customer acquisition funnel',
    costPerMonth: 0.001,
    conversionTarget: '10% to paid plans'
  },

  {
    id: 'small',
    name: 'Small',
    price: '$29',
    priceId: process.env.STRIPE_PRICE_ID_SMALL,
    priceIdAnnual: process.env.STRIPE_PRICE_ID_SMALL_ANNUAL, // $290/year

    // Limits
    brandsLimit: 4,            // 1 primary + 3 competitors
    promptsLimit: 10,          // 10 search phrases
    modelsLimit: 3,
    batchFrequency: 'daily',
    dataRetentionDays: 365,

    // Allowed models
    allowedModels: [
      'gpt-4o-mini',
      'claude-3-5-haiku',
      'gemini-1.5-flash'
    ],

    features: [
      '4 brands (1 primary + 3 competitors)',
      '10 search phrases',
      '3 AI models (GPT-4o-mini, Claude Haiku, Gemini Flash)',
      'Daily monitoring',
      '1-year data retention',
      'Annual: $290/year (save $58)'
    ],

    // Metadata
    target: 'Small businesses, freelancers',
    isPopular: true,
    annualPrice: '$290',
    annualSavings: 'Save 2 months'
  },

  {
    id: 'medium',
    name: 'Medium',
    price: '$149',
    priceId: process.env.STRIPE_PRICE_ID_MEDIUM,
    priceIdAnnual: process.env.STRIPE_PRICE_ID_MEDIUM_ANNUAL, // $1,490/year

    // Limits
    brandsLimit: 10,           // 1 primary + 9 competitors
    promptsLimit: 20,          // 20 search phrases
    modelsLimit: 6,
    batchFrequency: 'daily',
    dataRetentionDays: 730,    // 2 years

    // Allowed models (3 basic + 3 professional)
    allowedModels: [
      // Basic
      'gpt-4o-mini',
      'claude-3-5-haiku',
      'gemini-1.5-flash',
      // Professional
      'gpt-4o',
      'claude-3-5-sonnet',
      'gemini-1.5-pro'
    ],

    features: [
      '10 brands (1 primary + 9 competitors)',
      '20 search phrases',
      '6 AI models (3 basic + 3 professional)',
      'Daily monitoring',
      '2-year data retention',
      'Priority support',
      'Annual: $1,490/year (save $298)'
    ],

    // Metadata
    target: 'Growing businesses, agencies',
    annualPrice: '$1,490',
    annualSavings: 'Save 2 months'
  },

  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Starting at $1,000',
    priceId: null, // Custom pricing via quotes

    // Limits (unlimited)
    brandsLimit: -1,           // Custom competitors
    promptsLimit: -1,          // Custom phrases
    modelsLimit: -1,           // All models
    batchFrequency: 'custom',
    dataRetentionDays: -1,     // Unlimited retention

    // Allowed models (all including premium)
    allowedModels: ['*'],      // All models including o1, o1-pro, etc.

    features: [
      'Custom number of competitors',
      'Custom search phrases',
      'All available models including premium (o1, o1-pro)',
      'Custom monitoring frequency',
      'Unlimited data retention',
      'Custom integrations',
      'Dedicated account manager',
      'SLA guarantee',
      'Annual contracts: 20% discount',
      'Setup fee: $2,500 (waived with annual)'
    ],

    // Metadata
    isEnterprise: true,
    target: 'Large organizations',
    minimumPrice: 1000,
    setupFee: 2500,
    setupFeeWaivedAnnual: true,
    annualDiscount: 0.20,
    requiresQuote: true
  }
];

const typeDefs = gql`
  type BillingPlan {
    id: String!
    name: String!
    price: String!
    priceId: String
    priceIdAnnual: String
    annualPrice: String
    annualSavings: String

    # Limits
    brandsLimit: Int!
    promptsLimit: Int!
    modelsLimit: Int!
    batchFrequency: String!
    dataRetentionDays: Int!

    # Allowed models
    allowedModels: [String]!

    # Features list
    features: [String]!

    # Metadata
    isFree: Boolean
    isPopular: Boolean
    isEnterprise: Boolean
    target: String
    purpose: String
    costPerMonth: Float
    conversionTarget: String
    minimumPrice: Int
    setupFee: Int
    setupFeeWaivedAnnual: Boolean
    annualDiscount: Float
    requiresQuote: Boolean
  }

  extend type Query {
    billingPlans: [BillingPlan]
    billingPlan(id: String!): BillingPlan
  }
`;

const resolvers = {
  billingPlans: () => plans,
  billingPlan: (_, { id }) => plans.find(p => p.id === id)
};

module.exports = { typeDefs, resolvers, plans };

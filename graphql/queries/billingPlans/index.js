const { gql } = require('apollo-server-express');

// Initialize Stripe - use real key if available, otherwise create a mock for testing
let stripe;
const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.PAYMENTS_SECRET_KEY;
if (stripeKey && stripeKey !== 'sk_test' && stripeKey.startsWith('sk_')) {
  stripe = require('stripe')(stripeKey);
} else {
  // Mock Stripe for testing - returns sample plans
  stripe = {
    products: {
      list: async () => {
        console.log('  [Mock Stripe] Fetching products');
        return {
          data: [
            {
              id: 'prod_free',
              name: 'Always Free',
              description: '1 brand, 4 queries/month, 1 model, weekly monitoring',
              active: true,
              metadata: {
                plan_id: 'free',
                brands_limit: '1',
                prompts_limit: '4',
                models_limit: '1',
                batch_frequency: 'weekly',
                data_retention_days: '30',
                allowed_models: 'gpt-4o-mini',
                is_free: 'true',
                target: 'Customer acquisition funnel'
              },
              default_price: null
            },
            {
              id: 'prod_small',
              name: 'Small',
              description: '4 brands, 10 prompts, 3 models, daily monitoring',
              active: true,
              metadata: {
                plan_id: 'small',
                brands_limit: '4',
                prompts_limit: '10',
                models_limit: '3',
                batch_frequency: 'daily',
                data_retention_days: '365',
                allowed_models: 'gpt-4o-mini,claude-3-5-haiku,gemini-1.5-flash',
                is_popular: 'true',
                target: 'Small businesses, freelancers'
              },
              default_price: {
                id: 'price_small_monthly',
                unit_amount: 2900,
                currency: 'usd',
                recurring: { interval: 'month' },
                metadata: { interval_label: 'month' }
              }
            },
            {
              id: 'prod_medium',
              name: 'Medium',
              description: '10 brands, 20 prompts, 6 models, daily monitoring',
              active: true,
              metadata: {
                plan_id: 'medium',
                brands_limit: '10',
                prompts_limit: '20',
                models_limit: '6',
                batch_frequency: 'daily',
                data_retention_days: '730',
                allowed_models: 'gpt-4o-mini,claude-3-5-haiku,gemini-1.5-flash,gpt-4o,claude-3-5-sonnet,gemini-1.5-pro',
                target: 'Growing businesses, agencies'
              },
              default_price: {
                id: 'price_medium_monthly',
                unit_amount: 14900,
                currency: 'usd',
                recurring: { interval: 'month' },
                metadata: { interval_label: 'month' }
              }
            },
            {
              id: 'prod_enterprise',
              name: 'Enterprise',
              description: 'Custom everything - unlimited brands, prompts, all models',
              active: true,
              metadata: {
                plan_id: 'enterprise',
                brands_limit: '-1',
                prompts_limit: '-1',
                models_limit: '-1',
                batch_frequency: 'custom',
                data_retention_days: '-1',
                allowed_models: '*',
                is_enterprise: 'true',
                requires_quote: 'true',
                minimum_price: '1000',
                setup_fee: '2500',
                target: 'Large organizations'
              },
              default_price: null
            }
          ]
        };
      }
    },
    prices: {
      list: async ({ product }) => {
        console.log(`  [Mock Stripe] Fetching prices for product: ${product}`);
        // Return annual prices for small and medium plans
        if (product === 'prod_small') {
          return {
            data: [{
              id: 'price_small_annual',
              unit_amount: 29000, // $290/year
              currency: 'usd',
              recurring: { interval: 'year' }
            }]
          };
        }
        if (product === 'prod_medium') {
          return {
            data: [{
              id: 'price_medium_annual',
              unit_amount: 149000, // $1,490/year
              currency: 'usd',
              recurring: { interval: 'year' }
            }]
          };
        }
        // Free and enterprise have no additional prices
        return { data: [] };
      }
    }
  };
}

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

/**
 * Convert Stripe product to BillingPlan format
 */
function stripeProductToPlan(product, prices = []) {
  const meta = product.metadata || {};

  // Parse limits from metadata
  const brandsLimit = parseInt(meta.brands_limit || '1', 10);
  const promptsLimit = parseInt(meta.prompts_limit || '4', 10);
  const modelsLimit = parseInt(meta.models_limit || '1', 10);
  const dataRetentionDays = parseInt(meta.data_retention_days || '30', 10);

  // Parse allowed models
  const allowedModelsStr = meta.allowed_models || '';
  const allowedModels = allowedModelsStr === '*' ? ['*'] : allowedModelsStr.split(',').filter(Boolean);

  // Find monthly and annual prices
  const monthlyPrice = prices.find(p => p.recurring?.interval === 'month') || product.default_price;
  const annualPrice = prices.find(p => p.recurring?.interval === 'year');

  // Format price display
  let priceDisplay = '$0';
  let priceId = null;
  let priceIdAnnual = null;
  let annualPriceDisplay = null;
  let annualSavings = null;

  if (monthlyPrice && monthlyPrice.unit_amount) {
    priceDisplay = `$${(monthlyPrice.unit_amount / 100).toFixed(0)}`;
    priceId = monthlyPrice.id;
  }

  if (annualPrice && annualPrice.unit_amount) {
    annualPriceDisplay = `$${(annualPrice.unit_amount / 100).toFixed(0)}`;
    priceIdAnnual = annualPrice.id;

    // Calculate savings
    if (monthlyPrice && monthlyPrice.unit_amount) {
      const monthlyCost = monthlyPrice.unit_amount * 12;
      const savings = monthlyCost - annualPrice.unit_amount;
      if (savings > 0) {
        annualSavings = `Save $${(savings / 100).toFixed(0)}`;
      }
    }
  }

  if (meta.is_enterprise === 'true') {
    priceDisplay = `Starting at $${meta.minimum_price || '1,000'}`;
  }

  // Build features list from description and metadata
  const features = [];
  if (meta.brands_limit) {
    const limit = brandsLimit === -1 ? 'Unlimited' : brandsLimit;
    features.push(`${limit} brand${brandsLimit !== 1 ? 's' : ''} monitored`);
  }
  if (meta.prompts_limit) {
    const limit = promptsLimit === -1 ? 'Unlimited' : promptsLimit;
    features.push(`${limit} search phrase${promptsLimit !== 1 ? 's' : ''}`);
  }
  if (meta.models_limit) {
    const limit = modelsLimit === -1 ? 'All' : modelsLimit;
    features.push(`${limit} AI model${modelsLimit !== 1 ? 's' : ''}`);
  }
  if (meta.batch_frequency) {
    const freq = meta.batch_frequency.charAt(0).toUpperCase() + meta.batch_frequency.slice(1);
    features.push(`${freq} monitoring`);
  }

  return {
    id: meta.plan_id || product.id,
    name: product.name,
    price: priceDisplay,
    priceId,
    priceIdAnnual,
    annualPrice: annualPriceDisplay,
    annualSavings,

    // Limits
    brandsLimit,
    promptsLimit,
    modelsLimit,
    batchFrequency: meta.batch_frequency || 'weekly',
    dataRetentionDays,

    // Allowed models
    allowedModels,

    // Features
    features,

    // Metadata
    isFree: meta.is_free === 'true',
    isPopular: meta.is_popular === 'true',
    isEnterprise: meta.is_enterprise === 'true',
    target: meta.target,
    purpose: meta.purpose,
    costPerMonth: monthlyPrice?.unit_amount ? monthlyPrice.unit_amount / 100 : 0,
    conversionTarget: meta.conversion_target,
    minimumPrice: meta.minimum_price ? parseInt(meta.minimum_price, 10) : null,
    setupFee: meta.setup_fee ? parseInt(meta.setup_fee, 10) : null,
    setupFeeWaivedAnnual: meta.setup_fee_waived_annual === 'true',
    annualDiscount: meta.annual_discount ? parseFloat(meta.annual_discount) : null,
    requiresQuote: meta.requires_quote === 'true'
  };
}

const resolvers = {
  billingPlans: async () => {
    try {
      // Fetch all active products from Stripe with prices expanded
      const products = await stripe.products.list({
        active: true,
        expand: ['data.default_price']
      });

      console.log(`Found ${products.data.length} products in Stripe`);

      if (products.data.length === 0) {
        console.warn('No products found in Stripe. Run setup-stripe-products.js to create them.');
        return [];
      }

      // Convert each product to plan format
      const plans = await Promise.all(
        products.data.map(async (product) => {
          // Fetch all prices for this product
          const prices = await stripe.prices.list({
            product: product.id,
            active: true
          });

          return stripeProductToPlan(product, prices.data);
        })
      );

      // Deduplicate plans by plan_id (in case there are multiple products with same plan_id)
      const uniquePlans = [];
      const seenPlanIds = new Set();

      for (const plan of plans) {
        if (!seenPlanIds.has(plan.id)) {
          seenPlanIds.add(plan.id);
          uniquePlans.push(plan);
        }
      }

      // Sort: free first, then by price
      return uniquePlans.sort((a, b) => {
        if (a.isFree) return -1;
        if (b.isFree) return 1;
        if (a.isEnterprise) return 1;
        if (b.isEnterprise) return -1;
        return a.costPerMonth - b.costPerMonth;
      });
    } catch (error) {
      console.error('Error fetching plans from Stripe:', error);
      console.error('Error details:', error.message, error.stack);
      throw new Error(`Failed to fetch billing plans: ${error.message}`);
    }
  },

  billingPlan: async (_, { id }) => {
    try {
      const allPlans = await resolvers.billingPlans();
      return allPlans.find(p => p.id === id) || null;
    } catch (error) {
      console.error('Error fetching plan from Stripe:', error);
      throw new Error('Failed to fetch billing plan');
    }
  }
};

module.exports = { typeDefs, resolvers };

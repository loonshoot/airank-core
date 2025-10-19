#!/usr/bin/env node

/**
 * Script to create Stripe products and prices for AIRank billing plans
 * Run this once to set up your Stripe account with the correct products
 *
 * Usage: node scripts/setup-stripe-products.js
 */

require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || process.env.PAYMENTS_SECRET_KEY);

// Define the plans to create
const plans = [
  {
    name: 'Always Free',
    description: 'Fixed model (GPT-4o-mini), 1 brand, 4 queries/month',
    metadata: {
      plan_id: 'free',
      brands_limit: '1',
      prompts_limit: '4',
      prompt_character_limit: '150',
      models_limit: '1',
      models_selectable: '0', // No selection, fixed model
      batch_frequency: 'monthly',
      data_retention_days: '30',
      allowed_models: 'gpt-4o-mini-2024-07-18',
      cost_budget_monthly: '0',
      is_free: 'true',
      target: 'Customer acquisition funnel',
      custom_features: 'Monitor your brand,Monitor ChatGPT,4 prompts/month,Monthly monitoring,30-day data retention'
    },
    prices: [] // Free plan has no prices
  },
  {
    name: 'Small',
    description: 'Select 3 models, 4 brands, 10 prompts/month, daily monitoring',
    metadata: {
      plan_id: 'small',
      brands_limit: '4',
      prompts_limit: '10',
      prompt_character_limit: '150',
      models_limit: '3',
      models_selectable: '3', // Must select exactly 3
      batch_frequency: 'daily',
      data_retention_days: '90',
      allowed_models: 'gpt-4o-mini-2024-07-18,claude-3-5-haiku-20241022,gemini-2.5-flash,gpt-4o-2024-08-06,claude-3-5-sonnet-20241022,gemini-2.5-pro',
      cost_budget_monthly: '5.00',
      max_professional_models: '1',
      selection_rule: 'Maximum 1 Professional tier model',
      target: 'Small businesses, freelancers',
      custom_features: 'Monitor your brand,Monitor 3 competitors,Monitor Standard Models,10 prompts/month,Daily monitoring,90-day data retention'
    },
    prices: [
      {
        currency: 'usd',
        unit_amount: 2900, // $29/month
        recurring: { interval: 'month' }
      },
      {
        currency: 'usd',
        unit_amount: 29000, // $290/year (save $58)
        recurring: { interval: 'year' }
      }
    ]
  },
  {
    name: 'Medium',
    description: 'Select 6 models, 10 brands, 20 prompts/month, daily monitoring',
    metadata: {
      plan_id: 'medium',
      brands_limit: '10',
      prompts_limit: '20',
      prompt_character_limit: '150',
      models_limit: '6',
      models_selectable: '6', // Must select exactly 6
      batch_frequency: 'daily',
      data_retention_days: '180',
      allowed_models: 'gpt-4o-mini-2024-07-18,claude-3-5-haiku-20241022,gemini-2.5-flash,gpt-4o-2024-08-06,claude-3-5-sonnet-20241022,gemini-2.5-pro,gpt-4.1-2025-04-14,claude-haiku-4-5,claude-3-opus-20240229,gemini-2.5-flash-lite',
      cost_budget_monthly: '60.00',
      max_expensive_premium: '1',
      max_cheap_premium: '2',
      selection_rule: 'Max 1 expensive Premium (GPT-4.1 OR Claude Opus) OR max 2 cheap Premium (Haiku 4.5 + Flash-Lite)',
      expensive_premium_models: 'gpt-4.1-2025-04-14,claude-3-opus-20240229',
      cheap_premium_models: 'claude-haiku-4-5,gemini-2.5-flash-lite',
      is_popular: 'true',
      target: 'Growing businesses, agencies',
      custom_features: 'Monitor your brand,Monitor 9 competitors,Monitor Advanced Models,20 prompts/month,Daily monitoring,180-day data retention'
    },
    prices: [
      {
        currency: 'usd',
        unit_amount: 14900, // $149/month
        recurring: { interval: 'month' }
      },
      {
        currency: 'usd',
        unit_amount: 149000, // $1,490/year (save $298)
        recurring: { interval: 'year' }
      }
    ]
  },
  {
    name: 'Enterprise',
    description: 'All models available, unlimited selection, unlimited brands & prompts',
    metadata: {
      plan_id: 'enterprise',
      brands_limit: '-1',
      prompts_limit: '-1',
      prompt_character_limit: '150',
      models_limit: '-1',
      models_selectable: '-1', // Unlimited
      batch_frequency: 'custom',
      data_retention_days: '-1',
      allowed_models: 'gpt-4o-mini-2024-07-18,claude-3-5-haiku-20241022,gemini-2.5-flash,gpt-4o-2024-08-06,claude-3-5-sonnet-20241022,gemini-2.5-pro,gpt-4.1-2025-04-14,claude-haiku-4-5,claude-3-opus-20240229,gemini-2.5-flash-lite,gpt-4-turbo-2024-04-09,gpt-4.1-mini-2025-04-14,gemini-2.0-flash',
      cost_budget_monthly: '-1',
      selection_rule: 'No limits',
      is_enterprise: 'true',
      requires_quote: 'true',
      minimum_price: '1000',
      setup_fee: '2500',
      target: 'Large organizations',
      custom_features: 'Monitor your brand,Monitor unlimited competitors,Monitor ANY Model,Unlimited prompts,Custom monitoring frequency,Custom integrations,Dedicated account manager,SLA guarantee'
    },
    prices: [] // Enterprise requires custom quotes
  }
];

async function setupStripeProducts() {
  console.log('🚀 Setting up Stripe products for AIRank...\n');

  try {
    for (const planConfig of plans) {
      console.log(`Creating product: ${planConfig.name}`);

      // Create the product
      const product = await stripe.products.create({
        name: planConfig.name,
        description: planConfig.description,
        metadata: planConfig.metadata
      });

      console.log(`  ✓ Product created: ${product.id}`);

      // Create prices for this product
      if (planConfig.prices.length > 0) {
        for (const priceConfig of planConfig.prices) {
          const price = await stripe.prices.create({
            product: product.id,
            ...priceConfig
          });

          const amount = priceConfig.unit_amount / 100;
          const interval = priceConfig.recurring.interval;
          console.log(`  ✓ Price created: ${price.id} ($${amount}/${interval})`);
        }
      } else {
        console.log(`  ℹ No prices (${planConfig.metadata.is_free ? 'free plan' : 'custom pricing'})`);
      }

      console.log('');
    }

    console.log('✅ All Stripe products created successfully!');
    console.log('\nYou can view them at: https://dashboard.stripe.com/test/products');
  } catch (error) {
    console.error('❌ Error creating Stripe products:', error.message);
    process.exit(1);
  }
}

// Run the setup
setupStripeProducts();

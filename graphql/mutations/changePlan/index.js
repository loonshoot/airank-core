const { gql } = require('apollo-server-express');
const mongoose = require('mongoose');
const { BillingProfile, BillingProfileMember } = require('../../queries/billingProfile');

// Initialize Stripe - use real key if available, otherwise mock
let stripe;
const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.PAYMENTS_SECRET_KEY;
if (stripeKey && stripeKey !== 'sk_test' && stripeKey.startsWith('sk_')) {
  stripe = require('stripe')(stripeKey);
  console.log('✓ Using real Stripe API');
} else {
  console.log('⚠️  Using mock Stripe (no valid API key found)');
  // Mock Stripe for testing
  stripe = {
    subscriptions: {
      retrieve: async (subscriptionId) => ({
        id: subscriptionId,
        items: {
          data: [{
            id: 'si_test_123',
            price: { id: 'price_old' }
          }]
        }
      }),
      update: async (subscriptionId, params) => ({
        id: subscriptionId,
        ...params
      })
    },
    products: {
      list: async ({ active }) => ({
        data: [
          {
            id: 'prod_free',
            name: 'Always Free',
            metadata: {
              plan_id: 'free',
              brands_limit: '1',
              prompts_limit: '4',
              models_limit: '1',
              data_retention_days: '30',
              allowed_models: 'gpt-4o-mini',
              batch_frequency: 'weekly'
            }
          },
          {
            id: 'prod_small',
            name: 'Small',
            metadata: {
              plan_id: 'small',
              brands_limit: '4',
              prompts_limit: '10',
              models_limit: '3',
              data_retention_days: '90',
              allowed_models: 'gpt-4o-mini,gpt-4o,claude-3-5-sonnet',
              batch_frequency: 'daily'
            }
          },
          {
            id: 'prod_medium',
            name: 'Medium',
            metadata: {
              plan_id: 'medium',
              brands_limit: '10',
              prompts_limit: '20',
              models_limit: '6',
              data_retention_days: '180',
              allowed_models: 'gpt-4o-mini,gpt-4o,claude-3-5-sonnet,claude-3-opus,gemini-pro,llama-3',
              batch_frequency: 'daily'
            }
          },
          {
            id: 'prod_enterprise',
            name: 'Enterprise',
            metadata: {
              plan_id: 'enterprise',
              brands_limit: 'unlimited',
              prompts_limit: 'unlimited',
              models_limit: 'unlimited',
              data_retention_days: 'unlimited',
              allowed_models: 'all',
              batch_frequency: 'custom'
            }
          }
        ]
      })
    },
    prices: {
      list: async ({ product }) => {
        const priceMap = {
          prod_small: [
            { id: 'price_small_monthly', unit_amount: 2900, recurring: { interval: 'month' } },
            { id: 'price_small_annual', unit_amount: 29000, recurring: { interval: 'year' } }
          ],
          prod_medium: [
            { id: 'price_medium_monthly', unit_amount: 14900, recurring: { interval: 'month' } },
            { id: 'price_medium_annual', unit_amount: 149000, recurring: { interval: 'year' } }
          ],
          prod_enterprise: [
            { id: 'price_enterprise_custom', unit_amount: null, recurring: null }
          ]
        };
        return { data: priceMap[product] || [] };
      }
    }
  };
}

const typeDefs = gql`
  extend type Mutation {
    changePlan(
      billingProfileId: ID!
      newPlanId: String!
      interval: String!
    ): BillingProfile
  }
`;

const resolvers = {
  changePlan: async (parent, { billingProfileId, newPlanId, interval }, { user }) => {
    if (!user) {
      throw new Error('Authentication required');
    }

    // Check user is manager of billing profile
    const billingMember = await BillingProfileMember().findOne({
      billingProfileId,
      userId: user.sub || user._id,
      role: 'manager'
    });

    if (!billingMember) {
      throw new Error('Only billing profile managers can change plans');
    }

    // Get billing profile
    const billingProfile = await BillingProfile().findById(billingProfileId);
    if (!billingProfile) {
      throw new Error('Billing profile not found');
    }

    if (!billingProfile.stripeSubscriptionId) {
      throw new Error('No subscription found for this billing profile');
    }

    // Validate new plan exists by querying Stripe products
    const products = await stripe.products.list({ active: true });
    const product = products.data.find(p => p.metadata.plan_id === newPlanId);

    if (!product) {
      throw new Error(`Invalid plan ID: ${newPlanId}`);
    }

    // Get price for the new plan and interval
    const prices = await stripe.prices.list({ product: product.id });
    const price = prices.data.find(p =>
      p.recurring && p.recurring.interval === (interval === 'annual' ? 'year' : 'month')
    );

    if (!price) {
      throw new Error(`No ${interval} pricing found for plan ${newPlanId}`);
    }

    // Retrieve current subscription
    const subscription = await stripe.subscriptions.retrieve(billingProfile.stripeSubscriptionId);

    // Update subscription with new price
    await stripe.subscriptions.update(billingProfile.stripeSubscriptionId, {
      items: [{
        id: subscription.items.data[0].id,
        price: price.id
      }],
      proration_behavior: 'create_prorations'
    });

    // Update billing profile with new plan details
    billingProfile.currentPlan = newPlanId;

    // Update plan limits from product metadata
    const meta = product.metadata;
    billingProfile.brandsLimit = meta.brands_limit === 'unlimited' ? 999999 : parseInt(meta.brands_limit);
    billingProfile.promptsLimit = meta.prompts_limit === 'unlimited' ? 999999 : parseInt(meta.prompts_limit);
    billingProfile.modelsLimit = meta.models_limit === 'unlimited' ? 999999 : parseInt(meta.models_limit);
    billingProfile.dataRetentionDays = meta.data_retention_days === 'unlimited' ? 999999 : parseInt(meta.data_retention_days);

    billingProfile.updatedAt = new Date();
    await billingProfile.save();

    return billingProfile;
  }
};

module.exports = { typeDefs, resolvers };

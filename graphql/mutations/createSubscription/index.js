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
    customers: {
      create: async ({ name, email, metadata }) => ({
        id: `cus_test_${Date.now()}`,
        name,
        email,
        metadata
      })
    },
    subscriptions: {
      create: async ({ customer, items, payment_behavior, metadata }) => ({
        id: `sub_test_${Date.now()}`,
        customer,
        items,
        status: 'incomplete',
        latest_invoice: {
          payment_intent: {
            client_secret: `pi_test_secret_${Date.now()}`
          }
        },
        metadata
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
  type SubscriptionResult {
    billingProfile: BillingProfile!
    stripeSubscriptionId: String!
    clientSecret: String
  }

  extend type Mutation {
    createSubscription(
      billingProfileId: ID!
      planId: String!
      interval: String!
    ): SubscriptionResult
  }
`;

const resolvers = {
  createSubscription: async (parent, { billingProfileId, planId, interval }, { user }) => {
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
      throw new Error('Only billing profile managers can create subscriptions');
    }

    // Get billing profile
    const billingProfile = await BillingProfile().findById(billingProfileId);
    if (!billingProfile) {
      throw new Error('Billing profile not found');
    }

    // Validate plan exists by querying Stripe products
    const products = await stripe.products.list({ active: true });
    const product = products.data.find(p => p.metadata.plan_id === planId);

    if (!product) {
      throw new Error(`Invalid plan ID: ${planId}`);
    }

    // Get price for the plan and interval
    const prices = await stripe.prices.list({ product: product.id });
    const price = prices.data.find(p =>
      p.recurring && p.recurring.interval === (interval === 'annual' ? 'year' : 'month')
    );

    if (!price) {
      throw new Error(`No ${interval} pricing found for plan ${planId}`);
    }

    // Create or get Stripe customer
    let customerId = billingProfile.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: billingProfile.name,
        email: user.email,
        metadata: {
          billingProfileId: billingProfile._id.toString()
        }
      });
      customerId = customer.id;
      billingProfile.stripeCustomerId = customerId;
    }

    // Create subscription
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: price.id }],
      payment_behavior: 'default_incomplete',
      metadata: {
        billingProfileId: billingProfile._id.toString(),
        planId
      }
    });

    // Update billing profile with subscription details
    billingProfile.stripeSubscriptionId = subscription.id;
    billingProfile.currentPlan = planId;
    billingProfile.planStatus = subscription.status;

    // Update plan limits from product metadata
    const meta = product.metadata;
    billingProfile.brandsLimit = meta.brands_limit === 'unlimited' ? 999999 : parseInt(meta.brands_limit);
    billingProfile.promptsLimit = meta.prompts_limit === 'unlimited' ? 999999 : parseInt(meta.prompts_limit);
    billingProfile.modelsLimit = meta.models_limit === 'unlimited' ? 999999 : parseInt(meta.models_limit);
    billingProfile.dataRetentionDays = meta.data_retention_days === 'unlimited' ? 999999 : parseInt(meta.data_retention_days);

    billingProfile.updatedAt = new Date();
    await billingProfile.save();

    // Extract client secret for payment confirmation
    const clientSecret = subscription.latest_invoice?.payment_intent?.client_secret;

    return {
      billingProfile,
      stripeSubscriptionId: subscription.id,
      clientSecret
    };
  }
};

module.exports = { typeDefs, resolvers };

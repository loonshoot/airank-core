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
    paymentMethods: {
      retrieve: async (paymentMethodId) => {
        // Mock payment method details based on ID
        const brandMap = {
          pm_test_visa_4242: { brand: 'visa', last4: '4242' },
          pm_test_mastercard_5555: { brand: 'mastercard', last4: '5555' },
          pm_test_amex_3782: { brand: 'amex', last4: '3782' }
        };
        const mockCard = brandMap[paymentMethodId] || { brand: 'visa', last4: '4242' };

        return {
          id: paymentMethodId,
          card: {
            brand: mockCard.brand,
            last4: mockCard.last4,
            exp_month: 12,
            exp_year: 2025
          }
        };
      },
      attach: async (paymentMethodId, { customer }) => ({
        id: paymentMethodId,
        customer
      })
    },
    customers: {
      update: async (customerId, params) => ({
        id: customerId,
        ...params
      })
    }
  };
}

const typeDefs = gql`
  extend type Mutation {
    savePaymentMethod(
      billingProfileId: ID!
      paymentMethodId: String!
    ): BillingProfile
  }
`;

const resolvers = {
  savePaymentMethod: async (parent, { billingProfileId, paymentMethodId }, { user }) => {
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
      throw new Error('Only billing profile managers can manage payment methods');
    }

    // Get billing profile
    const billingProfile = await BillingProfile().findById(billingProfileId);
    if (!billingProfile) {
      throw new Error('Billing profile not found');
    }

    if (!billingProfile.stripeCustomerId) {
      throw new Error('No Stripe customer found for this billing profile');
    }

    // Retrieve payment method details from Stripe
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

    // Attach payment method to customer
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: billingProfile.stripeCustomerId
    });

    // Set as default payment method
    await stripe.customers.update(billingProfile.stripeCustomerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId
      }
    });

    // Update billing profile with payment method details
    billingProfile.defaultPaymentMethodId = paymentMethodId;
    billingProfile.hasPaymentMethod = true;
    billingProfile.paymentMethodLast4 = paymentMethod.card.last4;
    billingProfile.paymentMethodBrand = paymentMethod.card.brand;
    billingProfile.paymentMethodExpMonth = paymentMethod.card.exp_month;
    billingProfile.paymentMethodExpYear = paymentMethod.card.exp_year;
    billingProfile.updatedAt = new Date();

    await billingProfile.save();

    return billingProfile;
  }
};

module.exports = { typeDefs, resolvers };

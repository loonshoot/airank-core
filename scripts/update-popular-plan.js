#!/usr/bin/env node

/**
 * Script to update which plan is marked as popular
 * Changes Small -> not popular, Medium -> popular
 */

require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || process.env.PAYMENTS_SECRET_KEY);

async function updatePopularPlan() {
  console.log('🔄 Updating popular plan metadata...\n');

  try {
    // Get all products
    const products = await stripe.products.list({ active: true });

    for (const product of products.data) {
      const planId = product.metadata?.plan_id;

      if (planId === 'small' && product.metadata.is_popular === 'true') {
        // Remove is_popular from Small
        console.log(`Removing is_popular from Small plan (${product.id})`);
        await stripe.products.update(product.id, {
          metadata: {
            ...product.metadata,
            is_popular: 'false'
          }
        });
        console.log('  ✓ Updated\n');
      } else if (planId === 'medium' && product.metadata.is_popular !== 'true') {
        // Add is_popular to Medium
        console.log(`Adding is_popular to Medium plan (${product.id})`);
        await stripe.products.update(product.id, {
          metadata: {
            ...product.metadata,
            is_popular: 'true'
          }
        });
        console.log('  ✓ Updated\n');
      }
    }

    console.log('✅ Popular plan updated successfully!');
  } catch (error) {
    console.error('❌ Error updating popular plan:', error.message);
    process.exit(1);
  }
}

updatePopularPlan();

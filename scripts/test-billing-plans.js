#!/usr/bin/env node

require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || process.env.PAYMENTS_SECRET_KEY);

async function testBillingPlans() {
  console.log('Testing billing plans query...\n');

  try {
    // Fetch all active products from Stripe with prices expanded
    const products = await stripe.products.list({
      active: true,
      expand: ['data.default_price']
    });

    console.log(`✓ Found ${products.data.length} products\n`);

    for (const product of products.data) {
      console.log(`Product: ${product.name} (${product.id})`);
      console.log(`  Metadata:`, product.metadata);
      console.log(`  Default Price:`, product.default_price);

      // Fetch all prices for this product
      const prices = await stripe.prices.list({
        product: product.id,
        active: true
      });

      console.log(`  Prices: ${prices.data.length}`);
      prices.data.forEach(price => {
        console.log(`    - ${price.id}: $${price.unit_amount / 100} ${price.recurring?.interval || 'one-time'}`);
      });
      console.log('');
    }

    console.log('✅ Test completed successfully!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testBillingPlans();

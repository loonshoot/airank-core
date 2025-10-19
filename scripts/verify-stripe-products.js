require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || process.env.PAYMENTS_SECRET_KEY);

async function verifyStripeProducts() {
  console.log('🔍 Verifying Stripe products...\n');

  try {
    // List only active products
    const activeProducts = await stripe.products.list({ active: true, limit: 100 });

    console.log(`Active products: ${activeProducts.data.length}\n`);

    console.log('=== Active Products ===');
    for (const product of activeProducts.data) {
      const createdDate = new Date(product.created * 1000).toISOString();
      console.log(`\n${product.name} (${product.id})`);
      console.log(`  Description: ${product.description}`);
      console.log(`  Created: ${createdDate}`);

      // Get prices for this product
      const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
      console.log(`  Active prices: ${prices.data.length}`);
      prices.data.forEach(price => {
        const amount = price.unit_amount / 100;
        const interval = price.recurring ? price.recurring.interval : 'one-time';
        console.log(`    - ${price.id}: $${amount}/${interval}`);
      });

      // Show metadata
      if (Object.keys(product.metadata).length > 0) {
        console.log('  Metadata:');
        console.log(`    Plan ID: ${product.metadata.plan_id}`);
        console.log(`    Models Limit: ${product.metadata.models_limit}`);
        console.log(`    Models Selectable: ${product.metadata.models_selectable}`);
        console.log(`    Cost Budget: $${product.metadata.cost_budget_monthly}`);
      }
    }

    console.log('\n✅ Verification complete!');
    console.log(`\nYou should have exactly 4 active products: Always Free, Small, Medium, Enterprise`);
    console.log(`Actual count: ${activeProducts.data.length}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

verifyStripeProducts();

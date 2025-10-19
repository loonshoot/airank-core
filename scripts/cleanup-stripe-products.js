require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || process.env.PAYMENTS_SECRET_KEY);

async function cleanupStripeProducts() {
  console.log('🔍 Fetching all Stripe products...\n');

  try {
    // List all products
    const products = await stripe.products.list({ limit: 100 });

    console.log(`Found ${products.data.length} products\n`);

    // Group products by name
    const productsByName = {};
    products.data.forEach(product => {
      const name = product.name;
      if (!productsByName[name]) {
        productsByName[name] = [];
      }
      productsByName[name].push(product);
    });

    // Expected plan names
    const expectedPlans = ['Always Free', 'Small', 'Medium', 'Enterprise'];

    console.log('=== Products by Name ===');
    Object.keys(productsByName).forEach(name => {
      console.log(`${name}: ${productsByName[name].length} product(s)`);
      productsByName[name].forEach(p => {
        const createdDate = new Date(p.created * 1000).toISOString();
        console.log(`  - ${p.id} (created: ${createdDate})`);
      });
    });

    console.log('\n=== Cleanup Plan ===');

    const toDelete = [];
    const toKeep = [];

    // For each expected plan, keep only the most recent one
    expectedPlans.forEach(planName => {
      const planProducts = productsByName[planName] || [];

      if (planProducts.length === 0) {
        console.log(`⚠️  ${planName}: No products found - will need to create`);
      } else if (planProducts.length === 1) {
        console.log(`✓ ${planName}: 1 product - keeping ${planProducts[0].id}`);
        toKeep.push(planProducts[0]);
      } else {
        // Sort by creation date (most recent first)
        planProducts.sort((a, b) => b.created - a.created);
        const keep = planProducts[0];
        const remove = planProducts.slice(1);

        console.log(`🔧 ${planName}: ${planProducts.length} products - keeping ${keep.id}, deleting ${remove.length}`);
        toKeep.push(keep);
        toDelete.push(...remove);
      }
    });

    // Delete any products not in expected plans
    Object.keys(productsByName).forEach(name => {
      if (!expectedPlans.includes(name)) {
        console.log(`❌ "${name}": Not an expected plan - marking all for deletion`);
        toDelete.push(...productsByName[name]);
      }
    });

    console.log(`\nSummary: Keeping ${toKeep.length}, Deleting ${toDelete.length}`);

    if (toDelete.length === 0) {
      console.log('\n✅ No cleanup needed!');
      return;
    }

    // Confirm deletion
    console.log('\n⚠️  About to delete the following products:');
    toDelete.forEach(p => {
      console.log(`   - ${p.id}: ${p.name}`);
    });

    console.log('\nProceeding with deletion in 2 seconds...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Delete products
    console.log('\n🗑️  Deleting products...\n');
    for (const product of toDelete) {
      try {
        // First, archive ALL prices for this product (including inactive ones)
        const prices = await stripe.prices.list({ product: product.id, limit: 100 });
        console.log(`  Product ${product.id}: Found ${prices.data.length} price(s)`);

        for (const price of prices.data) {
          try {
            if (price.active) {
              await stripe.prices.update(price.id, { active: false });
              console.log(`    ✓ Archived price ${price.id}`);
            } else {
              console.log(`    - Price ${price.id} already inactive`);
            }
          } catch (priceError) {
            console.error(`    ✗ Error archiving price ${price.id}: ${priceError.message}`);
          }
        }

        // Try to delete the product
        try {
          await stripe.products.del(product.id);
          console.log(`  ✓ Deleted product ${product.id}: ${product.name}`);
        } catch (deleteError) {
          // If deletion fails (user-created prices), archive instead
          if (deleteError.message.includes('user-created prices')) {
            await stripe.products.update(product.id, { active: false });
            console.log(`  ✓ Archived product ${product.id}: ${product.name} (has user-created prices)`);
          } else {
            throw deleteError;
          }
        }
      } catch (error) {
        console.error(`  ✗ Error processing ${product.id}: ${error.message}`);
      }
    }

    console.log('\n✅ Cleanup complete!');
    console.log('\nRemaining products:');
    toKeep.forEach(p => {
      console.log(`  - ${p.name}: ${p.id}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

cleanupStripeProducts();

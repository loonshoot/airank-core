/**
 * Test for BillingPlans GraphQL query
 *
 * This test will:
 * 1. Query all billing plans
 * 2. Verify we have all 4 plans (free, small, medium, enterprise)
 * 3. Verify plan structure and limits
 * 4. Query specific plan by ID
 * 5. Verify pricing and features
 */

const { resolvers, plans } = require('./index');

async function runTest() {
  console.log('🧪 Testing BillingPlans GraphQL query...\n');

  try {
    // Test 1: Query all billing plans
    console.log('Test 1: Query all billing plans');
    const allPlans = await resolvers.billingPlans();

    if (!allPlans || allPlans.length !== 4) {
      throw new Error(`❌ Expected 4 plans, got ${allPlans?.length || 0}`);
    }
    console.log(`✓ Found ${allPlans.length} plans\n`);

    // Test 2: Verify plan IDs
    console.log('Test 2: Verify plan IDs');
    const expectedIds = ['free', 'small', 'medium', 'enterprise'];
    const actualIds = allPlans.map(p => p.id);

    for (const expectedId of expectedIds) {
      if (!actualIds.includes(expectedId)) {
        throw new Error(`❌ Missing expected plan: ${expectedId}`);
      }
    }
    console.log(`✓ All expected plan IDs found: ${actualIds.join(', ')}\n`);

    // Test 3: Verify Free plan structure
    console.log('Test 3: Verify Free plan structure');
    const freePlan = allPlans.find(p => p.id === 'free');

    if (freePlan.brandsLimit !== 1) {
      throw new Error(`❌ Free plan: Expected brandsLimit=1, got ${freePlan.brandsLimit}`);
    }
    if (freePlan.promptsLimit !== 4) {
      throw new Error(`❌ Free plan: Expected promptsLimit=4, got ${freePlan.promptsLimit}`);
    }
    if (freePlan.modelsLimit !== 1) {
      throw new Error(`❌ Free plan: Expected modelsLimit=1, got ${freePlan.modelsLimit}`);
    }
    if (!freePlan.isFree) {
      throw new Error('❌ Free plan: Expected isFree=true');
    }
    if (freePlan.price !== '$0') {
      throw new Error(`❌ Free plan: Expected price=$0, got ${freePlan.price}`);
    }
    console.log(`✓ Free plan limits correct: ${freePlan.brandsLimit} brands, ${freePlan.promptsLimit} prompts, ${freePlan.modelsLimit} model\n`);

    // Test 4: Verify Small plan structure
    console.log('Test 4: Verify Small plan structure');
    const smallPlan = allPlans.find(p => p.id === 'small');

    if (smallPlan.brandsLimit !== 4) {
      throw new Error(`❌ Small plan: Expected brandsLimit=4, got ${smallPlan.brandsLimit}`);
    }
    if (smallPlan.promptsLimit !== 10) {
      throw new Error(`❌ Small plan: Expected promptsLimit=10, got ${smallPlan.promptsLimit}`);
    }
    if (smallPlan.modelsLimit !== 3) {
      throw new Error(`❌ Small plan: Expected modelsLimit=3, got ${smallPlan.modelsLimit}`);
    }
    if (smallPlan.price !== '$29') {
      throw new Error(`❌ Small plan: Expected price=$29, got ${smallPlan.price}`);
    }
    if (!smallPlan.isPopular) {
      throw new Error('❌ Small plan: Expected isPopular=true');
    }
    if (!smallPlan.annualPrice) {
      throw new Error('❌ Small plan: Missing annualPrice');
    }
    console.log(`✓ Small plan correct: ${smallPlan.price}/month or ${smallPlan.annualPrice}/year\n`);

    // Test 5: Verify Medium plan structure
    console.log('Test 5: Verify Medium plan structure');
    const mediumPlan = allPlans.find(p => p.id === 'medium');

    if (mediumPlan.brandsLimit !== 10) {
      throw new Error(`❌ Medium plan: Expected brandsLimit=10, got ${mediumPlan.brandsLimit}`);
    }
    if (mediumPlan.promptsLimit !== 20) {
      throw new Error(`❌ Medium plan: Expected promptsLimit=20, got ${mediumPlan.promptsLimit}`);
    }
    if (mediumPlan.modelsLimit !== 6) {
      throw new Error(`❌ Medium plan: Expected modelsLimit=6, got ${mediumPlan.modelsLimit}`);
    }
    if (mediumPlan.price !== '$149') {
      throw new Error(`❌ Medium plan: Expected price=$149, got ${mediumPlan.price}`);
    }
    console.log(`✓ Medium plan correct: ${mediumPlan.price}/month, ${mediumPlan.modelsLimit} models\n`);

    // Test 6: Verify Enterprise plan structure
    console.log('Test 6: Verify Enterprise plan structure');
    const enterprisePlan = allPlans.find(p => p.id === 'enterprise');

    if (enterprisePlan.brandsLimit !== -1) {
      throw new Error(`❌ Enterprise plan: Expected brandsLimit=-1 (unlimited), got ${enterprisePlan.brandsLimit}`);
    }
    if (enterprisePlan.promptsLimit !== -1) {
      throw new Error(`❌ Enterprise plan: Expected promptsLimit=-1 (unlimited), got ${enterprisePlan.promptsLimit}`);
    }
    if (enterprisePlan.modelsLimit !== -1) {
      throw new Error(`❌ Enterprise plan: Expected modelsLimit=-1 (unlimited), got ${enterprisePlan.modelsLimit}`);
    }
    if (!enterprisePlan.isEnterprise) {
      throw new Error('❌ Enterprise plan: Expected isEnterprise=true');
    }
    if (!enterprisePlan.requiresQuote) {
      throw new Error('❌ Enterprise plan: Expected requiresQuote=true');
    }
    if (enterprisePlan.setupFee !== 2500) {
      throw new Error(`❌ Enterprise plan: Expected setupFee=2500, got ${enterprisePlan.setupFee}`);
    }
    console.log(`✓ Enterprise plan correct: unlimited limits, setup fee $${enterprisePlan.setupFee}\n`);

    // Test 7: Query specific plan by ID
    console.log('Test 7: Query specific plan by ID');
    const specificPlan = await resolvers.billingPlan(null, { id: 'small' });

    if (!specificPlan) {
      throw new Error('❌ Expected to find small plan by ID');
    }
    if (specificPlan.id !== 'small') {
      throw new Error(`❌ Expected plan id='small', got '${specificPlan.id}'`);
    }
    console.log(`✓ Found specific plan: ${specificPlan.name}\n`);

    // Test 8: Verify allowed models
    console.log('Test 8: Verify allowed models');
    if (!freePlan.allowedModels.includes('gpt-4o-mini')) {
      throw new Error('❌ Free plan: Missing expected model gpt-4o-mini');
    }
    if (freePlan.allowedModels.length !== 1) {
      throw new Error(`❌ Free plan: Expected 1 model, got ${freePlan.allowedModels.length}`);
    }
    console.log(`✓ Free plan models: ${freePlan.allowedModels.join(', ')}`);

    if (smallPlan.allowedModels.length !== 3) {
      throw new Error(`❌ Small plan: Expected 3 models, got ${smallPlan.allowedModels.length}`);
    }
    console.log(`✓ Small plan models: ${smallPlan.allowedModels.join(', ')}`);

    if (mediumPlan.allowedModels.length !== 6) {
      throw new Error(`❌ Medium plan: Expected 6 models, got ${mediumPlan.allowedModels.length}`);
    }
    console.log(`✓ Medium plan models: ${mediumPlan.allowedModels.length} models`);

    if (!enterprisePlan.allowedModels.includes('*')) {
      throw new Error('❌ Enterprise plan: Expected wildcard model access');
    }
    console.log(`✓ Enterprise plan: All models (*)\n`);

    // Test 9: Verify features list
    console.log('Test 9: Verify features list');
    if (!freePlan.features || freePlan.features.length === 0) {
      throw new Error('❌ Free plan: Missing features list');
    }
    if (!smallPlan.features || smallPlan.features.length === 0) {
      throw new Error('❌ Small plan: Missing features list');
    }
    console.log(`✓ All plans have feature lists\n`);

    console.log('✅ All BillingPlans tests passed!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run test if called directly
if (require.main === module) {
  runTest();
}

module.exports = { runTest };

/**
 * Test for entitlements utility functions
 *
 * This test will:
 * 1. Create workspace and billing profile with limits
 * 2. Test canCreateBrand check (allowed and denied)
 * 3. Test canCreatePrompt check (allowed and denied)
 * 4. Test monthly reset for free tier
 * 5. Test canUseModel check for different plans
 * 6. Test incrementBrandUsage
 * 7. Test incrementPromptUsage
 * 8. Test getUsageSummary
 */

const mongoose = require('mongoose');
const {
  canCreateBrand,
  canCreatePrompt,
  canUseModel,
  incrementBrandUsage,
  decrementBrandUsage,
  incrementPromptUsage,
  getUsageSummary
} = require('./entitlements');
const { BillingProfile, BillingProfileMember } = require('../graphql/queries/billingProfile');
const { Workspace } = require('../graphql/queries/workspace');

async function runTest() {
  console.log('🧪 Testing entitlements utilities...\n');

  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    await mongoose.connect(`${mongoUri}/airank_test`);
    console.log('✓ Connected to test database');

    // Clean up test data
    await Workspace().deleteMany({ name: /Test Workspace/ });
    await BillingProfile().deleteMany({ name: /Test Profile/ });
    console.log('✓ Cleaned up test data\n');

    // Test 1: Setup - Create billing profile and workspace
    console.log('Test 1: Setup billing profile and workspace');
    const userId = 'test-user-123';

    // Create billing profile with free plan limits
    const billingProfile = await BillingProfile().create({
      name: 'Test Profile 1',
      currentPlan: 'free',
      brandsLimit: 1,
      brandsUsed: 0,
      promptsLimit: 4,
      promptsUsed: 0,
      promptsResetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      modelsLimit: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const workspaceId = new mongoose.Types.ObjectId().toString();
    await Workspace().create({
      _id: workspaceId,
      workspaceCode: 'test-ws-123',
      inviteCode: 'inv-123',
      creatorId: userId,
      name: 'Test Workspace 1',
      slug: 'test-workspace-1',
      billingProfileId: billingProfile._id.toString(),
      createdAt: new Date(),
      updatedAt: new Date()
    });

    console.log(`✓ Created billing profile: ${billingProfile._id}`);
    console.log(`✓ Created workspace: ${workspaceId}`);
    console.log(`✓ Limits: ${billingProfile.brandsLimit} brands, ${billingProfile.promptsLimit} prompts\n`);

    // Test 2: canCreateBrand - allowed
    console.log('Test 2: canCreateBrand - allowed');
    const brandCheck1 = await canCreateBrand(workspaceId);
    if (!brandCheck1.allowed) {
      throw new Error('❌ Expected brand creation to be allowed');
    }
    console.log(`✓ Brand creation allowed: ${brandCheck1.used}/${brandCheck1.limit}\n`);

    // Test 3: Increment brand usage and check limit
    console.log('Test 3: Increment brand usage and check limit');
    await incrementBrandUsage(workspaceId);
    const brandCheck2 = await canCreateBrand(workspaceId);
    if (brandCheck2.allowed) {
      throw new Error('❌ Expected brand creation to be denied (limit reached)');
    }
    console.log(`✓ Brand creation denied: ${brandCheck2.reason}\n`);

    // Test 4: canCreatePrompt - allowed
    console.log('Test 4: canCreatePrompt - allowed');
    const promptCheck1 = await canCreatePrompt(workspaceId);
    if (!promptCheck1.allowed) {
      throw new Error('❌ Expected prompt creation to be allowed');
    }
    console.log(`✓ Prompt creation allowed: ${promptCheck1.used}/${promptCheck1.limit}`);
    console.log(`✓ Reset date: ${promptCheck1.resetDate.toLocaleDateString()}\n`);

    // Test 5: Increment prompt usage until limit
    console.log('Test 5: Increment prompt usage until limit');
    await incrementPromptUsage(workspaceId);
    await incrementPromptUsage(workspaceId);
    await incrementPromptUsage(workspaceId);
    await incrementPromptUsage(workspaceId);

    const promptCheck2 = await canCreatePrompt(workspaceId);
    if (promptCheck2.allowed) {
      throw new Error('❌ Expected prompt creation to be denied (limit reached)');
    }
    console.log(`✓ Prompt creation denied: ${promptCheck2.reason}\n`);

    // Test 6: Test monthly reset for free tier
    console.log('Test 6: Test monthly reset for free tier');
    // Set reset date to past
    await BillingProfile().findByIdAndUpdate(billingProfile._id, {
      promptsResetDate: new Date(Date.now() - 1000) // 1 second ago
    });

    const promptCheck3 = await canCreatePrompt(workspaceId);
    if (!promptCheck3.allowed) {
      throw new Error('❌ Expected prompt creation to be allowed after reset');
    }
    if (promptCheck3.used !== 0) {
      throw new Error(`❌ Expected usage to be reset to 0, got ${promptCheck3.used}`);
    }
    console.log(`✓ Prompts reset after period: ${promptCheck3.used}/${promptCheck3.limit}`);
    console.log(`✓ New reset date: ${promptCheck3.resetDate.toLocaleDateString()}\n`);

    // Test 7: canUseModel - free plan
    console.log('Test 7: canUseModel - free plan');
    const modelCheck1 = await canUseModel(workspaceId, 'gpt-4o-mini');
    if (!modelCheck1.allowed) {
      throw new Error('❌ Expected gpt-4o-mini to be allowed on free plan');
    }
    console.log(`✓ gpt-4o-mini allowed on free plan\n`);

    const modelCheck2 = await canUseModel(workspaceId, 'gpt-4o');
    if (modelCheck2.allowed) {
      throw new Error('❌ Expected gpt-4o to be denied on free plan');
    }
    console.log(`✓ gpt-4o denied on free plan: ${modelCheck2.reason}\n`);

    // Test 8: Upgrade to small plan and test model access
    console.log('Test 8: Upgrade to small plan and test model access');
    await BillingProfile().findByIdAndUpdate(billingProfile._id, {
      currentPlan: 'small',
      brandsLimit: 4,
      promptsLimit: 10,
      modelsLimit: 3
    });

    const modelCheck3 = await canUseModel(workspaceId, 'gpt-4o');
    if (!modelCheck3.allowed) {
      throw new Error('❌ Expected gpt-4o to be allowed on small plan');
    }
    console.log(`✓ gpt-4o allowed on small plan\n`);

    const modelCheck4 = await canUseModel(workspaceId, 'claude-3-opus');
    if (modelCheck4.allowed) {
      throw new Error('❌ Expected claude-3-opus to be denied on small plan');
    }
    console.log(`✓ claude-3-opus denied on small plan: ${modelCheck4.reason}\n`);

    // Test 9: getUsageSummary
    console.log('Test 9: getUsageSummary');
    const summary = await getUsageSummary(workspaceId);
    if (summary.plan !== 'small') {
      throw new Error(`❌ Expected plan 'small', got '${summary.plan}'`);
    }
    if (summary.brands.limit !== 4) {
      throw new Error(`❌ Expected brands limit 4, got ${summary.brands.limit}`);
    }
    console.log(`✓ Usage summary:`);
    console.log(`  - Plan: ${summary.plan}`);
    console.log(`  - Brands: ${summary.brands.used}/${summary.brands.limit}`);
    console.log(`  - Prompts: ${summary.prompts.used}/${summary.prompts.limit}\n`);

    // Test 10: decrementBrandUsage
    console.log('Test 10: decrementBrandUsage');
    await decrementBrandUsage(workspaceId);
    const summary2 = await getUsageSummary(workspaceId);
    if (summary2.brands.used !== 0) {
      throw new Error(`❌ Expected brands used to be 0, got ${summary2.brands.used}`);
    }
    console.log(`✓ Brand usage decremented: ${summary2.brands.used}/${summary2.brands.limit}\n`);

    // Cleanup
    await Workspace().deleteMany({ name: /Test Workspace/ });
    await BillingProfile().deleteMany({ name: /Test Profile/ });
    console.log('✓ Cleaned up test data');

    await mongoose.connection.close();
    console.log('\n✅ All entitlements tests passed!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run test if called directly
if (require.main === module) {
  runTest();
}

module.exports = { runTest };

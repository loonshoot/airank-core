const mongoose = require('mongoose');

async function testPremium3Job() {
  await mongoose.connect(process.env.PROD_MONGO_URI);
  const airankDb = mongoose.connection.useDb('airank');

  // Get Premium 3 workspace
  const workspace = await airankDb.collection('workspaces').findOne({ name: 'Premium 3' });
  const workspaceId = workspace._id.toString();

  console.log('🏢 Premium 3 Workspace');
  console.log('ID:', workspaceId);
  console.log();

  // Check the recurring job we just created
  const recurringJob = await airankDb.collection('agendaJobs').findOne({
    name: 'promptModelTester',
    'data.workspaceId': workspaceId,
    repeatInterval: { $ne: null }
  });

  if (recurringJob) {
    console.log('📅 Recurring promptModelTester Job:');
    console.log('Job ID:', recurringJob._id);
    console.log('Next Run:', recurringJob.nextRunAt);
    console.log('Last Run:', recurringJob.lastRunAt);
    console.log('Last Finished:', recurringJob.lastFinishedAt);
    console.log('Repeat Interval:', recurringJob.repeatInterval);
    console.log('Disabled:', recurringJob.disabled || false);
    console.log('Locked At:', recurringJob.lockedAt);

    if (recurringJob.lastRunAt) {
      console.log('\n✅ Job has run at least once!');
      if (recurringJob.lastFinishedAt) {
        const duration = new Date(recurringJob.lastFinishedAt) - new Date(recurringJob.lastRunAt);
        console.log('Last run duration:', duration + 'ms');
      }
    } else {
      console.log('\n⏳ Job has not run yet. Waiting for batcher to pick it up...');
    }
    console.log();
  } else {
    console.log('❌ Recurring job not found!');
    console.log();
  }

  // Check workspace database for batches and results
  const workspaceDb = mongoose.connection.useDb(`workspace_${workspaceId}`);

  // Check batches
  const batches = await workspaceDb.collection('batches').find({})
    .sort({ submittedAt: -1 })
    .limit(5)
    .toArray();

  console.log('📦 Recent Batches:', batches.length);
  batches.forEach((b, i) => {
    console.log(`\n  ${i + 1}. ${b.batchId || b._id}`);
    console.log('     Provider:', b.provider);
    console.log('     Status:', b.status);
    console.log('     Submitted:', b.submittedAt);
    console.log('     Processed:', b.isProcessed);
    console.log('     Results:', b.results?.length || 0);
  });

  // Check previous model results
  const results = await workspaceDb.collection('previousmodelresults').find({})
    .sort({ processedAt: -1 })
    .limit(5)
    .toArray();

  console.log('\n\n📊 Recent Model Results:', results.length);
  results.forEach((r, i) => {
    console.log(`\n  ${i + 1}. ${r.modelName || r.modelId}`);
    console.log('     Processed:', r.processedAt);
    console.log('     Batch ID:', r.batchId || 'N/A');
    console.log('     Has Sentiment:', !!r.sentimentAnalysis);
    if (r.sentimentAnalysis) {
      console.log('     Brands:', r.sentimentAnalysis.brands?.length || 0);

      // Check for comma-separated brand issue
      const brands = r.sentimentAnalysis.brands || [];
      const problematicBrands = brands.filter(b =>
        b.brandKeywords && b.brandKeywords.includes(',')
      );

      if (problematicBrands.length > 0) {
        console.log('     ⚠️  COMMA-SEPARATED BRANDS FOUND:');
        problematicBrands.forEach(pb => {
          console.log('         -', pb.brandKeywords);
        });
      } else {
        console.log('     ✅ All brands properly normalized (no commas)');
      }
    }
  });

  // Check for enabled models
  const models = await workspaceDb.collection('models').find({ isEnabled: true }).toArray();
  console.log('\n\n🤖 Enabled Models:', models.length);
  models.forEach(m => {
    console.log('  -', m.name || m.modelId, `(${m.provider})`);
  });

  // Test entitlements
  console.log('\n\n🔍 Testing getEntitlements() after deployment...');
  try {
    // We need to use the deployed version, so let's check what the billing profile has
    const billingProfile = await airankDb.collection('billingprofiles').findOne({
      _id: workspace.billingProfileId
    });

    console.log('✅ Billing Profile:');
    console.log('   Current Plan:', billingProfile.currentPlan);
    console.log('   Job Frequency:', billingProfile.jobFrequency);
    console.log('   Brands Limit:', billingProfile.brandsLimit);
    console.log('   Models Limit:', billingProfile.modelsLimit);
  } catch (error) {
    console.error('❌ Error testing entitlements:', error.message);
  }

  await mongoose.connection.close();
}

testPremium3Job().catch(console.error);

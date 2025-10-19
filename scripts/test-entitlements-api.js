const mongoose = require('mongoose');
require('dotenv').config();

async function testEntitlementsAPI() {
  try {
    await mongoose.connect(`${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`);
    
    const workspace = await mongoose.connection.db.collection('workspaces').findOne({ slug: 'test' });
    
    if (!workspace) {
      console.log('Test workspace not found');
      process.exit(1);
    }
    
    console.log('Test Workspace:', workspace.slug);
    console.log('Workspace ID:', workspace._id);
    
    const path = require('path');
    const yaml = require('js-yaml');
    const fs = require('fs');
    
    const billingProfile = await mongoose.connection.db.collection('billingprofiles').findOne({ 
      _id: workspace.billingProfileId 
    });
    
    console.log('\n=== Billing Profile ===');
    console.log('Name:', billingProfile.name);
    console.log('Plan ID:', billingProfile.planId);
    console.log('Brands Limit:', billingProfile.brandsLimit);
    console.log('Prompts Limit:', billingProfile.promptsLimit);
    console.log('Models Limit:', billingProfile.modelsLimit);
    console.log('Models Selectable:', billingProfile.modelsSelectable);
    console.log('Cost Budget Monthly:', billingProfile.costBudgetMonthly);
    console.log('Allowed Models:', billingProfile.allowedModels.length);
    
    console.log('\n=== Selection Rules ===');
    console.log('Max Expensive Premium:', billingProfile.maxExpensivePremium);
    console.log('Max Cheap Premium:', billingProfile.maxCheapPremium);
    console.log('Expensive Premium Models:', billingProfile.expensivePremiumModels);
    console.log('Cheap Premium Models:', billingProfile.cheapPremiumModels);
    
    const configPath = path.join(__dirname, '../config/models.yaml');
    const fileContents = fs.readFileSync(configPath, 'utf8');
    const modelsConfig = yaml.load(fileContents);
    
    console.log('\n=== Models Config ===');
    console.log('Total models in YAML:', modelsConfig.models.length);
    console.log('Models with showInUI=true:', modelsConfig.models.filter(m => m.showInUI).length);
    console.log('Selectable models:', modelsConfig.models.filter(m => m.isSelectable).length);
    console.log('Deprecated models:', modelsConfig.models.filter(m => !m.isSelectable).length);
    
    console.log('\n=== Allowed Models for Medium Plan ===');
    billingProfile.allowedModels.forEach((modelId, i) => {
      const config = modelsConfig.models.find(m => m.modelId === modelId);
      const name = config ? config.name : 'NOT FOUND';
      const tier = config ? config.costTier : 'N/A';
      const cost = config ? config.costPerQueryUSD : 'N/A';
      console.log(`${i+1}. ${modelId}`);
      console.log(`   Name: ${name}`);
      console.log(`   Tier: ${tier}`);
      console.log(`   Cost: $${cost}`);
    });
    
    const workspaceDbUri = `${process.env.MONGODB_URI}/workspace_${workspace._id}?${process.env.MONGODB_PARAMS}`;
    const workspaceDb = mongoose.createConnection(workspaceDbUri);
    await workspaceDb.asPromise();
    
    const enabledModels = await workspaceDb.collection('models').find({ isEnabled: true }).toArray();
    
    console.log('\n=== Currently Enabled Models ===');
    console.log('Count:', enabledModels.length);
    enabledModels.forEach((model, i) => {
      console.log(`${i+1}. ${model.modelId} (${model.name})`);
    });
    
    await workspaceDb.close();
    await mongoose.connection.close();
    
    console.log('\n✅ API test complete!');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testEntitlementsAPI();

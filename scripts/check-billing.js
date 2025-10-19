const mongoose = require('mongoose');
require('dotenv').config();

async function checkTestWorkspace() {
  try {
    await mongoose.connect(`${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`);
    
    const Workspace = mongoose.model('Workspace', new mongoose.Schema({}, { strict: false, collection: 'workspaces' }));
    const workspace = await Workspace.findOne({ slug: 'test' });
    
    if (!workspace) {
      console.log('Workspace not found');
      process.exit(0);
    }
    
    console.log('Workspace:', workspace.slug);
    console.log('Workspace ID:', workspace._id.toString());
    console.log('Billing Profile ID:', workspace.billingProfileId);
    console.log('Billing Profile ID type:', typeof workspace.billingProfileId);
    
    if (workspace.billingProfileId) {
      const BillingProfile = mongoose.model('BillingProfile', new mongoose.Schema({}, { strict: false, collection: 'billingprofiles' }));
      
      console.log('\nSearching for billing profile...');
      const bp = await BillingProfile.findById(workspace.billingProfileId);
      console.log('findById result:', bp ? 'FOUND' : 'NOT FOUND');
      
      if (bp) {
        console.log('\nBilling Profile Details:');
        console.log('Name:', bp.name);
        console.log('Plan ID:', bp.planId);
        console.log('Models Limit:', bp.modelsLimit);
        console.log('Allowed Models:', bp.allowedModels);
      }
      
      const allBPs = await BillingProfile.find({});
      console.log('\nAll billing profiles:');
      allBPs.forEach(profile => {
        console.log('  - ID:', profile._id.toString(), 'Name:', profile.name || 'N/A', 'Plan:', profile.planId);
      });
    }
    
    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

checkTestWorkspace();

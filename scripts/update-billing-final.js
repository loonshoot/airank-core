const mongoose = require('mongoose');
require('dotenv').config();

async function updateBillingProfile() {
  try {
    await mongoose.connect(`${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`);
    
    const db = mongoose.connection.db;
    
    // Update the "new" billing profile with final Medium plan configuration
    const result = await db.collection('billingprofiles').updateOne(
      { _id: '68f22a53619c793fbdfc97b7' },
      {
        $set: {
          planId: 'medium',
          brandsLimit: 10,
          promptsLimit: 20,
          modelsLimit: 6,
          modelsSelectable: 6,
          costBudgetMonthly: 60.00,
          maxExpensivePremium: 1,
          maxCheapPremium: 2,
          allowedModels: [
            'gpt-4o-mini-2024-07-18',
            'claude-3-5-haiku-20241022',
            'gemini-2.5-flash',
            'gpt-4o-2024-08-06',
            'claude-3-5-sonnet-20241022',
            'gemini-2.5-pro',
            'gpt-4.1-2025-04-14',
            'claude-haiku-4-5',
            'claude-3-opus-20240229',
            'gemini-2.5-flash-lite'
          ],
          expensivePremiumModels: ['gpt-4.1-2025-04-14', 'claude-3-opus-20240229'],
          cheapPremiumModels: ['claude-haiku-4-5', 'gemini-2.5-flash-lite']
        }
      }
    );
    
    console.log('Updated billing profile "new" with final Medium plan config:');
    console.log('  Matched:', result.matchedCount);
    console.log('  Modified:', result.modifiedCount);
    
    // Verify update
    const updated = await db.collection('billingprofiles').findOne({ _id: '68f22a53619c793fbdfc97b7' });
    console.log('\nVerification:');
    console.log('  Plan ID:', updated.planId);
    console.log('  Brands Limit:', updated.brandsLimit);
    console.log('  Prompts Limit:', updated.promptsLimit);
    console.log('  Models Limit:', updated.modelsLimit);
    console.log('  Models Selectable:', updated.modelsSelectable);
    console.log('  Cost Budget:', `$${updated.costBudgetMonthly}/month`);
    console.log('  Max Expensive Premium:', updated.maxExpensivePremium);
    console.log('  Max Cheap Premium:', updated.maxCheapPremium);
    console.log('  Allowed Models:', updated.allowedModels.length);
    
    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

updateBillingProfile();

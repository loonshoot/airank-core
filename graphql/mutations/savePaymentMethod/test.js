/**
 * Test for savePaymentMethod mutation
 *
 * This test will:
 * 1. Create billing profile and user
 * 2. Save payment method to billing profile
 * 3. Verify payment method details stored
 * 4. Test updating payment method (replace existing)
 * 5. Test error: non-manager trying to save payment method
 * 6. Test error: unauthenticated access
 */

const mongoose = require('mongoose');
const { resolvers } = require('./index');
const { BillingProfile, BillingProfileMember } = require('../../queries/billingProfile');

async function runTest() {
  console.log('🧪 Testing savePaymentMethod mutation...\n');

  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    await mongoose.connect(`${mongoUri}/airank_test`);
    console.log('✓ Connected to test database');

    // Clean up test data
    await BillingProfile().deleteMany({ name: /Test Profile/ });
    await BillingProfileMember().deleteMany({ userId: /test-user/ });
    console.log('✓ Cleaned up test data\n');

    // Test 1: Setup - Create billing profile and user
    console.log('Test 1: Setup billing profile and user');
    const userId = 'test-user-123';
    const userEmail = 'test@example.com';

    // Create billing profile
    const billingProfile = await BillingProfile().create({
      name: 'Test Profile 1',
      stripeCustomerId: 'cus_test_123',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Add user as billing profile manager
    await BillingProfileMember().create({
      billingProfileId: billingProfile._id.toString(),
      userId,
      role: 'manager'
    });

    console.log(`✓ Created billing profile: ${billingProfile._id}`);
    console.log(`✓ User is billing profile manager\n`);

    // Test 2: Save payment method
    console.log('Test 2: Save payment method');
    const mockUser = { sub: userId, _id: userId, email: userEmail };
    const paymentMethodId = 'pm_test_visa_4242';
    const result = await resolvers.savePaymentMethod(
      null,
      {
        billingProfileId: billingProfile._id.toString(),
        paymentMethodId
      },
      { user: mockUser }
    );

    if (!result) {
      throw new Error('❌ savePaymentMethod returned null');
    }
    if (!result.hasPaymentMethod) {
      throw new Error('❌ hasPaymentMethod not set to true');
    }
    if (result.defaultPaymentMethodId !== paymentMethodId) {
      throw new Error(`❌ Expected defaultPaymentMethodId '${paymentMethodId}', got '${result.defaultPaymentMethodId}'`);
    }
    console.log(`✓ Payment method saved`);
    console.log(`✓ Payment method ID: ${result.defaultPaymentMethodId}`);
    console.log(`✓ Card: ${result.paymentMethodBrand} ending in ${result.paymentMethodLast4}\n`);

    // Test 3: Verify billing profile updated
    console.log('Test 3: Verify billing profile updated');
    const updatedProfile = await BillingProfile().findById(billingProfile._id);
    if (!updatedProfile.hasPaymentMethod) {
      throw new Error('❌ hasPaymentMethod not persisted');
    }
    if (!updatedProfile.paymentMethodLast4) {
      throw new Error('❌ paymentMethodLast4 not stored');
    }
    if (!updatedProfile.paymentMethodBrand) {
      throw new Error('❌ paymentMethodBrand not stored');
    }
    console.log(`✓ Payment method details persisted:`);
    console.log(`  - Brand: ${updatedProfile.paymentMethodBrand}`);
    console.log(`  - Last 4: ${updatedProfile.paymentMethodLast4}`);
    console.log(`  - Exp: ${updatedProfile.paymentMethodExpMonth}/${updatedProfile.paymentMethodExpYear}\n`);

    // Test 4: Update payment method (replace existing)
    console.log('Test 4: Update payment method');
    const newPaymentMethodId = 'pm_test_mastercard_5555';
    const updated = await resolvers.savePaymentMethod(
      null,
      {
        billingProfileId: billingProfile._id.toString(),
        paymentMethodId: newPaymentMethodId
      },
      { user: mockUser }
    );

    if (updated.defaultPaymentMethodId !== newPaymentMethodId) {
      throw new Error('❌ Payment method not updated');
    }
    if (updated.paymentMethodLast4 !== '5555') {
      throw new Error('❌ Card details not updated');
    }
    console.log(`✓ Payment method updated`);
    console.log(`✓ New card: ${updated.paymentMethodBrand} ending in ${updated.paymentMethodLast4}\n`);

    // Test 5: Test error - non-manager trying to save payment method
    console.log('Test 5: Non-manager cannot save payment method');
    const nonManagerUser = { sub: 'non-manager-456', _id: 'non-manager-456', email: 'nonmanager@example.com' };

    try {
      await resolvers.savePaymentMethod(
        null,
        {
          billingProfileId: billingProfile._id.toString(),
          paymentMethodId: 'pm_test_123'
        },
        { user: nonManagerUser }
      );
      throw new Error('❌ Expected authorization error for non-manager');
    } catch (error) {
      if (error.message.includes('manager')) {
        console.log(`✓ Correctly rejected non-manager: ${error.message}\n`);
      } else {
        throw error;
      }
    }

    // Test 6: Test unauthenticated access
    console.log('Test 6: Unauthenticated access rejected');
    try {
      await resolvers.savePaymentMethod(
        null,
        {
          billingProfileId: billingProfile._id.toString(),
          paymentMethodId: 'pm_test_123'
        },
        { user: null }
      );
      throw new Error('❌ Expected authentication error');
    } catch (error) {
      if (error.message.includes('Authentication required')) {
        console.log('✓ Correctly rejected unauthenticated request\n');
      } else {
        throw error;
      }
    }

    // Cleanup
    await BillingProfile().deleteMany({ name: /Test Profile/ });
    await BillingProfileMember().deleteMany({ userId: /test-user/ });
    console.log('✓ Cleaned up test data');

    await mongoose.connection.close();
    console.log('\n✅ All savePaymentMethod tests passed!');
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

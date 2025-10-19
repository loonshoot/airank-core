const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
  try {
    await mongoose.connect(`${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`);
    
    const BillingProfile = mongoose.model('BillingProfile', new mongoose.Schema({}, { strict: false, collection: 'billingprofiles' }));
    
    // Find by string ID
    const bp1 = await BillingProfile.findOne({ _id: '68f22a53619c793fbdfc97b7' });
    console.log('Search by string ID:', bp1 ? 'FOUND' : 'NOT FOUND');
    
    // Find by ObjectId
    const bp2 = await BillingProfile.findOne({ _id: new mongoose.Types.ObjectId('68f22a53619c793fbdfc97b7') });
    console.log('Search by ObjectId:', bp2 ? 'FOUND' : 'NOT FOUND');
    
    if (bp2) {
      console.log('\nBilling Profile "new":');
      console.log(JSON.stringify(bp2.toObject(), null, 2));
    }
    
    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

check();

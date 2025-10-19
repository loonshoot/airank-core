const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
  try {
    await mongoose.connect(`${process.env.MONGODB_URI}/airank?${process.env.MONGODB_PARAMS}`);
    
    const db = mongoose.connection.db;
    const billingProfiles = await db.collection('billingprofiles').find({}).toArray();
    
    console.log('All billing profiles from collection:');
    billingProfiles.forEach(bp => {
      console.log('\n---');
      console.log('_id:', bp._id, '(type:', typeof bp._id + ')');
      console.log('name:', bp.name);
      console.log('planId:', bp.planId);
      console.log('modelsLimit:', bp.modelsLimit);
      console.log('allowedModels:', bp.allowedModels);
    });
    
    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

check();

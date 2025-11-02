const mongoose = require('mongoose');

// The suspicious batch ID from production
const suspiciousBatchId = 'batch_6902c7e702088190b9a2f790bd9eab9f';
const hexPart = suspiciousBatchId.replace('batch_', '');

console.log('Analyzing batch ID:', suspiciousBatchId);
console.log('Hex part:', hexPart);
console.log('Hex part length:', hexPart.length);
console.log('');

// Try to create an ObjectId from this hex
try {
  const oid = new mongoose.Types.ObjectId(hexPart);
  console.log('✓ Valid ObjectId format!');
  console.log('ObjectId:', oid.toString());
  console.log('Timestamp:', oid.getTimestamp());
} catch (e) {
  console.log('✗ Not a valid ObjectId');
}

// Compare with the actual document _id
console.log('');
console.log('Document _id from database: 6902c7e7463d6e603c7b3f0d');
console.log('Batch ID hex part:           6902c7e702088190b9a2f790bd9eab9f');
console.log('');
console.log('Notice: Both start with 6902c7e7');
console.log('This suggests the batch ID was constructed using a new ObjectId()');

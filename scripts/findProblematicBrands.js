const mongoose = require('mongoose');

async function findProblematicBrands() {
  try {
    const workspaceId = '690f7b6056f9ee90ea8cdbe2';
    const mongoUri = `mongodb://admin:kvmJFfIjxdmpGwuyHENfBwD3@100.123.101.37:27017/workspace_${workspaceId}?authSource=admin&directConnection=false`;

    await mongoose.connect(mongoUri);
    console.log('✓ Connected to workspace database');

    const collection = mongoose.connection.db.collection('previousmodelresults');

    const results = await collection.find({
      'sentimentAnalysis.brands': { $exists: true }
    }).limit(1000).toArray();

    console.log(`📊 Checking ${results.length} results`);

    const problematic = results.filter(doc => {
      if (!doc.sentimentAnalysis || !doc.sentimentAnalysis.brands) return false;
      return doc.sentimentAnalysis.brands.some(b =>
        !b.hasOwnProperty('brandKeywords') ||
        b.brandKeywords === null ||
        b.brandKeywords === undefined ||
        b.brandKeywords === '' ||
        typeof b.brandKeywords !== 'string'
      );
    });

    console.log(`❌ Found ${problematic.length} problematic results`);

    if (problematic.length > 0) {
      console.log('\nSamples:');
      problematic.slice(0, 3).forEach(doc => {
        console.log(`\n  ID: ${doc._id}`);
        doc.sentimentAnalysis.brands.forEach((b, i) => {
          if (!b.brandKeywords || typeof b.brandKeywords !== 'string') {
            console.log(`    Brand[${i}]: brandKeywords=${JSON.stringify(b.brandKeywords)} (type: ${typeof b.brandKeywords}), type=${b.type}, mentioned=${b.mentioned}`);
          }
        });
      });
    }

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

findProblematicBrands();

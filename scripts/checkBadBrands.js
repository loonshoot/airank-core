const mongoose = require('mongoose');
require('dotenv').config();

async function checkBadBrands() {
  const mainConnection = mongoose.connection;

  try {
    console.log('🔍 Checking for null/empty brandKeywords in production...');

    // Connect to main database
    await mongoose.connect('mongodb://admin:kvmJFfIjxdmpGwuyHENfBwD3@100.123.101.37:27017/?authSource=admin&directConnection=false', {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
    });

    console.log('✓ Connected to database');

    // Get all workspace databases
    const admin = mainConnection.db.admin();
    const { databases } = await admin.listDatabases();
    const workspaceDbs = databases.filter(db => db.name.startsWith('workspace_'));

    console.log(`📊 Found ${workspaceDbs.length} workspace databases\n`);

    let totalBad = 0;

    // Check each workspace
    for (const dbInfo of workspaceDbs) {
      const workspaceId = dbInfo.name.replace('workspace_', '');

      let workspaceConnection = null;

      try {
        // Connect to workspace database
        const mongoUri = `mongodb://admin:kvmJFfIjxdmpGwuyHENfBwD3@100.123.101.37:27017/${dbInfo.name}?authSource=admin&directConnection=false`;
        workspaceConnection = mongoose.createConnection(mongoUri, {
          serverSelectionTimeoutMS: 30000,
          socketTimeoutMS: 45000,
        });

        await new Promise((resolve, reject) => {
          workspaceConnection.once('connected', resolve);
          workspaceConnection.once('error', reject);
          setTimeout(() => reject(new Error('Connection timeout')), 30000);
        });

        // Get the collection
        const collection = workspaceConnection.db.collection('previousmodelresults');

        // Find documents with sentiment analysis
        const results = await collection.find({
          'sentimentAnalysis.brands': { $exists: true }
        }).limit(200).toArray();

        if (results.length === 0) continue;

        // Check for bad data
        const badResults = results.filter(doc => {
          if (!doc.sentimentAnalysis || !doc.sentimentAnalysis.brands) return false;
          return doc.sentimentAnalysis.brands.some(b =>
            !b.brandKeywords ||
            b.brandKeywords === null ||
            b.brandKeywords === '' ||
            (typeof b.brandKeywords === 'string' && b.brandKeywords.trim() === '')
          );
        });

        if (badResults.length > 0) {
          console.log(`📦 Workspace: ${workspaceId}`);
          console.log(`   ❌ Found ${badResults.length} results with null/empty brandKeywords (out of ${results.length} checked)`);

          // Show sample
          badResults.slice(0, 2).forEach(doc => {
            console.log(`   Sample ID: ${doc._id}`);
            doc.sentimentAnalysis.brands.forEach((b, i) => {
              if (!b.brandKeywords || b.brandKeywords === '' || (typeof b.brandKeywords === 'string' && b.brandKeywords.trim() === '')) {
                console.log(`     Brand[${i}]: brandKeywords=${JSON.stringify(b.brandKeywords)}, type=${b.type}, mentioned=${b.mentioned}`);
              }
            });
          });
          console.log('');

          totalBad += badResults.length;
        }

      } catch (error) {
        console.error(`   ❌ Error checking workspace ${workspaceId}:`, error.message);
      } finally {
        if (workspaceConnection) {
          await workspaceConnection.close();
        }
      }
    }

    console.log(`\n📊 Summary: Found ${totalBad} total results with bad brandKeywords data`);

  } catch (error) {
    console.error('💥 Script failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
    process.exit(0);
  }
}

// Run the script
checkBadBrands();

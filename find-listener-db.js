const { MongoClient } = require('mongodb');

async function findListenerDatabase() {
  const uri = process.env.PROD_MONGO_URI;
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('✓ Connected to MongoDB\n');

    const adminDb = client.db().admin();
    const { databases } = await adminDb.listDatabases();

    console.log('🔍 Searching for listeners collection...\n');

    for (const dbInfo of databases) {
      const db = client.db(dbInfo.name);
      const collections = await db.listCollections().toArray();

      const hasListeners = collections.some(c => c.name === 'listeners');

      if (hasListeners) {
        console.log(`Found listeners collection in database: ${dbInfo.name}`);

        const listeners = await db.collection('listeners').find({}).toArray();
        console.log(`\nListeners in ${dbInfo.name}:`);
        listeners.forEach(l => {
          console.log(`  - ${l.collection} → ${l.jobName}`);
          console.log(`    Operations: ${JSON.stringify(l.operationType)}`);
          console.log(`    Active: ${l.isActive}`);
        });
        console.log('');
      }
    }

    await client.close();
  } catch (error) {
    console.error('Error:', error);
    await client.close();
    process.exit(1);
  }
}

findListenerDatabase();

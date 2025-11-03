const mongoose = require('mongoose');

const WORKSPACE_ID = '690812d6cbff976e8bfab2a2';
const WORKSPACE_NAME = 'Test Freemium';

async function resetAndTestWorkspace() {
  try {
    console.log('🔧 Starting workspace reset and test setup...\n');

    // Connect to production database
    // Connect to airank database first (where agendaJobs are stored)
    const mongoUri = process.env.PROD_MONGO_URI;
    const baseUri = mongoUri.split('?')[0].replace(/\/[^\/]*$/, '');
    const params = mongoUri.split('?')[1] || '';
    const airankUri = `${baseUri}/airank?${params}`;

    await mongoose.connect(airankUri, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 20000
    });
    console.log('✅ Connected to production database\n');

    const db = mongoose.connection.db;
    const airankDb = mongoose.connection.useDb('airank');
    const workspaceDb = mongoose.connection.useDb(`workspace_${WORKSPACE_ID}`);

    // ========================================
    // STEP 1: Clean up old Agenda jobs
    // ========================================
    console.log('📋 STEP 1: Cleaning up old Agenda jobs...');

    // Delete all old jobs for this workspace
    const oldJobsResult = await db.collection('agendaJobs').deleteMany({
      'data.workspaceId': WORKSPACE_ID
    });
    console.log(`  ✓ Deleted ${oldJobsResult.deletedCount} old workspace jobs`);

    // Clean up pollOpenAIBatches job (will be recreated by batcher if needed)
    const pollJobResult = await db.collection('agendaJobs').deleteMany({
      name: 'pollOpenAIBatches'
    });
    console.log(`  ✓ Deleted ${pollJobResult.deletedCount} pollOpenAIBatches jobs`);
    console.log('');

    // ========================================
    // STEP 2: Clean up workspace batches
    // ========================================
    console.log('📦 STEP 2: Cleaning up workspace batches...');

    const batchesResult = await workspaceDb.collection('batches').deleteMany({});
    console.log(`  ✓ Deleted ${batchesResult.deletedCount} batches`);
    console.log('');

    // ========================================
    // STEP 3: Clean up batch notifications
    // ========================================
    console.log('📨 STEP 3: Cleaning up batch notifications...');

    const notificationsResult = await workspaceDb.collection('batchnotifications').deleteMany({});
    console.log(`  ✓ Deleted ${notificationsResult.deletedCount} batch notifications`);
    console.log('');

    // ========================================
    // STEP 4: Clean up old model results (optional - commented out for safety)
    // ========================================
    console.log('📊 STEP 4: Model results cleanup (SKIPPED for safety)');
    console.log('  ℹ️  To clean results, uncomment the code in the script');

    // Uncomment these lines if you want to delete old results too:
    // const resultsResult = await workspaceDb.collection('previousmodelresults').deleteMany({});
    // console.log(`  ✓ Deleted ${resultsResult.deletedCount} model results`);
    console.log('');

    // ========================================
    // STEP 5: Get workspace configuration
    // ========================================
    console.log('🔍 STEP 5: Fetching workspace configuration...');

    const brands = await workspaceDb.collection('brands').find({}).toArray();
    const models = await workspaceDb.collection('models').find({}).toArray();
    const prompts = await workspaceDb.collection('prompts').find({}).toArray();

    console.log(`  ✓ Found ${brands.length} brands`);
    brands.forEach(b => {
      console.log(`    - ${b.name} (${b.isOwnBrand ? 'own' : 'competitor'})`);
    });

    console.log(`  ✓ Found ${models.length} models`);
    models.forEach(m => {
      console.log(`    - ${m.name} (${m.provider})`);
    });

    console.log(`  ✓ Found ${prompts.length} prompts`);
    prompts.forEach(p => {
      console.log(`    - ${p.phrase.substring(0, 50)}...`);
    });
    console.log('');

    if (brands.length === 0 || models.length === 0 || prompts.length === 0) {
      console.log('⚠️  WARNING: Missing required configuration!');
      console.log('   Please ensure workspace has brands, models, and prompts configured.');
      await mongoose.connection.close();
      return;
    }

    // ========================================
    // STEP 6: Create test jobs
    // ========================================
    console.log('🚀 STEP 6: Creating test jobs...\n');

    // Test Job 1: Immediate single test (instant API call)
    const testJob1 = {
      name: 'promptModelTester',
      type: 'normal',
      priority: 10,
      nextRunAt: new Date(),
      data: {
        workspaceId: WORKSPACE_ID,
        immediate: true
      },
      disabled: false,
      lockedAt: null,
      lastModifiedBy: null,
      lastRunAt: null,
      lastFinishedAt: null,
      failReason: null,
      failCount: 0,
      failedAt: null,
      repeatInterval: null
    };

    await db.collection('agendaJobs').insertOne(testJob1);
    console.log('✅ Test Job 1: Immediate single test (instant API call)');
    console.log('   - Job: promptModelTester');
    console.log('   - Mode: Immediate (will use direct API calls)');
    console.log('   - Scheduled: Now\n');

    // Test Job 2: Batch test (will use OpenAI or Vertex batch processing)
    const testJob2 = {
      name: 'promptModelTester',
      type: 'normal',
      priority: 10,
      nextRunAt: new Date(Date.now() + 10000), // 10 seconds from now
      data: {
        workspaceId: WORKSPACE_ID
      },
      disabled: false,
      lockedAt: null,
      lastModifiedBy: null,
      lastRunAt: null,
      lastFinishedAt: null,
      failReason: null,
      failCount: 0,
      failedAt: null,
      repeatInterval: '1 hour', // Recurring every hour
      repeatTimezone: null
    };

    await db.collection('agendaJobs').insertOne(testJob2);
    console.log('✅ Test Job 2: Recurring batch test (batch processing)');
    console.log('   - Job: promptModelTester');
    console.log('   - Mode: Recurring (will use batch processing)');
    console.log('   - First run: In 10 seconds');
    console.log('   - Repeat: Every 1 hour\n');

    // ========================================
    // STEP 7: Summary
    // ========================================
    console.log('=' .repeat(60));
    console.log('📊 RESET COMPLETE - Summary');
    console.log('=' .repeat(60));
    console.log(`Workspace: ${WORKSPACE_NAME} (${WORKSPACE_ID})`);
    console.log('');
    console.log('Cleaned up:');
    console.log(`  - ${oldJobsResult.deletedCount} old workspace jobs`);
    console.log(`  - ${pollJobResult.deletedCount} pollOpenAIBatches jobs`);
    console.log(`  - ${batchesResult.deletedCount} batches`);
    console.log(`  - ${notificationsResult.deletedCount} batch notifications`);
    console.log('');
    console.log('Created:');
    console.log('  - 1 immediate test job (runs now)');
    console.log('  - 1 recurring test job (runs in 10 seconds, repeats hourly)');
    console.log('');
    console.log('Configuration:');
    console.log(`  - ${brands.length} brands configured`);
    console.log(`  - ${models.length} models configured`);
    console.log(`  - ${prompts.length} prompts configured`);
    console.log('');
    console.log('Next steps:');
    console.log('  1. The batcher will pick up these jobs automatically');
    console.log('  2. Immediate job will run via instant API calls');
    console.log('  3. Recurring job will use batch processing (OpenAI/Vertex)');
    console.log('  4. Monitor batcher logs for job execution');
    console.log('  5. Check dashboard for results after jobs complete');
    console.log('=' .repeat(60));

    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

resetAndTestWorkspace();

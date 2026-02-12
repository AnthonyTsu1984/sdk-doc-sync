const { config } = require('./test.config');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');

async function run() {
    console.log('Bitable Writer Integration Tests\n');

    if (!config.hasTokens()) {
        console.log('Skipping — no tokens configured');
        return;
    }

    const writer = new BitableWriter({ baseToken: config.baseToken });

    // Test 1: Resolve table ID
    console.log('  Test: resolve table ID');
    const tableId = await writer._resolveTableId();
    console.log(`    Table ID: ${tableId}`);
    if (!tableId) throw new Error('Failed to resolve table ID');
    console.log('    PASS\n');

    // Test 2: List records
    console.log('  Test: list records');
    const records = await writer.listRecords();
    console.log(`    Found ${records.length} records`);
    console.log('    PASS\n');

    // Test 3: Create record
    console.log('  Test: create record');
    const testSlug = `test-sdk-sync-${Date.now()}`;
    const created = await writer.createRecord({
        title: 'SDK Sync Test Record',
        slug: testSlug,
        progress: 'Draft',
        addedSince: '0.0.1-test',
        description: 'Automated test record from sdk-doc-sync',
        keywords: 'test, sdk-sync',
        type: 'function',
        targets: 'test-sdk',
    });
    console.log(`    Created record: ${created.record_id}`);
    if (!created.record_id) throw new Error('Failed to create record');
    console.log('    PASS\n');

    // Test 4: Update record
    console.log('  Test: update record');
    const updated = await writer.updateRecord(created.record_id, {
        progress: 'Publish',
        description: 'Updated test record',
    });
    console.log(`    Updated record: ${updated.record_id}`);
    console.log('    PASS\n');

    console.log('All Bitable Writer tests passed!');
}

run().catch(err => {
    console.error('FAIL:', err.message);
    process.exit(1);
});

/**
 * Unit tests for BitableWriter._formatFields().
 *
 * Verifies field formatting conventions, especially the 父记录 (parent record)
 * field which must be a simple string array ["recordId"], not a complex object.
 */

const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');

function run() {
    const writer = new BitableWriter({ baseToken: 'dummy' });

    let passed = 0;
    let failed = 0;

    function assert(condition, message) {
        if (condition) {
            passed++;
        } else {
            failed++;
            console.error(`    FAIL: ${message}`);
        }
    }

    // ─── Test 1: parentRecordId → 父记录 as simple string array ───
    console.log('  Test: parentRecordId formats as simple string array');
    {
        const result = writer._formatFields({ parentRecordId: 'recABC123' });
        assert(Array.isArray(result['父记录']),
            '父记录 should be an array');
        assert(result['父记录'].length === 1,
            `父记录 should have 1 element, got ${result['父记录']?.length}`);
        assert(result['父记录'][0] === 'recABC123',
            `父记录[0] should be 'recABC123', got '${result['父记录']?.[0]}'`);
        assert(typeof result['父记录'][0] === 'string',
            '父记录[0] should be a plain string, not an object');
    }
    console.log('    PASS\n');

    // ─── Test 2: title + link → Docs hyperlink ───
    console.log('  Test: title + link → Docs hyperlink object');
    {
        const result = writer._formatFields({
            title: 'my_method()',
            link: 'https://example.com/docx/abc123',
        });
        assert(result['Docs']?.text === 'my_method()',
            `Docs.text should be 'my_method()', got '${result['Docs']?.text}'`);
        assert(result['Docs']?.link === 'https://example.com/docx/abc123',
            `Docs.link should be the URL`);
    }
    console.log('    PASS\n');

    // ─── Test 3: title only (no link) → plain string ───
    console.log('  Test: title only → plain string Docs');
    {
        const result = writer._formatFields({ title: 'my_method()' });
        assert(result['Docs'] === 'my_method()',
            `Docs should be plain string 'my_method()', got '${JSON.stringify(result['Docs'])}'`);
    }
    console.log('    PASS\n');

    // ─── Test 4: targets as string → wrapped in array ───
    console.log('  Test: targets string → wrapped in array');
    {
        const result = writer._formatFields({ targets: 'pymilvus' });
        assert(Array.isArray(result['Targets']),
            'Targets should be an array');
        assert(result['Targets'][0] === 'pymilvus',
            `Targets[0] should be 'pymilvus'`);
    }
    console.log('    PASS\n');

    // ─── Test 5: targets as array → passed through ───
    console.log('  Test: targets array → passed through');
    {
        const result = writer._formatFields({ targets: ['pymilvus', 'milvus'] });
        assert(result['Targets'].length === 2, 'should preserve array length');
        assert(result['Targets'][0] === 'pymilvus', 'first target');
        assert(result['Targets'][1] === 'milvus', 'second target');
    }
    console.log('    PASS\n');

    // ─── Test 6: deprecateSince field ───
    console.log('  Test: deprecateSince → Deprecate Since');
    {
        const result = writer._formatFields({ deprecateSince: 'v2.6.x' });
        assert(result['Deprecate Since'] === 'v2.6.x',
            `Deprecate Since should be 'v2.6.x'`);
    }
    console.log('    PASS\n');

    // ─── Test 7: slug is never set ───
    console.log('  Test: slug field is ignored (auto-populated by Feishu)');
    {
        const result = writer._formatFields({ slug: 'should-be-ignored' });
        assert(!result['Slug'], 'Slug should not be in formatted fields');
    }
    console.log('    PASS\n');

    // ─── Summary ───
    const total = passed + failed;
    if (failed > 0) {
        console.log(`\n${failed}/${total} assertions failed`);
        process.exit(1);
    }
    console.log(`All ${passed} assertions passed`);
}

run();

const DiffEngine = require('../src/sdk-doc-sync/diff-engine');

function assert(condition, message) {
    if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function makeSymbol(overrides = {}) {
    return {
        name: 'insert',
        kind: 'method',
        signature: 'def insert(self, data):',
        docstring: 'Insert data into a collection.',
        params: [],
        filePath: 'client.py',
        lineNumber: 10,
        parentClass: 'MilvusClient',
        decorators: [],
        returnType: null,
        baseClasses: [],
        ...overrides,
    };
}

function makeDoc(overrides = {}) {
    return {
        id: 'rec001',
        metadata: {
            title: 'insert()',
            slug: 'MilvusClient-insert',
            description: 'Insert data into a collection.',
            type: 'Function',
            added_since: 'v2.5.x',
            progress: 'Draft',
            targets: ['Milvus', 'Zilliz'],
            ...overrides.metadata,
        },
        ...overrides,
    };
}

function testCreateAction() {
    console.log('  Test: CREATE action for new symbol');

    const engine = new DiffEngine({ sdkVersion: 'v2.6.x' });
    const actions = engine.diff([makeSymbol()], []);

    assert(actions.length === 1, `Action count: ${actions.length}`);
    assert(actions[0].type === 'CREATE', `Action type: ${actions[0].type}`);
    assert(actions[0].slug === 'MilvusClient-insert', `Slug preserves casing: ${actions[0].slug}`);

    console.log('    PASS\n');
}

function testSkipAction() {
    console.log('  Test: SKIP action for unchanged symbol');

    const engine = new DiffEngine({ sdkVersion: 'v2.6.x' });
    const actions = engine.diff([makeSymbol()], [makeDoc()]);

    assert(actions.length === 1, `Action count: ${actions.length}`);
    assert(actions[0].type === 'SKIP', `Action type: ${actions[0].type}`);

    console.log('    PASS\n');
}

function testUpdateAction() {
    console.log('  Test: UPDATE action for changed description');

    const engine = new DiffEngine({ sdkVersion: 'v2.6.x' });
    const actions = engine.diff(
        [makeSymbol({ docstring: 'Insert vectors into a collection.' })],
        [makeDoc()]
    );

    assert(actions.length === 1, `Action count: ${actions.length}`);
    assert(actions[0].type === 'UPDATE', `Action type: ${actions[0].type}`);
    assert(actions[0].reason.includes('description'), `Reason: ${actions[0].reason}`);

    console.log('    PASS\n');
}

function testDeprecateByDecorator() {
    console.log('  Test: DEPRECATE action via @deprecated decorator');

    const engine = new DiffEngine({ sdkVersion: 'v2.6.x' });
    const actions = engine.diff(
        [makeSymbol({ decorators: ['@deprecated("Use upsert instead")'] })],
        [makeDoc()]
    );

    assert(actions.length === 1, `Action count: ${actions.length}`);
    assert(actions[0].type === 'DEPRECATE', `Action type: ${actions[0].type}`);

    console.log('    PASS\n');
}

function testAlreadyDeprecatedSkips() {
    console.log('  Test: already deprecated symbol is SKIP');

    const engine = new DiffEngine({ sdkVersion: 'v2.6.x' });
    const actions = engine.diff(
        [makeSymbol({ decorators: ['@deprecated("old")'] })],
        [makeDoc({ metadata: { slug: 'MilvusClient-insert', description: 'Insert data into a collection.', deprecate_since: 'v2.5.x' } })]
    );

    // Already deprecated — should SKIP, not DEPRECATE again
    assert(actions[0].type === 'SKIP', `Should SKIP already deprecated: ${actions[0].type}`);

    console.log('    PASS\n');
}

function testOrphanAction() {
    console.log('  Test: ORPHAN action for doc without matching symbol');

    const engine = new DiffEngine({ sdkVersion: 'v2.6.x' });
    const actions = engine.diff([], [makeDoc()]);

    assert(actions.length === 1, `Action count: ${actions.length}`);
    assert(actions[0].type === 'ORPHAN', `Action type: ${actions[0].type}`);

    console.log('    PASS\n');
}

function testTopLevelSymbolSlug() {
    console.log('  Test: top-level symbol slug (no parentClass)');

    const engine = new DiffEngine({ sdkVersion: 'v2.6.x' });
    const actions = engine.diff(
        [makeSymbol({ name: 'connect', parentClass: null, kind: 'function' })],
        [makeDoc({ metadata: { slug: 'connect', description: 'Connect to server.' } })]
    );

    assert(actions[0].slug === 'connect', `Top-level slug: ${actions[0].slug}`);

    console.log('    PASS\n');
}

function testMixedActions() {
    console.log('  Test: mix of CREATE, SKIP, UPDATE, ORPHAN');

    const engine = new DiffEngine({ sdkVersion: 'v2.6.x' });

    const symbols = [
        makeSymbol({ name: 'insert', parentClass: 'MilvusClient' }),
        makeSymbol({ name: 'search', parentClass: 'MilvusClient', docstring: 'Search for vectors.' }),
        makeSymbol({ name: 'delete', parentClass: 'MilvusClient', docstring: 'Changed description.' }),
    ];

    const docs = [
        makeDoc({ metadata: { slug: 'MilvusClient-insert', description: 'Insert data into a collection.' } }),
        makeDoc({ id: 'rec003', metadata: { slug: 'MilvusClient-delete', description: 'Delete entities.' } }),
        makeDoc({ id: 'rec004', metadata: { slug: 'MilvusClient-query', description: 'Query entities.' } }),
    ];

    const actions = engine.diff(symbols, docs);
    const types = actions.map(a => a.type);

    assert(types.includes('SKIP'), 'Should have SKIP (insert unchanged)');
    assert(types.includes('CREATE'), 'Should have CREATE (search is new)');
    assert(types.includes('UPDATE'), 'Should have UPDATE (delete changed)');
    assert(types.includes('ORPHAN'), 'Should have ORPHAN (query has no symbol)');

    console.log('    PASS\n');
}

async function run() {
    console.log('Diff Engine Tests\n');

    testCreateAction();
    testSkipAction();
    testUpdateAction();
    testDeprecateByDecorator();
    testAlreadyDeprecatedSkips();
    testOrphanAction();
    testTopLevelSymbolSlug();
    testMixedActions();

    console.log('All Diff Engine tests passed!');
}

run().catch(err => {
    console.error('FAIL:', err.message);
    process.exit(1);
});

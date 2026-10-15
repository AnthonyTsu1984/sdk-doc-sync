'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    SnapshotDumpError,
    buildSnapshot,
    dumpSnapshot,
    parseArgs,
    resolveBaseTable,
    rowsFromRecords,
} = require('../scripts/dump-bitable-snapshot');

// Deterministic clock face for snapshot assertions.
const FIXED_FETCHED_AT = '2026-10-15T00:00:00.000Z';

function mockClient({ tables, recordPages }) {
    const calls = [];
    return {
        calls,
        async paginate({ path: route }) {
            calls.push(route);
            if (route.endsWith('/tables')) return tables;
            if (route.includes('/records')) return (recordPages || []).flat();
            throw new SnapshotDumpError('SNAPSHOT_CLIENT_INVALID', `unexpected route ${route}`);
        },
    };
}

test('rowsFromRecords mirrors the tmp producer cell semantics (text join, link pick, parent JSON)', () => {
    const rows = rowsFromRecords([
        {
            record_id: 'recA',
            fields: {
                Slug: [{ text: 'v2-Client-Client' }],
                Type: 'Class',
                Docs: [{ text: 'Client', link: 'https://example.feishu.cn/docx/abc' }],
                '父记录': { record_ids: ['recRoot'] },
                Targets: 't1',
                Progress: 'done',
            },
        },
        {
            record_id: 'recB',
            fields: {
                Slug: 'bare-slug',
                Docs: [{ text: 'Doc A' }, { text: 'B' }],
                Parent: null,
            },
        },
    ]);
    assert.deepEqual(rows, [
        {
            recordId: 'recA',
            slug: 'v2-Client-Client',
            type: 'Class',
            title: 'Client',
            docLink: 'https://example.feishu.cn/docx/abc',
            parent: '{"record_ids":["recRoot"]}',
            targets: 't1',
            progress: 'done',
        },
        {
            recordId: 'recB',
            slug: 'bare-slug',
            type: '',
            title: 'Doc AB',
            docLink: '',
            parent: 'null',
            targets: '',
            progress: '',
        },
    ]);
});

test('dumpSnapshot lists the single table by default and paginates its records', async () => {
    const client = mockClient({
        tables: [{ table_id: 'tblOne', name: 'Only' }],
        recordPages: [[{ record_id: 'rec1', fields: { Slug: 'a' } }], [{ record_id: 'rec2', fields: { Slug: 'b' } }]],
    });
    const snapshot = await dumpSnapshot({
        client,
        track: 'v3.0.x',
        language: 'go',
        baseToken: 'baseA',
        fetchedAt: FIXED_FETCHED_AT,
    });
    assert.equal(snapshot.tableId, 'tblOne');
    assert.equal(snapshot.count, 2);
    assert.equal(snapshot.writesPerformed, false);
    assert.deepEqual(snapshot.rows.map((row) => row.slug), ['a', 'b']);
    assert.match(client.calls[0], /\/apps\/baseA\/tables$/);
    assert.match(client.calls[1], /\/tables\/tblOne\/records\?page_size=500$/);
});

test('dumpSnapshot refuses an untargeted dump against a multi-table base (default throw kept)', async () => {
    const client = mockClient({
        tables: [{ table_id: 'tbl1', name: 'A' }, { table_id: 'tbl2', name: 'B' }],
        recordPages: [],
    });
    await assert.rejects(
        () => dumpSnapshot({ client, track: 'v3.0.x', baseToken: 'baseA', fetchedAt: FIXED_FETCHED_AT }),
        (error) => error.code === 'BITABLE_TABLE_AMBIGUOUS'
            && /expected exactly 1 table, got 2/.test(error.message),
    );
});

test('--table-id bypasses the uniqueness branch and selects the named table', async () => {
    const client = mockClient({
        tables: [{ table_id: 'tbl1', name: 'A' }, { table_id: 'tbl2', name: 'B' }],
        recordPages: [[{ record_id: 'recB', fields: { Slug: 'fromB' } }]],
    });
    const snapshot = await dumpSnapshot({
        client,
        track: 'v3.0.x',
        baseToken: 'baseA',
        tableId: 'tbl2',
        fetchedAt: FIXED_FETCHED_AT,
    });
    assert.equal(snapshot.tableId, 'tbl2');
    assert.match(client.calls[1], /\/tables\/tbl2\/records/);
});

test('buildSnapshot output keys align with the four-campaign consumer surface', () => {
    const snapshot = buildSnapshot({
        track: 'v2.6.x',
        baseToken: 'baseB',
        tableId: null,
        records: [],
        fetchedAt: FIXED_FETCHED_AT,
    });
    assert.deepEqual(Object.keys(snapshot).sort(), [
        'baseToken', 'count', 'fetchedAt', 'rows', 'tableId', 'track', 'writesPerformed',
    ]);
    assert.equal(snapshot.writesPerformed, false);
    assert.equal(snapshot.tableId, null);
});

test('parseArgs requires --track, --output, and exactly one of --base-token/--language', () => {
    const args = parseArgs(['node', 'dump-bitable-snapshot.js', '--track', 'v3.0.x', '--language', 'go', '--output', 'out.json']);
    assert.equal(args.track, 'v3.0.x');
    assert.equal(args.language, 'go');
    assert.equal(args.output, 'out.json');

    assert.throws(() => parseArgs(['node', 'script', '--track', 'v3.0.x', '--base-token', 'b']), /Missing --output/);
    assert.throws(() => parseArgs(['node', 'script', '--output', 'o.json']), /Missing --track/);
    assert.throws(() => parseArgs(['node', 'script', '--track', 'v', '--output', 'o.json']), /Missing --base-token/);
    assert.throws(
        () => parseArgs(['node', 'script', '--track', 'v', '--output', 'o.json', '--base-token', 'b', '--language', 'go']),
        /not both/,
    );
    assert.throws(
        () => parseArgs(['node', 'script', '--track', 'v', '--output', 'o.json', '--wat', 'x']),
        /Unknown argument: --wat/,
    );
});

test('resolveBaseTable prefers explicit tokens and reverse-looks-up the registry from --language', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bitable-snapshot-registry-'));
    const registryPath = path.join(temp, 'registry.json');
    fs.writeFileSync(registryPath, JSON.stringify({
        schemaVersion: 1,
        languages: {
            go: {
                tracks: [
                    { version: 'v2.6.x', bitable: { baseToken: 'baseV26', tableId: 'tblV26' }, drive: { releaseRoot: { resolution: 'unresolved' } } },
                    { version: 'v3.0.x', bitable: { baseToken: 'baseV30' }, drive: { releaseRoot: { resolution: 'unresolved' } } },
                ],
            },
        },
    }));

    const explicit = resolveBaseTable({
        args: { baseToken: 'baseX', tableId: 'tblX', language: null, track: 'v3.0.x', registry: null },
    });
    assert.deepEqual(explicit, { baseToken: 'baseX', tableId: 'tblX', source: 'explicit' });

    const resolved = resolveBaseTable({
        args: { baseToken: null, tableId: null, language: 'go', track: 'v3.0.x', registry: registryPath },
    });
    assert.deepEqual(resolved, { baseToken: 'baseV30', tableId: null, source: 'registry' });

    // Registry tableId resolves when present; an explicit --table-id still wins.
    const withTable = resolveBaseTable({
        args: { baseToken: null, tableId: 'tblOverride', language: 'go', track: 'v2.6.x', registry: registryPath },
    });
    assert.deepEqual(withTable, { baseToken: 'baseV26', tableId: 'tblOverride', source: 'registry' });

    assert.throws(
        () => resolveBaseTable({ args: { baseToken: null, language: 'go', track: 'v9.9.x', registry: registryPath } }),
        (error) => error.code === 'TRACK_REGISTRY_TRACK_NOT_REGISTERED',
    );
});

test('a registry track whose base token never resolves is refused fail-closed at load', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bitable-snapshot-registry-'));
    const registryPath = path.join(temp, 'registry.json');
    // `{ env: ... }` identity that never resolves in the test environment.
    fs.writeFileSync(registryPath, JSON.stringify({
        schemaVersion: 1,
        languages: {
            go: {
                tracks: [
                    { version: 'v3.0.x', bitable: { baseToken: { env: 'DEFINITELY_UNSET_VAR_42' } }, drive: { releaseRoot: { resolution: 'unresolved' } } },
                ],
            },
        },
    }));
    // The registry loader itself is the fail-closed gate: an unresolvable
    // base token never reaches the dump.
    assert.throws(
        () => resolveBaseTable({ args: { baseToken: null, language: 'go', track: 'v3.0.x', registry: registryPath } }),
        (error) => error.code === 'TRACK_REGISTRY_INVALID'
            && /TRACK_REGISTRY_BASE_TOKEN_REQUIRED/.test(error.message),
    );
});

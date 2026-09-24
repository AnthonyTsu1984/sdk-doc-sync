'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { reconcileIdentityCoverage, identityEntryDrafts } = require('../src/sdk-doc-sync/identity-reconciliation');
const { runCli } = require('../bin/identity-reconcile');

function recordsFixture() {
    return [
        { record_id: 'rec-1', slug: 'Collections-HasCollection', fields: { Type: 'Function' } },
        { record_id: 'rec-2', slug: 'Collections-CreateCollection', fields: { Type: 'Function' } },
        { record_id: 'rec-3', slug: 'Snapshots', type: 'VirtualNode' },
        { record_id: 'rec-4', slug: 'CDC', fields: { Type: 'Function' } },
        { record_id: 'rec-5', slug: 'ResourceGroup-CreateResourceGroup', fields: { Type: 'Function', Docs: { link: 'https://example.feishu.cn/docx/doc-rg' } } },
    ];
}

function mapFixture(covered) {
    const symbols = {};
    for (const key of covered) {
        const dash = key.indexOf('.');
        symbols[key] = {
            stableId: `cpp:${key.slice(0, dash)}:${key.slice(dash + 1)}`,
            canonicalSlug: key.replace('.', '-'),
            category: key.slice(0, dash),
        };
    }
    return { schemaVersion: 1, language: 'cpp', track: 'v3.0.x', symbols };
}

test('reconcileIdentityCoverage reports governed slugs that resolve to no identity', () => {
    const report = reconcileIdentityCoverage({
        records: recordsFixture(),
        identityMap: mapFixture(['Collections.CreateCollection', 'ResourceGroup.CreateResourceGroup']),
    });

    assert.equal(report.checked, 3); // bare 'CDC' and VirtualNode 'Snapshots' excluded
    assert.deepEqual(report.missing, ['Collections-HasCollection']);
    assert.equal(report.diagnostics.length, 1);
    assert.equal(report.diagnostics[0].code, 'IDENTITY_MAP_INCOMPLETE');
    assert.equal(report.diagnostics[0].level, 'warn');
    assert.deepEqual(report.diagnostics[0].slugs, ['Collections-HasCollection']);
});

test('reconcileIdentityCoverage reports map keys no record represents as extras', () => {
    const report = reconcileIdentityCoverage({
        records: recordsFixture(),
        identityMap: mapFixture(['Collections.CreateCollection', 'ResourceGroup.CreateResourceGroup', 'Vector.Delete']),
    });

    assert.deepEqual(report.missing, ['Collections-HasCollection']);
    assert.deepEqual(report.extras, ['Vector.Delete']);
});

test('empty record input produces no diagnostics', () => {
    const report = reconcileIdentityCoverage({ records: [], identityMap: mapFixture(['Collections.CreateCollection']) });
    assert.equal(report.checked, 0);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.diagnostics, []);
});

test('identityEntryDrafts derives evidence-backed entries from governed records', () => {
    const { entries, evidence } = identityEntryDrafts({
        records: recordsFixture(),
        missing: ['Collections-HasCollection', 'ResourceGroup-CreateResourceGroup'],
    });

    // Drafts derive for whatever the reconciliation reported missing — the
    // caller passes reconcileIdentityCoverage().missing verbatim.
    assert.equal(entries.length, 2);
    assert.deepEqual(entries[0], {
        key: 'Collections.HasCollection',
        entry: {
            stableId: 'cpp:Collections:HasCollection',
            canonicalSlug: 'Collections-HasCollection',
            category: 'Collections',
        },
    });
    assert.deepEqual(entries[1].key, 'ResourceGroup.CreateResourceGroup');
    assert.equal(evidence[0].recordId, 'rec-1');
    assert.equal(evidence[1].docLink, 'https://example.feishu.cn/docx/doc-rg');
});

test('identity-reconcile CLI writes the draft and exits 1 under --strict on drift', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-reconcile-'));
    const snapshotPath = path.join(directory, 'snapshot.json');
    const mapPath = path.join(directory, 'map.json');
    const draftPath = path.join(directory, 'draft.json');
    fs.writeFileSync(snapshotPath, JSON.stringify({ rows: recordsFixture() }));
    fs.writeFileSync(mapPath, JSON.stringify(mapFixture(['Collections.CreateCollection'])));

    const code = runCli({
        argv: [
            'node', 'identity-reconcile',
            '--snapshot', snapshotPath,
            '--identity-map', mapPath,
            '--emit-draft', draftPath,
            '--strict',
        ],
    });

    assert.equal(code, 1);
    const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
    assert.equal(draft.missingSlugs.length, 2);
    assert.equal(draft.entries.length, 2);
    assert.equal(draft.entries[0].entry.canonicalSlug, 'Collections-HasCollection');
    assert.equal(draft.evidence[0].recordId, 'rec-1');
});

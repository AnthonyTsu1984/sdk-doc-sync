'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { reconcileTreeDelta } = require('../src/sdk-doc-sync/tree-delta-reconciliation');
const {
    assertKnownTrackKeys,
    loadChangedIdentities,
    pairChangedIdentities,
} = require('../scripts/reconcile-tree-delta');

const SHARED_TOKEN = 'doc-load-partitions-shared';
const SLUG = 'Partitions-LoadPartitions';

function record(recordId, slug, documentToken, type = 'Function') {
    return {
        recordId,
        slug,
        documentToken,
        link: documentToken ? `https://zilliverse.feishu.cn/docx/${documentToken}` : null,
        type,
    };
}

function pairState({ baselineToken = SHARED_TOKEN, targetToken = SHARED_TOKEN } = {}) {
    return {
        baselineRecords: [record('rec-v26', SLUG, baselineToken)],
        targetRecords: [record('rec-v30', SLUG, targetToken)],
        targetFolders: [],
        categoryNodes: [],
        tokenReferences: { [SHARED_TOKEN]: ['rec-v26', 'rec-v30'] },
        evidenceInputs: { baselineTrack: 'v2.6.x', targetTrack: 'v3.0.x' },
    };
}

test('a target-track classification escalates a still-shared changed identity to an error finding', () => {
    const pair = pairChangedIdentities({ 'v3.0.x': [SLUG] }, 'v2.6.x', 'v3.0.x');
    const classified = reconcileTreeDelta({
        ...pairState(),
        changedIdentities: pair.changed,
        mustRepointIdentities: pair.mustRepoint,
    });
    const finding = classified.findings.find((entry) => entry.code === 'TREE_DELTA_CHANGED_NOT_REPOINTED');
    assert.ok(finding, 'expected the wake-up finding');
    assert.equal(finding.severity, 'error');
    assert.equal(classified.ok, false);

    // Without any classification the same live shape stays advisory.
    const unclassified = reconcileTreeDelta(pairState());
    assert.equal(unclassified.findings.some((entry) => entry.code === 'TREE_DELTA_CHANGED_NOT_REPOINTED'), false);
    assert.equal(unclassified.ok, true);
});

test('a baseline-only classification keeps a still-shared changed identity advisory (issue #76 case 1)', () => {
    // The source track's own update flowed in place: still-shared is the
    // correct post-release state, so the finding must not fail the run.
    const pair = pairChangedIdentities({ 'v2.6.x': [SLUG] }, 'v2.6.x', 'v3.0.x');
    const report = reconcileTreeDelta({
        ...pairState(),
        changedIdentities: pair.changed,
        mustRepointIdentities: pair.mustRepoint,
    });
    const finding = report.findings.find((entry) => entry.code === 'TREE_DELTA_CHANGED_NOT_REPOINTED');
    assert.ok(finding, 'expected the advisory finding');
    assert.equal(finding.severity, 'warn');
    assert.equal(report.ok, true);
});

test('direct callers passing only changedIdentities keep the escalate-on-classified behavior', () => {
    const report = reconcileTreeDelta({
        ...pairState(),
        changedIdentities: new Set([SLUG]),
    });
    const finding = report.findings.find((entry) => entry.code === 'TREE_DELTA_CHANGED_NOT_REPOINTED');
    assert.equal(finding.severity, 'error');
    assert.equal(report.ok, false);
});

test('a classified changed identity with a target-local document is the expected post-transition state', () => {
    const pair = pairChangedIdentities({ 'v2.6.x': [SLUG], 'v3.0.x': [SLUG] }, 'v2.6.x', 'v3.0.x');
    const report = reconcileTreeDelta({
        ...pairState({ targetToken: 'doc-load-partitions-v30' }),
        changedIdentities: pair.changed,
        mustRepointIdentities: pair.mustRepoint,
    });
    assert.equal(report.findings.some((entry) => entry.code === 'TREE_DELTA_CHANGED_NOT_REPOINTED'), false);
    assert.equal(report.findings.some((entry) => entry.code === 'TREE_DELTA_UNCHANGED_DIVERGENT'), false);
    assert.equal(report.ok, true);
});

test('an unclassified identity with a target-local document still surfaces the divergent warning', () => {
    const report = reconcileTreeDelta({
        ...pairState({ targetToken: 'doc-load-partitions-v30' }),
        changedIdentities: new Set(),
    });
    const finding = report.findings.find((entry) => entry.code === 'TREE_DELTA_UNCHANGED_DIVERGENT');
    assert.ok(finding, 'expected the divergent candidate warning');
    assert.equal(finding.severity, 'warn');
    assert.equal(report.ok, true);
});

test('changedIdentities escalates a missing target record to an error finding', () => {
    const state = pairState();
    state.targetRecords = [];
    state.tokenReferences = { [SHARED_TOKEN]: ['rec-v26'] };
    const report = reconcileTreeDelta({
        ...state,
        changedIdentities: new Set([SLUG]),
    });
    const finding = report.findings.find((entry) => entry.code === 'TREE_DELTA_TARGET_RECORD_MISSING');
    assert.ok(finding, 'expected the missing-record finding');
    assert.equal(finding.severity, 'error');
    assert.equal(report.ok, false);
});

test('loadChangedIdentities validates the classification artifact and dedupes slugs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-changed-'));
    const filePath = path.join(dir, 'changed.json');
    fs.writeFileSync(filePath, JSON.stringify({
        'v2.6.x': [SLUG, SLUG, 'Collections-Load'],
        'v3.0.x': ['Database-DescribeReplicas'],
    }));

    const byTrack = loadChangedIdentities(filePath);
    assert.deepEqual(byTrack['v2.6.x'], [SLUG, 'Collections-Load']);
    assert.deepEqual(byTrack['v3.0.x'], ['Database-DescribeReplicas']);

    assert.throws(() => loadChangedIdentities(path.join(dir, 'missing.json')), /unreadable/);
    fs.writeFileSync(filePath, '{not json');
    assert.throws(() => loadChangedIdentities(filePath), /not valid JSON/);
    fs.writeFileSync(filePath, JSON.stringify(['Partitions-LoadPartitions']));
    assert.throws(() => loadChangedIdentities(filePath), /JSON object mapping track version/);
    fs.writeFileSync(filePath, JSON.stringify({ 'v2.6.x': ['ok', ''] }));
    assert.throws(() => loadChangedIdentities(filePath), /array of non-empty slugs/);
    fs.writeFileSync(filePath, JSON.stringify({ 'v2.6.x': 'Partitions-LoadPartitions' }));
    assert.throws(() => loadChangedIdentities(filePath), /array of non-empty slugs/);
});

test('pairChangedIdentities splits escalation from suppression', () => {
    const pair = pairChangedIdentities({
        'v2.6.x': ['Partitions-LoadPartitions'],
        'v3.0.x': ['Database-DescribeReplicas'],
        'v2.5.x': ['Somewhere-Else'],
    }, 'v2.6.x', 'v3.0.x');
    assert.deepEqual([...pair.changed].sort(), ['Database-DescribeReplicas', 'Partitions-LoadPartitions']);
    // Only the target track's classification demands a repoint.
    assert.deepEqual([...pair.mustRepoint], ['Database-DescribeReplicas']);
    const empty = pairChangedIdentities({}, 'v2.6.x', 'v3.0.x');
    assert.equal(empty.changed.size, 0);
    assert.equal(empty.mustRepoint.size, 0);
});

test("assertKnownTrackKeys fails closed on typo'd track versions but accepts other languages' tracks", () => {
    const registry = { languages: {
        python: { tracks: [{ version: 'v2.6.x' }, { version: 'v3.0.x' }] },
        cpp: { tracks: [{ version: 'v2.4.x' }, { version: 'v2.5.x' }] },
    } };
    assertKnownTrackKeys(registry, { 'v2.6.x': ['Slug-One'] });
    // Another language's track version is registered, so a multi-language
    // artifact reconciled for one language does not trip.
    assertKnownTrackKeys(registry, { 'v2.4.x': ['Slug-One'] });
    assert.throws(
        () => assertKnownTrackKeys(registry, { 'v2.6x': ['Slug-One'] }),
        /unknown track version\(s\): v2\.6x/,
    );
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { reconcileTreeDelta } = require('../src/sdk-doc-sync/tree-delta-reconciliation');
const {
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

test('changedIdentities escalates a still-shared changed identity to an error finding', () => {
    const classified = reconcileTreeDelta({
        ...pairState(),
        changedIdentities: new Set([SLUG]),
    });
    const finding = classified.findings.find((entry) => entry.code === 'TREE_DELTA_CHANGED_NOT_REPOINTED');
    assert.ok(finding, 'expected the wake-up finding');
    assert.equal(finding.severity, 'error');
    assert.equal(classified.ok, false);

    // Without the classification the same live shape stays advisory.
    const unclassified = reconcileTreeDelta(pairState());
    assert.equal(unclassified.findings.some((entry) => entry.code === 'TREE_DELTA_CHANGED_NOT_REPOINTED'), false);
    assert.equal(unclassified.ok, true);
});

test('a classified changed identity with a target-local document is the expected post-transition state', () => {
    const report = reconcileTreeDelta({
        ...pairState({ targetToken: 'doc-load-partitions-v30' }),
        changedIdentities: new Set([SLUG]),
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

test('pairChangedIdentities unions both tracks of the pair', () => {
    const union = pairChangedIdentities({
        'v2.6.x': ['Partitions-LoadPartitions'],
        'v3.0.x': ['Database-DescribeReplicas'],
        'v2.5.x': ['Somewhere-Else'],
    }, 'v2.6.x', 'v3.0.x');
    assert.deepEqual([...union].sort(), ['Database-DescribeReplicas', 'Partitions-LoadPartitions']);
    assert.deepEqual([...pairChangedIdentities({}, 'v2.6.x', 'v3.0.x')], []);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { verbatimContentDigest } = require('../src/sdk-doc-sync/verbatim-content');
const { planPolishBlockEdits, PolishApplyError } = require('../src/sdk-doc-sync/pr-polish-apply');
const { runCli } = require('../bin/pr-polish-apply');

const BASE_CONTENT = 'Starts the telemetry exporter for this client instance.\n\nThe exporter batches span uploads and flushes them on a fixed interval, which keeps the request path free of telemetry stalls.\n\nCall this once during application startup, before any collection operations are issued, so that early operations are captured as well.\n\n*Returns:* nothing.\n';

const BLOCKS = [
    { block_id: 'page', block_type: 1 },
    { block_id: 'blk-head', block_type: 3, heading: {} },
    { block_id: 'blk-a', block_type: 2, text: { elements: [{ text_run: { content: 'A collection alias is an additional name for a collection.' } }] } },
    { block_id: 'blk-code', block_type: 12, code: {} },
    { block_id: 'blk-b', block_type: 2, text: { elements: [{ text_run: { content: 'In Milvus, a collection alias is globally unique.' } }] } },
];

test('planPolishBlockEdits maps each unique anchor to exactly one prose block', () => {
    const planned = planPolishBlockEdits(BLOCKS, [
        { anchor: 'additional name for a collection', replacement: 'extra name for a collection' },
        { anchor: 'globally unique', replacement: 'globally unique across collections' },
    ]);
    assert.deepEqual(planned.map((edit) => edit.blockId), ['blk-a', 'blk-b']);
    assert.equal(planned[0].contentAfter, 'A collection alias is an extra name for a collection.');
});

test('planPolishBlockEdits refuses missing, ambiguous, multi-block, and colliding anchors', () => {
    assert.throws(
        () => planPolishBlockEdits(BLOCKS, [{ anchor: 'not present anywhere', replacement: 'x' }]),
        (error) => error.code === 'PR_POLISH_ANCHOR_NOT_FOUND',
    );
    // 'collection alias' (case-sensitive) appears in both prose blocks.
    assert.throws(
        () => planPolishBlockEdits(BLOCKS, [{ anchor: 'collection alias', replacement: 'x' }]),
        (error) => error.code === 'PR_POLISH_ANCHOR_NOT_UNIQUE',
    );
    // Two edits targeting the same prose block collide.
    try {
        planPolishBlockEdits(BLOCKS, [
            { anchor: 'A collection alias', replacement: 'A collection alias' },
            { anchor: 'additional name', replacement: 'extra name' },
        ]);
        assert.fail('expected PR_POLISH_EDITS_COLLIDE');
    } catch (error) {
        assert.equal(error.code, 'PR_POLISH_EDITS_COLLIDE');
    }
});

function writeSessionFixture(directory, { withPending = true } = {}) {
    const session = {
        schemaVersion: 1,
        sessionId: 'sdk-doc-sync:java:milvus-sdk-java:v3.0.x:pr-polish-test',
        language: 'java',
        sdkName: 'milvus-sdk-java',
        track: 'v3.0.x',
        status: 'in_progress',
        scanStateUpdated: false,
        reviewUnitManifest: { schemaVersion: 1, manifestDigest: 'sha256:m', units: [] },
        reviewUnitManifestDigest: 'sha256:m',
        acceptedReviewUnits: [],
        pendingExecutions: [],
        activeExecution: null,
        rollbackReceipts: [],
        changeRequests: [],
    };
    const entries = [
        { schemaVersion: 1, type: 'prepared', batchDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', actionId: 'java:v2-Client:startTelemetry' },
        { schemaVersion: 1, type: 'observed', batchDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', actionId: 'java:v2-Client:startTelemetry', status: 'success', verified: true },
        {
            schemaVersion: 1, type: 'content-fidelity', batchDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            actionId: 'java:v2-Client:startTelemetry', invariantId: 'api.pr-verbatim-content',
            decision: 'PR_VERBATIM_REBUILD', documentToken: 'doc-polish', ok: true, errors: [],
            contentDigest: verbatimContentDigest(BASE_CONTENT),
        },
        { schemaVersion: 1, type: 'completion', batchDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', status: 'executed', completionSentinel: true },
    ];
    const journalPath = path.join(directory, 'execution.jsonl');
    fs.writeFileSync(journalPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
    const journalDigest = require('../../doc-ops-core/src/digest').digestSemantic(entries);
    if (withPending) {
        session.pendingExecutions = [{
            reviewUnitId: 'review:java:v2-Client:startTelemetry',
            executionJournalPath: journalPath,
            executionJournalDigest: journalDigest,
            executedAt: '2026-09-30T00:00:00.000Z',
        }];
    }
    const sessionPath = path.join(directory, 'session.json');
    fs.writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`);
    return { sessionPath, journalPath, journalEntries: entries };
}

test('pr-polish-apply runCli applies a validated manifest through injected ops and journals the terminal proof', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-polish-apply-'));
    const baseContent = BASE_CONTENT;
    const { sessionPath, journalEntries } = writeSessionFixture(directory);
    const fidelityEntry = journalEntries.find((entry) => entry.type === 'content-fidelity');
    const fidelityPath = path.join(directory, 'fidelity.json');
    fs.writeFileSync(fidelityPath, JSON.stringify(fidelityEntry));
    const basePath = path.join(directory, 'base.md');
    fs.writeFileSync(basePath, baseContent);
    const manifest = {
        schemaVersion: 1,
        baseContentDigest: verbatimContentDigest(baseContent),
        rationale: 'first-sentence polish',
        edits: [
            { anchor: 'Starts the telemetry exporter for this client instance.', replacement: 'Starts the telemetry exporter for this client.' },
        ],
    };
    const manifestPath = path.join(directory, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    // The evidence file is keyed by unit and content-sensitive: a prior run's
    // artifact (e.g. from an earlier test pass) is moved aside per the
    // documented operator procedure.
    const evidencePath = path.join(process.cwd(), 'tmp', 'api-reference-sync', 'run-manifest-pr-polish-apply-review-java-v2-Client-startTelemetry.json');
    if (fs.existsSync(evidencePath)) fs.rmSync(evidencePath);
    const patches = [];
    const result = await runCli({
        argv: [
            'node', 'pr-polish-apply', 'apply',
            '--session', sessionPath,
            '--review-unit-id', 'review:java:v2-Client:startTelemetry',
            '--base-content', basePath,
            '--fidelity-outcome', fidelityPath,
            '--manifest', manifestPath,
            '--polished-output', path.join(directory, 'polished.md'),
            '--provenance-output', path.join(directory, 'provenance.json'),
            '--journal', path.join(directory, 'polish.jsonl'),
            '--approve-digest', 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            '--doc-token', 'doc-polish',
            '--json',
        ],
        env: {},
        dependencies: {
            fetchBlocks: async () => ([
                { block_id: 'blk-1', block_type: 2, text: { elements: [{ text_run: { content: 'Starts the telemetry exporter for this client instance.' } }] } },
            ]),
            patchTextBlock: async (token, blockId, content) => {
                patches.push({ blockId, content });
            },
            fetchRawContent: async () => 'startTelemetry()\nStarts the telemetry exporter for this client.\n\nThe exporter batches span uploads and flushes them on a fixed interval, which keeps the request path free of telemetry stalls.\n\nCall this once during application startup, before any collection operations are issued, so that early operations are captured as well.\n\n*Returns:* nothing.\n',
        },
    });

    assert.equal(result.status, 'POLISHED');
    assert.equal(result.appliedEdits, 1);
    assert.deepEqual(patches, [{ blockId: 'blk-1', content: 'Starts the telemetry exporter for this client.' }]);
    assert.ok(fs.existsSync(path.join(directory, 'polished.md')));
    const provenance = JSON.parse(fs.readFileSync(path.join(directory, 'provenance.json'), 'utf8'));
    assert.equal(provenance.manifestDigest, manifest.baseContentDigest.replace('x', 'x') && provenance.manifestDigest);
    const journalLines = fs.readFileSync(path.join(directory, 'polish.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(journalLines[0].type, 'prepared');
    assert.equal(journalLines[journalLines.length - 1].polishSentinel, true);
});

test('pr-polish-apply refuses a digest that does not match the executed batch', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-polish-apply-bad-'));
    const { sessionPath, journalEntries } = writeSessionFixture(directory);
    const fidelityPath = path.join(directory, 'fidelity.json');
    fs.writeFileSync(fidelityPath, JSON.stringify(journalEntries.find((entry) => entry.type === 'content-fidelity')));
    await assert.rejects(
        () => runCli({
            argv: [
                'node', 'pr-polish-apply', 'apply',
                '--session', sessionPath,
                '--review-unit-id', 'review:java:v2-Client:startTelemetry',
                '--base-content', path.join(directory, 'base.md'),
                '--fidelity-outcome', fidelityPath,
                '--manifest', path.join(directory, 'manifest.json'),
                '--polished-output', path.join(directory, 'p.md'),
                '--provenance-output', path.join(directory, 'pr.json'),
                '--journal', path.join(directory, 'j.jsonl'),
                '--approve-digest', 'sha256:wrong-batch',
            ],
            env: {},
            dependencies: {},
        }),
        /Polish approval digest mismatch/,
    );
});

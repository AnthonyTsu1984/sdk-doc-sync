'use strict';

// Tests for scripts/revision-unit-digests.js (batch 16 slice 7, design §5.6 P1
// "评审红利" + §10 slice 7): one pass over session/scope/contexts produces the
// per-unit {reviewUnitId, batchDigest} set record-campaign-approval consumes
// through --unit-digests.
//
// Fixtures (scopeFixture / contextsFixture / the session creation helper) are
// copied from revision-campaign.test.js's fixture builders and extended with a
// second unit so the canonical ordering has something to prove.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { digestSemantic } = require('../../doc-ops-core/src/digest');
const {
    createReviewSession,
    saveReviewSession,
} = require('../src/sdk-doc-sync/review-session-store');
// Anti-drift: the digests must be byte-for-byte what the executor later
// re-derives, so the comparison calls bin/revision-apply's own functions.
const { buildRevisionBatch, sourcesFromContext } = require('../bin/revision-apply');
const { runCli } = require('../scripts/revision-unit-digests');

const SCRIPT_PATH = path.resolve(__dirname, '..', 'scripts', 'revision-unit-digests.js');

// --- fixtures (copied from tests/revision-campaign.test.js) ---

const STABLE_ID = 'java:v3-LexicalHighlighter';
const UNIT_ID = `review:${STABLE_ID}`;
const STABLE_ID_B = 'java:v3-MergeManager';
const UNIT_ID_B = `review:${STABLE_ID_B}`;
const FIXED_CONTENT = [
    'A LexicalHighlighter instance highlights query terms in search results.',
    '',
    'It collects matched segments so callers can render them.',
    '',
    'The highlighted segments preserve the original term order.',
    '',
].join('\n');
const FIXED_CONTENT_B = [
    'A MergeManager merges result sets from multiple shards.',
    '',
    'Merged results keep a stable ordering key.',
    '',
].join('\n');

function scopeAction({ stableId, symbol, documentToken, recordId }) {
    return {
        stableId,
        symbol,
        type: 'UPDATE',
        reason: 'RETURNS_MIN_DEPTH',
        canonicalSlug: symbol,
        documentToken,
        recordId,
        shared: false,
        sharedWith: [],
        source: { repository: 'milvus-sdk-java', revision: 'v3.0.10' },
        evidence: [{ kind: 'conformance', confidence: 'direct', locator: `feishu-docx:${documentToken}`, revision: 'v3.0.10', codes: ['RETURNS_MIN_DEPTH'] }],
        documentationOwnership: { classification: 'existing-page-content-revision' },
        defects: [{ code: 'RETURNS_MIN_DEPTH', detail: 'detail', severity: 'error' }],
    };
}

function scopeFixture() {
    return {
        schemaVersion: 1,
        kind: 'java-revision-scope',
        language: 'java',
        sdkName: 'milvus-sdk-java',
        track: 'v3.0.x',
        baselineRevision: 'v3.0.10',
        targetRevision: 'v3.0.10',
        generatedAt: '2026-10-05T00:00:00.000Z',
        ruling: 'test ruling',
        sharedPagesPolicy: 'update-in-place',
        sweep: { generatedAt: '2026-10-05T00:00:00.000Z', digest: 'sha256:' + 'a'.repeat(64) },
        actions: [
            // Deliberately NOT in canonical reviewUnitId order: the script must
            // emit digests sorted by reviewUnitId regardless of session order.
            scopeAction({ stableId: STABLE_ID_B, symbol: 'MergeManager', documentToken: 'tokB', recordId: 'recB' }),
            scopeAction({ stableId: STABLE_ID, symbol: 'LexicalHighlighter', documentToken: 'tokA', recordId: 'recA' }),
        ],
        sharedPages: [],
        topologyAudit: { invariantId: 'api.same-name-sibling-placement', unresolvedTracks: [], summary: null },
        summary: { pages: 2, byCode: { RETURNS_MIN_DEPTH: 2 } },
    };
}

function contextsFixture() {
    return {
        contexts: {
            [STABLE_ID]: {
                category: 'v3-Utility',
                kind: 'class',
                symbolName: 'LexicalHighlighter',
                title: 'LexicalHighlighter',
                summary: 'A LexicalHighlighter instance highlights query terms in search results.',
                repository: 'milvus-sdk-java',
                revision: 'v3.0.10',
                reviewedEvidence: [
                    { kind: 'conformance', confidence: 'direct', locator: 'feishu-docx:tokA', revision: 'v3.0.10', codes: ['RETURNS_MIN_DEPTH'] },
                ],
                verbatimContent: FIXED_CONTENT,
            },
            [STABLE_ID_B]: {
                category: 'v3-Utility',
                kind: 'class',
                symbolName: 'MergeManager',
                title: 'MergeManager',
                summary: 'A MergeManager merges result sets from multiple shards.',
                repository: 'milvus-sdk-java',
                revision: 'v3.0.10',
                // A kind==='source' item with a tableHeader rides the digest
                // through sourcesFromContext (the executor's table-citation
                // projection).
                reviewedEvidence: [
                    { kind: 'source', tableHeader: ['Parameter', 'Type'], path: 'java/io/milvus/MergeManager.java', lines: [41, 88] },
                ],
                verbatimContent: FIXED_CONTENT_B,
            },
        },
    };
}

function writeJson(directory, name, value) {
    const filePath = path.join(directory, name);
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
    return filePath;
}

function writeSessionFixture(directory, scope, { fileName = 'review-session.json' } = {}) {
    // Same manifest construction as revision-campaign.test.js sessionManifestFor,
    // but the units array is kept in the given (non-canonical) order so the
    // script's canonical re-sorting is observable.
    const manifestSemantic = {
        schemaVersion: 1,
        units: scope.actions.map((action) => ({
            reviewUnitId: `review:${action.stableId}`,
            documentStableId: action.stableId,
            prerequisiteReviewUnitIds: [],
        })),
    };
    const manifest = { ...manifestSemantic, manifestDigest: digestSemantic(manifestSemantic) };
    const session = createReviewSession({
        sessionId: `java-revision:milvus-sdk-java:v3.0.10:${manifest.manifestDigest}`,
        language: 'java',
        sdkName: 'milvus-sdk-java',
        track: 'v3.0.x',
        reviewUnitManifest: manifest,
        acceptanceFlow: 'two-gate',
        placementWalk: null,
    });
    const sessionPath = path.join(directory, fileName);
    saveReviewSession(sessionPath, session, { expectedPreviousDigest: null });
    return sessionPath;
}

function materialize(directory, { scope = scopeFixture(), contexts = contextsFixture() } = {}) {
    return {
        scopePath: writeJson(directory, 'scope.json', scope),
        contextsPath: writeJson(directory, 'contexts.json', contexts),
        sessionPath: writeSessionFixture(directory, scope),
    };
}

function spawnCli(args) {
    return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { encoding: 'utf8' });
}

function expectedDigest(stableId, contexts) {
    const entry = contexts.contexts[stableId];
    return buildRevisionBatch({
        stableId,
        reviewUnitId: `review:${stableId}`,
        documentToken: stableId === STABLE_ID ? 'tokA' : 'tokB',
        recordId: stableId === STABLE_ID ? 'recA' : 'recB',
        fixedContent: entry.verbatimContent,
        sources: sourcesFromContext(entry),
    }).batchDigest;
}

// --- tests ---

test('revision-unit-digests emits every unit digest once, canonically sorted, equal to buildRevisionBatch', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-unit-digests-'));
    try {
        const { scopePath, contextsPath, sessionPath } = materialize(directory);
        const outPath = path.join(directory, 'unit-digests.json');
        const result = runCli({
            argv: ['node', 'revision-unit-digests', '--session', sessionPath, '--scope', scopePath, '--contexts', contextsPath, '--out', outPath],
        });

        assert.equal(result.count, 2);
        assert.deepEqual(result.digests.map((entry) => entry.reviewUnitId), [UNIT_ID, UNIT_ID_B]);
        for (const entry of result.digests) {
            assert.deepEqual(Object.keys(entry).sort(), ['batchDigest', 'reviewUnitId']);
        }
        assert.equal(result.digests[0].batchDigest, expectedDigest(STABLE_ID, contextsFixture()));
        assert.equal(result.digests[1].batchDigest, expectedDigest(STABLE_ID_B, contextsFixture()));

        const onDisk = JSON.parse(fs.readFileSync(outPath, 'utf8'));
        assert.deepEqual(onDisk, result.digests);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('revision-unit-digests is deterministic: two runs with the same input are byte-identical (file and stdout)', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-unit-digests-det-'));
    try {
        const { scopePath, contextsPath, sessionPath } = materialize(directory);
        const outPath = path.join(directory, 'unit-digests.json');
        const argv = ['--session', sessionPath, '--scope', scopePath, '--contexts', contextsPath, '--out', outPath];
        const first = spawnCli(argv);
        const second = spawnCli(argv);

        assert.equal(first.status, 0, first.stderr);
        assert.equal(second.status, 0, second.stderr);
        // Same input means the same --out too: the summary line carries the
        // path, so both runs target one file and every byte must replay.
        assert.match(first.stdout, /^Revision unit digests: 2 unit\(s\) -> /);
        assert.equal(first.stdout, second.stdout, 'stdout must be byte-identical across runs');
        assert.equal(
            fs.readFileSync(outPath, 'utf8'),
            `${JSON.stringify([
                { reviewUnitId: UNIT_ID, batchDigest: expectedDigest(STABLE_ID, contextsFixture()) },
                { reviewUnitId: UNIT_ID_B, batchDigest: expectedDigest(STABLE_ID_B, contextsFixture()) },
            ], null, 2)}\n`,
            'the digests file must be byte-identical across runs',
        );
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('revision-unit-digests --json prints one document { count, unitDigestsPath, digests }', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-unit-digests-json-'));
    try {
        const { scopePath, contextsPath, sessionPath } = materialize(directory);
        const outPath = path.join(directory, 'unit-digests.json');
        const run = spawnCli(['--session', sessionPath, '--scope', scopePath, '--contexts', contextsPath, '--out', outPath, '--json']);

        assert.equal(run.status, 0, run.stderr);
        const parsed = JSON.parse(run.stdout);
        assert.deepEqual(Object.keys(parsed).sort(), ['count', 'digests', 'unitDigestsPath']);
        assert.equal(parsed.count, 2);
        assert.equal(parsed.unitDigestsPath, outPath);
        assert.equal(parsed.digests.length, 2);
        assert.equal(parsed.digests[0].batchDigest, expectedDigest(STABLE_ID, contextsFixture()));
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('revision-unit-digests refuses missing required flags with usage exit 64', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-unit-digests-usage-'));
    try {
        const { scopePath, contextsPath, sessionPath } = materialize(directory);
        const outPath = path.join(directory, 'unit-digests.json');
        const full = new Map([
            ['--session', sessionPath],
            ['--scope', scopePath],
            ['--contexts', contextsPath],
            ['--out', outPath],
        ]);
        for (const [missingFlag] of full) {
            const args = [...full.entries()].filter(([flag]) => flag !== missingFlag).flat();
            const run = spawnCli(args);
            assert.equal(run.status, 64, `${missingFlag}: expected exit 64, got ${run.status} (${run.stderr})`);
            assert.ok(run.stderr.includes('Missing required argument'), `${missingFlag}: stderr must say Missing required argument, got ${run.stderr}`);
            assert.ok(run.stderr.includes(missingFlag), `${missingFlag}: stderr must name the missing flag, got ${run.stderr}`);
        }
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('revision-unit-digests refuses unknown flags with usage exit 64', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-unit-digests-unknown-'));
    try {
        const { scopePath, contextsPath, sessionPath } = materialize(directory);
        const run = spawnCli([
            '--session', sessionPath, '--scope', scopePath, '--contexts', contextsPath,
            '--out', path.join(directory, 'unit-digests.json'), '--bogus',
        ]);
        assert.equal(run.status, 64);
        assert.ok(run.stderr.includes('Unknown argument: --bogus'), run.stderr);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('revision-unit-digests fails typed when the scope has no action for a unit', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-unit-digests-action-'));
    try {
        // The session keeps BOTH units; only the scope FILE loses the second
        // action — the failure the collector must refuse on.
        const fullScope = scopeFixture();
        const { scopePath, contextsPath, sessionPath } = materialize(directory, { scope: fullScope });
        const filteredScope = scopeFixture();
        filteredScope.actions = filteredScope.actions.filter((action) => action.stableId === STABLE_ID);
        fs.writeFileSync(scopePath, `${JSON.stringify(filteredScope, null, 2)}\n`);
        assert.throws(
            () => runCli({
                argv: ['node', 'revision-unit-digests', '--session', sessionPath, '--scope', scopePath, '--contexts', contextsPath, '--out', path.join(directory, 'unit-digests.json')],
            }),
            (error) => {
                assert.equal(error.code, 'REVISION_UNIT_DIGEST_ACTION_MISSING');
                assert.equal(error.details.stableId, STABLE_ID_B);
                assert.equal(error.details.reviewUnitId, UNIT_ID_B);
                assert.equal(error.exitCode, 1);
                return true;
            },
        );
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('revision-unit-digests fails typed when a context entry is missing or empty (exit 1, code on stderr)', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-unit-digests-ctx-'));
    try {
        const missing = contextsFixture();
        delete missing.contexts[STABLE_ID_B];
        const { scopePath, contextsPath, sessionPath } = materialize(directory, { contexts: missing });
        const run = spawnCli(['--session', sessionPath, '--scope', scopePath, '--contexts', contextsPath, '--out', path.join(directory, 'unit-digests.json')]);
        assert.equal(run.status, 1, run.stderr);
        assert.ok(run.stderr.includes('REVISION_UNIT_DIGEST_CONTEXT_MISSING'), run.stderr);
        assert.ok(run.stderr.includes(STABLE_ID_B), run.stderr);

        const emptied = contextsFixture();
        emptied.contexts[STABLE_ID_B].verbatimContent = '   ';
        const second = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-unit-digests-ctx-empty-'));
        try {
            const paths = materialize(second, { contexts: emptied });
            assert.throws(
                () => runCli({
                    argv: ['node', 'revision-unit-digests', '--session', paths.sessionPath, '--scope', paths.scopePath, '--contexts', paths.contextsPath, '--out', path.join(second, 'unit-digests.json')],
                }),
                (error) => {
                    assert.equal(error.code, 'REVISION_UNIT_DIGEST_CONTEXT_EMPTY');
                    assert.equal(error.details.stableId, STABLE_ID_B);
                    assert.equal(error.exitCode, 1);
                    return true;
                },
            );
        } finally {
            fs.rmSync(second, { recursive: true, force: true });
        }
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

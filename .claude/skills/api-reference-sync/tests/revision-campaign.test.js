'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { digestSemantic } = require('../../doc-ops-core/src/digest');
const {
    createReviewSession,
    saveReviewSession,
    loadReviewSessionState,
} = require('../src/sdk-doc-sync/review-session-store');
const { intakeRevisionSession, main: intakeMain } = require('../bin/revision-intake');
const { assembleBlockTree, buildRevisionBatch, runCli: applyRunCli } = require('../bin/revision-apply');
const { checkLayoutConformance, pageFactsFromBlocks } = require('../src/sdk-doc-sync/layout-conformance');
const sdkLayoutProfiles = require('../src/renderers/sdk-layout-profiles');

const STABLE_ID = 'java:v3-LexicalHighlighter';
const UNIT_ID = `review:${STABLE_ID}`;

const BASE_CONTENT = [
    'A LexicalHighlighter instance highlights query terms in search results.',
    '',
    'It collects matched segments so callers can render them.',
    '',
].join('\n');
const FIXED_CONTENT = `${BASE_CONTENT}\nThe highlighted segments preserve the original term order.\n`;

function scopeFixture(overrides = {}) {
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
            {
                stableId: STABLE_ID,
                symbol: 'LexicalHighlighter',
                type: 'UPDATE',
                reason: 'RETURNS_MIN_DEPTH',
                canonicalSlug: 'v3-LexicalHighlighter',
                documentToken: 'tokA',
                recordId: 'recA',
                shared: false,
                sharedWith: [],
                source: { repository: 'milvus-sdk-java', revision: 'v3.0.10' },
                evidence: [{ kind: 'conformance', confidence: 'direct', locator: 'feishu-docx:tokA', revision: 'v3.0.10', codes: ['RETURNS_MIN_DEPTH'] }],
                documentationOwnership: { classification: 'existing-page-content-revision' },
                defects: [{ code: 'RETURNS_MIN_DEPTH', detail: 'RETURNS section carries no response-fields PARAMETERS list', severity: 'error' }],
            },
        ],
        sharedPages: [],
        topologyAudit: { invariantId: 'api.same-name-sibling-placement', unresolvedTracks: [], summary: null },
        summary: { pages: 1, byCode: { RETURNS_MIN_DEPTH: 1 } },
        ...overrides,
    };
}

function contextsFixture(overrides = {}) {
    return {
        contexts: {
            [STABLE_ID]: {
                category: 'v3-Utility',
                documentationOwnership: { classification: 'existing-page-content-revision' },
                examples: [],
                exceptions: [],
                kind: 'class',
                notes: [],
                reasons: ['RETURNS_MIN_DEPTH'],
                repository: 'milvus-sdk-java',
                revision: 'v3.0.10',
                reviewedEvidence: [{ kind: 'conformance', confidence: 'direct', locator: 'feishu-docx:tokA', revision: 'v3.0.10', codes: ['RETURNS_MIN_DEPTH'] }],
                sourceVariants: {},
                summary: 'A LexicalHighlighter instance highlights query terms in search results.',
                symbolName: 'LexicalHighlighter',
                title: 'LexicalHighlighter',
                verbatimContent: FIXED_CONTENT,
            },
        },
        ...overrides,
    };
}

function writeJson(directory, name, value) {
    const filePath = path.join(directory, name);
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
    return filePath;
}

function sessionManifestFor(scope) {
    const manifestSemantic = {
        schemaVersion: 1,
        units: scope.actions.map((action) => ({
            reviewUnitId: `review:${action.stableId}`,
            documentStableId: action.stableId,
            prerequisiteReviewUnitIds: [],
        })),
    };
    return { ...manifestSemantic, manifestDigest: digestSemantic(manifestSemantic) };
}

function createSessionFixture(directory, scope) {
    const manifest = sessionManifestFor(scope);
    const session = createReviewSession({
        sessionId: `java-revision:milvus-sdk-java:v3.0.10:${manifest.manifestDigest}`,
        language: 'java',
        sdkName: 'milvus-sdk-java',
        track: 'v3.0.x',
        reviewUnitManifest: manifest,
        acceptanceFlow: 'two-gate',
        placementWalk: null,
    });
    const sessionPath = path.join(directory, 'review-session.json');
    saveReviewSession(sessionPath, session, { expectedPreviousDigest: null });
    return sessionPath;
}

const CONFORMANT_BLOCKS = [
    { block_id: 'blk-1', block_type: 2, text: { elements: [{ text_run: { content: 'A LexicalHighlighter instance highlights query terms in search results.' } }] } },
    { block_id: 'blk-2', block_type: 2, text: { elements: [{ text_run: { content: 'It collects matched segments so callers can render them.' } }] } },
    { block_id: 'blk-3', block_type: 2, text: { elements: [{ text_run: { content: 'The highlighted segments preserve the original term order.' } }] } },
];

test('revision-intake builds a two-gate session bound to the scope actions', () => {
    const scope = scopeFixture();
    const session = intakeRevisionSession({
        scope,
        contexts: contextsFixture().contexts,
        language: 'java',
        sdkName: 'milvus-sdk-java',
        track: 'v3.0.x',
    });
    assert.equal(session.acceptanceFlow, 'two-gate');
    assert.equal(session.reviewUnitManifest.units.length, scope.actions.length);
    assert.equal(session.reviewUnitManifest.units[0].documentStableId, STABLE_ID);
    assert.equal(session.reviewUnitManifestDigest, session.reviewUnitManifest.manifestDigest);
    assert.ok(session.sessionId.startsWith('java-revision:milvus-sdk-java:v3.0.10:'));
    assert.equal(session.artifacts.revisionRuling, 'test ruling');
});

test('revision-intake refuses missing, unexpected, and empty contexts', () => {
    const scope = scopeFixture();
    assert.throws(
        () => intakeRevisionSession({ scope, contexts: {}, language: 'java', sdkName: 'milvus-sdk-java', track: 'v3.0.x' }),
        (error) => error.code === 'REVISION_CONTEXT_MISSING',
    );
    assert.throws(
        () => intakeRevisionSession({
            scope,
            contexts: { [STABLE_ID]: { verbatimContent: FIXED_CONTENT }, 'java:v3-Orphan': { verbatimContent: 'x' } },
            language: 'java',
            sdkName: 'milvus-sdk-java',
            track: 'v3.0.x',
        }),
        (error) => error.code === 'REVISION_CONTEXT_UNEXPECTED',
    );
    assert.throws(
        () => intakeRevisionSession({
            scope,
            contexts: { [STABLE_ID]: { verbatimContent: '   ' } },
            language: 'java',
            sdkName: 'milvus-sdk-java',
            track: 'v3.0.x',
        }),
        (error) => error.code === 'REVISION_CONTEXT_CONTENT_EMPTY',
    );
});

test('revision-intake main writes the session once and refuses a second creation', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-intake-'));
    const scopePath = writeJson(directory, 'scope.json', scopeFixture());
    const contextsPath = writeJson(directory, 'contexts.json', contextsFixture());
    const sessionPath = path.join(directory, 'review-session.json');

    intakeMain([
        'node', 'revision-intake',
        '--scope', scopePath,
        '--contexts', contextsPath,
        '--session', sessionPath,
    ]);
    assert.ok(fs.existsSync(sessionPath));
    const { session } = loadReviewSessionState(sessionPath);
    assert.equal(session.reviewUnitManifest.units.length, 1);
    assert.equal(session.acceptanceFlow, 'two-gate');

    assert.throws(
        () => intakeMain([
            'node', 'revision-intake',
            '--scope', scopePath,
            '--contexts', contextsPath,
            '--session', sessionPath,
        ]),
        (error) => error.code === 'SESSION_STATE_EXISTS',
    );
});

test('revision-apply executes the approved batch, journals incrementally, and records the pending execution', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-apply-'));
    const scope = scopeFixture();
    const scopePath = writeJson(directory, 'scope.json', scope);
    const contextsPath = writeJson(directory, 'contexts.json', contextsFixture());
    const sessionPath = createSessionFixture(directory, scope);

    const batch = buildRevisionBatch({
        stableId: STABLE_ID,
        reviewUnitId: UNIT_ID,
        documentToken: 'tokA',
        recordId: 'recA',
        fixedContent: FIXED_CONTENT,
        sources: [],
    });

    const runManifestPath = path.resolve('tmp', 'api-reference-sync', `run-manifest-revision-apply-${UNIT_ID.replace(/[^A-Za-z0-9-]/g, '-')}.json`);
    if (fs.existsSync(runManifestPath)) fs.rmSync(runManifestPath);

    let rawContentCalls = 0;
    const result = await applyRunCli({
        argv: [
            'node', 'revision-apply',
            '--session', sessionPath,
            '--review-unit-id', UNIT_ID,
            '--scope', scopePath,
            '--contexts', contextsPath,
            '--approve-digest', batch.batchDigest,
            '--base-token', 'base-canary',
            '--table-id', 'tbl-canary',
            '--journal', path.join(directory, 'execution.jsonl'),
            '--json',
        ],
        dependencies: {
            fetchRecordState: async () => ({ record_id: 'rec-1', fields: { Progress: 'Draft', Targets: ['Milvus'] } }),
            reopenRecord: async () => 'reopened',
            // raw_content always leads with the page title (the comparator
            // drops it unconditionally on the observed side).
            fetchRawContent: async () => {
                rawContentCalls += 1;
                return rawContentCalls === 1 ? `# LexicalHighlighter\n${BASE_CONTENT}` : `# LexicalHighlighter\n${FIXED_CONTENT}`;
            },
            fetchBlocks: async () => CONFORMANT_BLOCKS,
            rebuildPage: async () => 3,
        },
    });

    assert.equal(result.status, 'EXECUTED');
    // Terminal comparison now reads the live BLOCK TREE (blocksToMarkdown),
    // not raw_content — base capture is the only raw_content call.
    assert.equal(rawContentCalls, 1);

    const entries = fs.readFileSync(path.join(directory, 'execution.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(entries[0].type, 'content-fidelity');
    assert.equal(entries[1].type, 'prepared');
    // The acceptance contract keys the Targets baseline by prepared.actionId —
    // a prepared entry without it silently baselines to [] and accept refuses.
    assert.equal(entries[1].actionId, STABLE_ID);
    assert.ok(entries[1].rollbackCapsule.priorRawContent.includes('highlights query terms'));
    // Record re-open (2026-10-07): the acceptance WIP→Draft transition needs
    // the record back at WIP, and the Targets baseline derives from the
    // capsule's beforeRecord.
    assert.ok(entries[1].rollbackCapsule.beforeRecord, 'prepared entry must carry the pre-mutation record state');
    assert.equal(entries[1].rollbackCapsule.beforeRecord.rawFields.Progress, 'Draft');
    const treeDelta = entries.find((entry) => entry.type === 'tree-delta');
    assert.equal(treeDelta.invariantId, 'api.versioned-tree-delta');
    assert.equal(treeDelta.ok, true);
    const observed = entries.find((entry) => entry.type === 'observed' && entry.status === 'success');
    assert.equal(observed.actionId, STABLE_ID);
    assert.equal(observed.verified, true);
    assert.equal(observed.recordReopen.beforeProgress, 'Draft');
    assert.equal(observed.recordReopen.afterProgress, 'WIP');
    const completion = entries[entries.length - 1];
    assert.equal(completion.status, 'executed');
    assert.equal(completion.completionSentinel, true);
    assert.equal(result.journalDigest, digestSemantic(entries));

    const { session } = loadReviewSessionState(sessionPath);
    assert.equal(session.pendingExecutions.length, 1);
    assert.equal(session.pendingExecutions[0].executionJournalDigest, result.journalDigest);
    assert.equal(session.pendingExecutions[0].reviewUnitId, UNIT_ID);
    assert.ok(fs.existsSync(runManifestPath));
    // Self-cleanup: the artifact lives under the repo tmp/ and the run
    // manifest content embeds the tree fingerprint — leaving it behind
    // would shift the fingerprint every later test in this run computes
    // (the documented self-drift trap).
    fs.rmSync(runManifestPath);
});

test('revision-apply refuses a digest that does not match the approved batch', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-apply-bad-'));
    const scope = scopeFixture();
    const scopePath = writeJson(directory, 'scope.json', scope);
    const contextsPath = writeJson(directory, 'contexts.json', contextsFixture());
    const sessionPath = createSessionFixture(directory, scope);

    await assert.rejects(
        () => applyRunCli({
            argv: [
                'node', 'revision-apply',
                '--session', sessionPath,
                '--review-unit-id', UNIT_ID,
                '--scope', scopePath,
                '--contexts', contextsPath,
                '--approve-digest', 'sha256:wrong-batch',
            '--base-token', 'base-canary',
            '--table-id', 'tbl-canary',
            ],
            dependencies: { fetchRawContent: async () => BASE_CONTENT, fetchBlocks: async () => CONFORMANT_BLOCKS, rebuildPage: async () => 1, fetchRecordState: async () => ({ record_id: 'rec-1', fields: { Progress: 'Draft', Targets: ['Milvus'] } }), reopenRecord: async () => 'reopened' },
        }),
        (error) => error.code === 'REVISION_APPROVAL_DIGEST_MISMATCH',
    );
});

test('revision-apply persists a failed journal and refuses the session when live layout is non-conformant', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-apply-layout-'));
    const scope = scopeFixture();
    const scopePath = writeJson(directory, 'scope.json', scope);
    const contextsPath = writeJson(directory, 'contexts.json', contextsFixture());
    const sessionPath = createSessionFixture(directory, scope);

    const batch = buildRevisionBatch({
        stableId: STABLE_ID,
        reviewUnitId: UNIT_ID,
        documentToken: 'tokA',
        recordId: 'recA',
        fixedContent: FIXED_CONTENT,
        sources: [],
    });
    const journalPath = path.join(directory, 'execution.jsonl');

    await assert.rejects(
        () => applyRunCli({
            argv: [
                'node', 'revision-apply',
                '--session', sessionPath,
                '--review-unit-id', UNIT_ID,
                '--scope', scopePath,
                '--contexts', contextsPath,
                '--approve-digest', batch.batchDigest,
            '--base-token', 'base-canary',
            '--table-id', 'tbl-canary',
                '--journal', journalPath,
            ],
            dependencies: {
                fetchRecordState: async () => ({ record_id: 'rec-1', fields: { Progress: 'Draft', Targets: ['Milvus'] } }),
                reopenRecord: async () => 'reopened',
                fetchRawContent: async () => `# LexicalHighlighter\n${BASE_CONTENT}`,
                fetchBlocks: async () => ([
                    { block_id: 'blk-1', block_type: 2, text: { elements: [{ text_run: { content: 'A LexicalHighlighter instance highlights query terms in search results.' } }] } },
                    { block_id: 'blk-2', block_type: 2, text: { elements: [{ text_run: { content: 'Notes' } }] } },
                ]),
                rebuildPage: async () => 2,
            },
        }),
        (error) => error.code === 'REVISION_LAYOUT_VERIFY_FAILED',
    );

    const entries = fs.readFileSync(journalPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const completion = entries[entries.length - 1];
    assert.equal(completion.status, 'verification_failed');
    const failedObserved = entries.find((entry) => entry.type === 'observed' && entry.status === 'failed');
    assert.ok(failedObserved);

    // The failed journal must not be recordable: the session stays clean.
    const { session } = loadReviewSessionState(sessionPath);
    assert.equal(session.pendingExecutions.length, 0);
});

test('revision-apply refuses an existing execution journal', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-apply-exists-'));
    const scope = scopeFixture();
    const scopePath = writeJson(directory, 'scope.json', scope);
    const contextsPath = writeJson(directory, 'contexts.json', contextsFixture());
    const sessionPath = createSessionFixture(directory, scope);
    const batch = buildRevisionBatch({
        stableId: STABLE_ID,
        reviewUnitId: UNIT_ID,
        documentToken: 'tokA',
        recordId: 'recA',
        fixedContent: FIXED_CONTENT,
        sources: [],
    });
    const journalPath = path.join(directory, 'execution.jsonl');
    fs.writeFileSync(journalPath, '{}\n');

    await assert.rejects(
        () => applyRunCli({
            argv: [
                'node', 'revision-apply',
                '--session', sessionPath,
                '--review-unit-id', UNIT_ID,
                '--scope', scopePath,
                '--contexts', contextsPath,
                '--approve-digest', batch.batchDigest,
            '--base-token', 'base-canary',
            '--table-id', 'tbl-canary',
                '--journal', journalPath,
            ],
            dependencies: { fetchRawContent: async () => BASE_CONTENT, fetchBlocks: async () => CONFORMANT_BLOCKS, rebuildPage: async () => 1, fetchRecordState: async () => ({ record_id: 'rec-1', fields: { Progress: 'Draft', Targets: ['Milvus'] } }), reopenRecord: async () => 'reopened' },
        }),
        (error) => error.code === 'EXECUTION_RECONCILIATION_REQUIRED',
    );
});

// The docx list endpoint returns a flat array whose `children` are block-id
// strings. Incident 2026-10-08 (StructFieldSchema): feeding that flat list to
// the verification consumers read the callout's governed "Notes" title as a
// top-level internal-note leak and REVISION_LAYOUT_VERIFY_FAILED refused a
// correctly landed page. Fixed at both layers: pageFactsFromBlocks walks the
// page-anchored flat format through the real hierarchy, and the executor
// assembles the tree before feeding consumers that need block structure.
const CALLOUT_FLAT_BLOCKS = [
    { block_id: 'page-1', block_type: 1, children: ['blk-a', 'blk-c', 'blk-e'] },
    { block_id: 'blk-a', block_type: 2, text: { elements: [{ text_run: { content: 'A LexicalHighlighter instance highlights query terms in search results.' } }] } },
    { block_id: 'blk-c', block_type: 19, callout: { background_color: 2, border_color: 2, emoji_id: 'blue_book' }, children: ['blk-c1', 'blk-c2'] },
    { block_id: 'blk-c1', block_type: 2, text: { elements: [{ text_run: { content: 'Notes' } }] } },
    { block_id: 'blk-c2', block_type: 2, text: { elements: [{ text_run: { content: 'This class cannot be explicitly instantiated. You need to describe a collection with an Array of Structs field to view its instances.' } }] } },
    { block_id: 'blk-e', block_type: 2, text: { elements: [{ text_run: { content: 'The highlighted segments preserve the original term order.' } }] } },
];

test('flat docx lists walk the page-block hierarchy; tree assembly reconstructs callout children', () => {
    const flatFacts = pageFactsFromBlocks(CALLOUT_FLAT_BLOCKS);
    const flatViolations = checkLayoutConformance(sdkLayoutProfiles.java, flatFacts).violations;
    assert.equal(
        flatViolations.filter((violation) => violation.code === 'INTERNAL_NOTE_LEAK').length,
        0,
        'page-anchored flat lists must walk the real hierarchy (incident 2026-10-08)',
    );

    const tree = assembleBlockTree(CALLOUT_FLAT_BLOCKS);
    const callout = tree.find((block) => block.block_type === 19);
    assert.equal(callout.children.length, 2);
    assert.equal(callout.children[0].text.elements[0].text_run.content, 'Notes');
    const treeViolations = checkLayoutConformance(sdkLayoutProfiles.java, pageFactsFromBlocks(tree)).violations;
    assert.equal(
        treeViolations.filter((violation) => violation.code === 'INTERNAL_NOTE_LEAK').length,
        0,
    );
});

test('revision-apply verifies a landed callout page when the live fetch returns the flat list', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-apply-callout-'));
    const scope = scopeFixture();
    const scopePath = writeJson(directory, 'scope.json', scope);
    const alertFixedContent = [
        'A LexicalHighlighter instance highlights query terms in search results.',
        '',
        '<div class="alert note">',
        '',
        'This class cannot be explicitly instantiated. You need to describe a collection with an Array of Structs field to view its instances.',
        '',
        '</div>',
        '',
        'The highlighted segments preserve the original term order.',
        '',
    ].join('\n');
    const contexts = contextsFixture();
    contexts.contexts[STABLE_ID].verbatimContent = alertFixedContent;
    const contextsPath = writeJson(directory, 'contexts.json', contexts);
    const sessionPath = createSessionFixture(directory, scope);

    const batch = buildRevisionBatch({
        stableId: STABLE_ID,
        reviewUnitId: UNIT_ID,
        documentToken: 'tokA',
        recordId: 'recA',
        fixedContent: alertFixedContent,
        sources: [],
    });

    const runManifestPath = path.resolve('tmp', 'api-reference-sync', `run-manifest-revision-apply-${UNIT_ID.replace(/[^A-Za-z0-9-]/g, '-')}.json`);
    if (fs.existsSync(runManifestPath)) fs.rmSync(runManifestPath);

    const result = await applyRunCli({
        argv: [
            'node', 'revision-apply',
            '--session', sessionPath,
            '--review-unit-id', UNIT_ID,
            '--scope', scopePath,
            '--contexts', contextsPath,
            '--approve-digest', batch.batchDigest,
            '--base-token', 'base-canary',
            '--table-id', 'tbl-canary',
            '--journal', path.join(directory, 'execution.jsonl'),
            '--json',
        ],
        dependencies: {
            fetchRecordState: async () => ({ record_id: 'rec-1', fields: { Progress: 'Draft', Targets: ['Milvus'] } }),
            reopenRecord: async () => 'reopened',
            fetchRawContent: async () => `# LexicalHighlighter\n${BASE_CONTENT}`,
            fetchBlocks: async () => CALLOUT_FLAT_BLOCKS,
            rebuildPage: async () => 4,
        },
    });

    assert.equal(result.status, 'EXECUTED');
    const completion = JSON.parse(fs.readFileSync(path.join(directory, 'execution.jsonl'), 'utf8').trim().split('\n').pop());
    assert.equal(completion.status, 'executed');
    assert.equal(completion.completionSentinel, true);
    fs.rmSync(runManifestPath, { force: true });
});

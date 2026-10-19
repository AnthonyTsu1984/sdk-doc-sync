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
const { assembleBlockTree, buildRevisionBatch, resolveRevisionApproval, runCli: applyRunCli } = require('../bin/revision-apply');
const {
    buildCampaignApprovalReceipt,
    buildCampaignPlan,
    combinedUnitsDigest,
    componentDigests,
} = require('../src/sdk-doc-sync/campaign-approval');
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

test('a content-only context drift does NOT trip the chain (the regeneration path, ruling b)', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-campaign-contentonly-'));
    const scope = scopeFixture();
    const contexts = contextsFixture();
    const sessionPath = createSessionFixture(directory, scope);
    const { session } = loadReviewSessionState(path.resolve(sessionPath));

    const units = revisionUnitDigestsFor(scope, contexts, session);
    const receipt = revisionCampaignReceipt({ scope, contexts, units, session });
    const receiptPath = writeJson(directory, 'receipt.json', receipt);

    // Only verbatimContent changed: the spec projection strips content, so the
    // chain holds — the fresh digest rides the dual-track acceptance instead.
    const regenerated = { ...contexts.contexts[STABLE_ID], verbatimContent: 'SOME NEW CONTENT' };
    const drifted = { ...contexts.contexts, [STABLE_ID]: regenerated };
    const resolution = resolveRevisionApproval({
        args: { campaignApproval: receiptPath, approveDigest: units[0].batchDigest, reviewUnitId: UNIT_ID },
        session,
        scope,
        contexts: drifted,
    });
    // The pinned digest executes; the chain held through the content drift.
    assert.equal(resolution.approveDigest, units[0].batchDigest);
    assert.equal(resolution.regeneration, null);
});

// --- batch 16 slice 7: the merged campaign approval authorizes revision writes
// (ruling (b): unit set + three chains + membership; fresh digest = regeneration) ---

function stripContent(contextsContainer) {
    const projected = {};
    for (const [key, entry] of Object.entries(contextsContainer)) {
        if (entry && typeof entry === 'object') {
            const { verbatimContent, ...rest } = entry;
            projected[key] = rest;
        } else {
            projected[key] = entry;
        }
    }
    return projected;
}

function revisionUnitDigestsFor(scope, contexts, session) {
    const units = [];
    for (const unit of session.reviewUnitManifest.units) {
        const action = scope.actions.find((item) => item.stableId === unit.documentStableId);
        const entry = contexts.contexts[unit.documentStableId];
        const batch = buildRevisionBatch({
            stableId: unit.documentStableId,
            reviewUnitId: unit.reviewUnitId,
            documentToken: action.documentToken,
            recordId: action.recordId,
            fixedContent: entry.verbatimContent,
            sources: [],
        });
        units.push({ reviewUnitId: unit.reviewUnitId, batchDigest: batch.batchDigest });
    }
    return units;
}

function revisionCampaignReceipt({ scope, contexts, units, session }) {
    const plan = buildCampaignPlan({
        language: scope.language,
        sdkName: scope.sdkName,
        track: scope.track,
        components: componentDigests({
            scope,
            // The grouping chain = the session's reviewUnitManifest projection,
            // exactly what revision-apply re-derives at write time.
            grouping: { reviewUnitManifest: session.reviewUnitManifest },
            // The candidate-spec chain = the contexts container's SPECIFICATION
            // projection (content bytes stripped — they are bound by the
            // units' batchDigest instead), exactly what revision-apply
            // re-derives at write time.
            candidateSpec: stripContent(contexts.contexts),
            batchDigest: combinedUnitsDigest(units),
        }),
    });
    return buildCampaignApprovalReceipt({ plan, units });
}

test('revision-apply executes under a campaign receipt when the three chains hold (slice 7 ruling b)', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-campaign-approval-'));
    const scope = scopeFixture();
    writeJson(directory, 'scope.json', scope);
    const contextsPath = writeJson(directory, 'contexts.json', contextsFixture());
    const contexts = JSON.parse(fs.readFileSync(contextsPath, 'utf8'));
    const sessionPath = createSessionFixture(directory, scope);
    const { session } = loadReviewSessionState(path.resolve(sessionPath));

    // The receipt the campaign gate would have recorded: unit set from the
    // initial dry-run previews, grouping = the session's reviewUnitManifest
    // projection, candidate-spec = the contexts document.
    const units = revisionUnitDigestsFor(scope, contexts, session);
    const receipt = revisionCampaignReceipt({ scope, contexts, units, session });
    const receiptPath = writeJson(directory, 'receipt.json', receipt);

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

    const result = await applyRunCli({
        argv: [
            'node', 'revision-apply',
            '--session', sessionPath,
            '--review-unit-id', UNIT_ID,
            '--scope', path.join(directory, 'scope.json'),
            '--contexts', contextsPath,
            '--campaign-approval', receiptPath,
            '--base-token', 'base-canary',
            '--table-id', 'tbl-canary',
            '--journal', path.join(directory, 'execution.jsonl'),
            '--json',
        ],
        dependencies: {
            fetchRecordState: async () => ({ record_id: 'rec-1', fields: { Progress: 'Draft', Targets: ['Milvus'] } }),
            fetchRawContent: async () => BASE_CONTENT,
            fetchBlocks: async () => CONFORMANT_BLOCKS,
            rebuildPage: async () => 1,
            reopenRecord: async () => 'reopened',
        },
    });

    assert.equal(result.status, 'EXECUTED');
    assert.equal(result.batchDigest, batch.batchDigest);
    fs.rmSync(runManifestPath, { force: true });
});

test('revision-apply refuses a campaign receipt whose unit set no longer contains the unit', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-campaign-membership-'));
    const scope = scopeFixture();
    writeJson(directory, 'scope.json', scope);
    const contextsPath = writeJson(directory, 'contexts.json', contextsFixture());
    const contexts = JSON.parse(fs.readFileSync(contextsPath, 'utf8'));
    const sessionPath = createSessionFixture(directory, scope);
    const { session } = loadReviewSessionState(path.resolve(sessionPath));

    // Approved set WITHOUT our unit: an intruder executes against a receipt
    // that never approved it. A single-unit campaign has no sibling to
    // exclude, so the approved set is a DIFFERENT unit id — membership (not
    // the digest) is what must refuse.
    const units = [{ reviewUnitId: 'review:java:v3-SomeOtherClass', batchDigest: `sha256:${'9'.repeat(64)}` }];
    const receipt = revisionCampaignReceipt({ scope, contexts, units, session });
    const receiptPath = writeJson(directory, 'receipt.json', receipt);

    await assert.rejects(
        () => applyRunCli({
            argv: [
                'node', 'revision-apply',
                '--session', sessionPath,
                '--review-unit-id', UNIT_ID,
                '--scope', path.join(directory, 'scope.json'),
                '--contexts', contextsPath,
                '--campaign-approval', receiptPath,
                '--base-token', 'base-canary',
                '--table-id', 'tbl-canary',
                '--journal', path.join(directory, 'execution.jsonl'),
                '--json',
            ],
            dependencies: {
                fetchRecordState: async () => ({ record_id: 'rec-1', fields: { Progress: 'Draft', Targets: ['Milvus'] } }),
                fetchRawContent: async () => BASE_CONTENT,
                fetchBlocks: async () => CONFORMANT_BLOCKS,
                rebuildPage: async () => 1,
                reopenRecord: async () => 'reopened',
            },
        }),
        (error) => error.code === 'CAMPAIGN_UNIT_NOT_APPROVED',
    );
    // A refused membership writes nothing: no journal, no session change.
    assert.equal(fs.existsSync(path.join(directory, 'execution.jsonl')), false);
});

test('revision-apply journals CONTENT_REGENERATED when the executed digest is fresh (ruling b)', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-campaign-regenerated-'));
    const scope = scopeFixture();
    writeJson(directory, 'scope.json', scope);
    const contextsPath = writeJson(directory, 'contexts.json', contextsFixture());
    const contexts = JSON.parse(fs.readFileSync(contextsPath, 'utf8'));
    const sessionPath = createSessionFixture(directory, scope);
    const { session } = loadReviewSessionState(path.resolve(sessionPath));

    const units = revisionUnitDigestsFor(scope, contexts, session);
    const receipt = revisionCampaignReceipt({ scope, contexts, units, session });
    const receiptPath = writeJson(directory, 'receipt.json', receipt);

    // A fresh fixed content (the writer regenerated after the gate): the
    // recomputed batch digest differs from the receipt's pinned value, so
    // the write presents the FRESH digest and the receipt's dual-track
    // acceptance authorizes it as regeneration.
    const regeneratedContent = `${FIXED_CONTENT}\nA further clarified sentence.\n`;
    const regeneratedBatch = buildRevisionBatch({
        stableId: STABLE_ID,
        reviewUnitId: UNIT_ID,
        documentToken: 'tokA',
        recordId: 'recA',
        fixedContent: regeneratedContent,
        sources: [],
    });
    const contextsRegenerated = JSON.parse(fs.readFileSync(contextsPath, 'utf8'));
    contextsRegenerated.contexts[STABLE_ID].verbatimContent = regeneratedContent;
    const contextsRegeneratedPath = writeJson(directory, 'contexts-regenerated.json', contextsRegenerated);

    const runManifestPath = path.resolve('tmp', 'api-reference-sync', `run-manifest-revision-apply-${UNIT_ID.replace(/[^A-Za-z0-9-]/g, '-')}.json`);
    if (fs.existsSync(runManifestPath)) fs.rmSync(runManifestPath);

    // The live page AFTER the rebuild carries the regenerated content: the
    // terminal comparator reads the block tree, so the mock live blocks must
    // include the clarified sentence.
    const regeneratedLiveBlocks = [
        ...CONFORMANT_BLOCKS,
        { block_id: 'blk-4', block_type: 2, text: { elements: [{ text_run: { content: 'A further clarified sentence.' } }] } },
    ];
    const result = await applyRunCli({
        argv: [
            'node', 'revision-apply',
            '--session', sessionPath,
            '--review-unit-id', UNIT_ID,
            '--scope', path.join(directory, 'scope.json'),
            '--contexts', contextsRegeneratedPath,
            '--campaign-approval', receiptPath,
            '--approve-digest', regeneratedBatch.batchDigest,
            '--base-token', 'base-canary',
            '--table-id', 'tbl-canary',
            '--journal', path.join(directory, 'execution.jsonl'),
            '--json',
        ],
        dependencies: {
            fetchRecordState: async () => ({ record_id: 'rec-1', fields: { Progress: 'Draft', Targets: ['Milvus'] } }),
            fetchRawContent: async () => BASE_CONTENT,
            fetchBlocks: async () => regeneratedLiveBlocks,
            rebuildPage: async () => 1,
            reopenRecord: async () => 'reopened',
        },
    });

    assert.equal(result.status, 'EXECUTED');
    assert.equal(result.batchDigest, regeneratedBatch.batchDigest);
    const journal = fs.readFileSync(path.join(directory, 'execution.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const regeneration = journal.find((entry) => entry.type === 'campaign-approval-regeneration');
    assert.ok(regeneration, 'the CONTENT_REGENERATED lineage must be journaled');
    assert.equal(regeneration.code, 'CONTENT_REGENERATED');
    assert.equal(regeneration.reviewUnitId, UNIT_ID);
    assert.equal(regeneration.freshBatchDigest, regeneratedBatch.batchDigest);
    fs.rmSync(runManifestPath, { force: true });
});

test('a campaign receipt with a structurally drifted context chain is CAMPAIGN_DIGEST_STALE (the explicit three-chain)', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-campaign-chain-'));
    const scope = scopeFixture();
    writeJson(directory, 'scope.json', scope);
    const contexts = contextsFixture();
    const contextsPath = writeJson(directory, 'contexts.json', contexts);
    const sessionPath = createSessionFixture(directory, scope);
    const { session } = loadReviewSessionState(path.resolve(sessionPath));

    const units = revisionUnitDigestsFor(scope, contexts, session);
    const receipt = revisionCampaignReceipt({ scope, contexts, units, session });
    const receiptPath = writeJson(directory, 'receipt.json', receipt);

    // A STRUCTURAL drift after the gate — the spec projection excludes
    // verbatimContent (bound by the units' batchDigest instead), so only a
    // structural fact (units, metadata, reviewedEvidence) can trip the chain.
    // Content-only drift is the regeneration path (ruling b); structural drift
    // demands a fresh gate.
    const driftedContexts = JSON.parse(fs.readFileSync(contextsPath, 'utf8'));
    driftedContexts.contexts[STABLE_ID].reviewedEvidence = [];
    const driftedPath = writeJson(directory, 'drifted-contexts.json', driftedContexts);

    assert.throws(
        () => resolveRevisionApproval({
            args: { campaignApproval: receiptPath, approveDigest: units[0].batchDigest, reviewUnitId: UNIT_ID },
            session,
            scope,
            contexts: JSON.parse(fs.readFileSync(driftedPath, 'utf8')).contexts,
        }),
        (error) => error.code === 'CAMPAIGN_DIGEST_STALE' && /candidateSpecDigest/.test(error.message),
    );
});

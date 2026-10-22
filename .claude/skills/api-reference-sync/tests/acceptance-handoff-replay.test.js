'use strict';

// Acceptance-handoff golden replay (2026-10-22 review ruling, tests T1/T8).
//
// The review's structural finding: the journal→acceptance evidence model is
// sound, but the EXECUTION→ACCEPTANCE seam was only ever exercised live —
// rehearsal stops at the execution boundary, so every argv/file-shape defect
// (c1 session residue, c3/c4 --final-targets value semantics, missing
// scan-state-entry producer) cost a live burn to discover. These tests pin the
// seam OFFLINE the same way golden-replay pinned the materialization chain:
//
//   T1 — the dwf template's REAL flags (extracted from the template source,
//        not hand-copied) must survive sdk-doc-sync's argument semantics and
//        drive the acceptance targets chain. Before the P0-1 fix this was
//        red: the template fed a targets.json PATH to --final-targets, whose
//        CLI semantics is a "Milvus,Zilliz" subset string.
//   T8 — the frozen m5-c4 create_role execution journal (byte-identical to
//        the campaign artifact, digest-pinned) replays the acceptance
//        identity chain against the frozen c4 session residue: record
//        identity lives ONLY in the rollback capsule, the flat prepared
//        fields are empty, and touchedRecordsFromJournal's capsule fallback
//        is what makes auto-acceptance reach the capsule recordId/documentToken
//        (M5 c3/c4 fixes). A capsule-shape drift in the executor now dies
//        here, not in the next live run.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseArgs } = require('../bin/sdk-doc-sync');
const {
    parseFinalTargets,
    readJournalEntries,
    touchedRecordsFromJournal,
    buildAutoAcceptanceReceipt,
    acceptExecutedUnit,
    acceptDocumentTwoGate,
} = require('../bin/sdk-review-session');
const {
    prepareDocumentAcceptance,
    targetsFinalForReviewUnit,
    loadReviewSessionState,
    unitStatusOf,
} = require('../src/sdk-doc-sync/review-session-store');
const { digestSemantic } = require('../../doc-ops-core/src/digest');

const TEMPLATE = path.resolve(__dirname, '..', 'workflows', 'release-sync-campaign.dwf.ts');
const template = fs.readFileSync(TEMPLATE, 'utf8');
const FIXTURES = path.resolve(__dirname, 'conformance-fixtures', 'api-reference-sync', 'python-v30-sync');
const JOURNAL_FIXTURE = path.join(FIXTURES, 'm5-c4-create-role-execution-journal.jsonl');
const SESSION_FIXTURE = path.join(FIXTURES, 'm5-c4-session-residue.json');
const TARGETS_FIXTURE = path.join(FIXTURES, 'targets-python-v30.json');

// The m5 c4 campaign's own recorded journal digest (exec result
// executionJournalDigest of run m5-live-20261021-c4) — the fixture must stay
// byte-identical to the campaign artifact.
const C4_JOURNAL_DIGEST = 'sha256:6bab8ce4b663d95f5a0a298df66fe2f28d83b4618b7d9145d203b0c96d8669d3';
const C4_UNIT = 'review:python:Authentication:create_role';
const C4_RECORD_ID = 'recu3QwdFC0YXO';
const C4_DOCUMENT_TOKEN = 'HRqudGOOnokInhxczclcADBDn8g';

// ── T1: the template's real flags survive the consumer's semantics ──────────

// Extract the sdkBaseArgs array literal from the template so the test always
// judges the CURRENT template bytes (template drift changes this extraction,
// never silently passes).
function templateSdkBaseArgsBody() {
    const match = template.match(/async function sdkBaseArgs\(\): Promise<string\[\]> \{\s*return \[([\s\S]*?)\];\s*\}/);
    assert.ok(match, 'sdkBaseArgs array literal found in release-sync-campaign.dwf.ts');
    return match[1];
}

test('T1/P0-1: sdkBaseArgs feeds the A2 ruling FILE through --targets-json, never --final-targets', () => {
    const body = templateSdkBaseArgsBody();
    assert.ok(body.includes('"--targets-json"'), 'sdkBaseArgs must pass --targets-json (the A2 ruling file entry)');
    assert.equal((body.match(/"--final-targets"/g) || []).length, 0,
        '--final-targets semantics is a "Milvus,Zilliz" subset string; a path value throws in parseFinalTargets (the c3/c4 seam)');
});

test('T1: the template-flags argv parses into the acceptance-expected argument slots', () => {
    // Materialize the template argv with the same token order sdkBaseArgs
    // builds; values are fixture-real where the consumer reads them.
    const argv = [
        'node', '.claude/skills/api-reference-sync/bin/sdk-doc-sync.js',
        '--language', 'python',
        '--sdk-dir', 'repos/pymilvus',
        '--sdk-name', 'pymilvus',
        '--sdk-version', 'v3.0.x',
        '--release-scope', 'tmp/campaign/release-scope.json',
        '--reference-context', 'tmp/campaign/reviewed-context.md',
        '--targets-json', TARGETS_FIXTURE,
    ];
    const parsed = parseArgs(argv);
    assert.equal(parsed.targetsJson, TARGETS_FIXTURE, '--targets-json lands the A2 ruling file');
    assert.equal(parsed.finalTargets, undefined, '--final-targets is absent (KB-wide default governs)');
    assert.equal(parsed.language, 'python');
    assert.equal(parsed.releaseScope, 'tmp/campaign/release-scope.json');

    // Absent --final-targets is the full default pair; the PRE-FIX shape (a
    // path value into --final-targets) is the exact c3/c4 blow-up — keep the
    // throw pinned so the wrong flag pair can never look green again.
    assert.deepEqual(parseFinalTargets(parsed.finalTargets), ['Milvus', 'Zilliz']);
    assert.throws(() => parseFinalTargets(TARGETS_FIXTURE), /comma-separated subset/);
});

test('T1: the A2 ruling file resolves per-unit acceptance Targets through the real resolver', () => {
    const rulings = JSON.parse(fs.readFileSync(TARGETS_FIXTURE, 'utf8'));
    // A2 ruling > category table > default: the shared ruling keeps the pair,
    // the milvus-only ruling narrows that unit (never the KB default).
    assert.deepEqual(targetsFinalForReviewUnit(C4_UNIT, rulings), ['Milvus', 'Zilliz']);
    assert.deepEqual(
        targetsFinalForReviewUnit('review:python:ResourceGroup:get_replicate_configuration', rulings),
        ['Milvus'],
    );
});

test('T1/P1-2: the exec argv presents --approve-batch-digest (the regeneration track the retry budget needs)', () => {
    // Without the presentation, resolveCampaignApprovalForWrite always falls
    // back to the PINNED unit digest and a regenerated retry dies at the write
    // gate (APPROVED_BATCH_DIGEST_MISMATCH) — the retry budget was a promise
    // the argv never kept.
    assert.ok(template.includes('"--approve-batch-digest", unit.batchDigest'),
        'runExecUnit must present the unit\'s current digest (pinned first, fresh after regeneration)');
    const parsed = parseArgs([
        'node', 'bin/sdk-doc-sync.js',
        '--resume-session', 'tmp/campaign/session-state.json',
        '--review-unit-id', C4_UNIT,
        '--campaign-approval', 'tmp/campaign/receipt.json',
        '--approve-batch-digest', 'sha256:5fd55a08d39f6bff5ed0335c48448c5e0dd7409df36f55d63ac044d1e5d311b9',
        '--auto-accept', '--auto-approve',
    ]);
    assert.equal(parsed.approveBatchDigest, 'sha256:5fd55a08d39f6bff5ed0335c48448c5e0dd7409df36f55d63ac044d1e5d311b9');
    assert.equal(parsed.campaignApproval, 'tmp/campaign/receipt.json');
    assert.equal(parsed.autoAccept, true);
});

test('T1/P0-3: the residue session clear runs BEFORE the intake chain (c1 self-heal)', () => {
    // The intake chain's tail dry-run creates the session with --session-state;
    // a leftover session file from a mid-run freeze therefore killed the NEXT
    // run at step 2 ("review session already exists") until the clear moved
    // ahead of intake. Pin the source order.
    const residueClear = template.indexOf('[PAYLOAD_RUNNER, "clear-session", paths.sessionPath, NONCE]');
    const intakeRun = template.indexOf('[INTAKE_ASSEMBLE, "--run"]');
    assert.ok(residueClear >= 0, 'a clear-session payload run exists in the template');
    assert.ok(intakeRun > residueClear,
        `the residue clear (offset ${residueClear}) must precede intake-assemble --run (offset ${intakeRun})`);
    // The step-5 clear (of the intake-built pre-check session) stays — two
    // clears, two duties.
    assert.equal(template.indexOf('[PAYLOAD_RUNNER, "clear-session", paths.sessionPath, NONCE]', residueClear + 1) > 0, true,
        'the second clear (intake pre-check session) is still present');
});

test('T1/P0-2: the template materializes the scan-state entry before the terminal close-session', () => {
    assert.ok(template.includes('writeJsonFile(scanStateEntryPath'),
        'the template writes the scan-state entry file the close-session phase reads');
    assert.ok(template.includes('plan.terminal.scanStateEntry'),
        'the entry content comes from the generator-pinned plan field');
    // And the generator side is pinned in build-campaign-plan.test.js
    // (terminal.scanStateEntry with the trigger-derived lastScannedTag).
});

// ── T8: the frozen c4 capsule journal replays the acceptance identity chain ──

test('T8: the frozen m5-c4 journal is byte-identical to the campaign artifact', () => {
    const entries = readJournalEntries(JOURNAL_FIXTURE);
    assert.equal(entries.length, 4, 'prepared / observed / tree-delta / completion');
    assert.equal(digestSemantic(entries), C4_JOURNAL_DIGEST,
        'the fixture must stay byte-identical to the c4 campaign journal (tamper = red)');
});

test('T8: record identity lives ONLY in the rollback capsule — the capsule fallback is load-bearing', () => {
    const entries = readJournalEntries(JOURNAL_FIXTURE);
    const prepared = entries.find((entry) => entry.type === 'prepared');
    assert.ok(prepared, 'prepared entry present');
    // The c4 executor wrote NO flat identity — this is exactly the shape that
    // made c3 refuse acceptance until the capsule fallback landed.
    assert.equal(prepared.recordId, undefined);
    assert.equal(prepared.documentToken, undefined);
    assert.equal(prepared.rollbackCapsule?.beforeRecord?.recordId, C4_RECORD_ID);
    assert.equal(prepared.rollbackCapsule?.documentRollback?.documentToken, C4_DOCUMENT_TOKEN);

    const touched = touchedRecordsFromJournal(entries);
    assert.deepEqual(touched, [{
        actionId: 'python:Authentication:create_role',
        recordId: C4_RECORD_ID,
        documentToken: C4_DOCUMENT_TOKEN,
    }]);
});

test('T8: the real c4 session accepts the real c4 journal through the full acceptance pre-write validation', () => {
    const journalPath = JOURNAL_FIXTURE;
    const entries = readJournalEntries(journalPath);
    const session = JSON.parse(fs.readFileSync(SESSION_FIXTURE, 'utf8'));
    // The fixture stores a placeholder where the campaign session carried the
    // absolute journal path; substitute the fixture journal's real path.
    const rawSession = fs.readFileSync(SESSION_FIXTURE, 'utf8');
    assert.ok(rawSession.includes('__FIXTURE_JOURNAL_PATH__'), 'the residue fixture keeps the placeholder contract');
    const sessionText = rawSession.split('__FIXTURE_JOURNAL_PATH__').join(journalPath);
    const residue = JSON.parse(sessionText);
    assert.equal(residue.pendingExecutions.length, 1);
    assert.equal(residue.pendingExecutions[0].executionJournalDigest, C4_JOURNAL_DIGEST);
    void session;

    // The auto-acceptance segment's exact derivation (sdk-doc-sync:1086+):
    // touched identity from the journal, links from that identity.
    const unitTouched = touchedRecordsFromJournal(entries);
    const documentLinks = [...new Set(unitTouched.map((record) => `https://example-feishu/docx/${record.documentToken}`).filter(Boolean))];
    const recordLinks = [];
    for (const record of unitTouched) recordLinks.push(`https://example-feishu/bitable/${record.recordId}`);

    const receipt = buildAutoAcceptanceReceipt({
        reviewUnitId: C4_UNIT,
        executionJournalPath: journalPath,
        executionJournalDigest: C4_JOURNAL_DIGEST,
        entries,
        documentLinks,
        recordLinks,
    });
    assert.deepEqual(receipt.touchedRecords, [{
        actionId: 'python:Authentication:create_role',
        recordId: C4_RECORD_ID,
        documentToken: C4_DOCUMENT_TOKEN,
    }]);
    assert.equal(receipt.commentsResolved, true);

    // The two-gate pre-write validation against the REAL session: unit
    // membership, journal digest re-hash, touched→observed action binding,
    // non-empty links, pending-execution match — the acceptance layer the
    // review found reachable only live, replayed offline.
    const prepared = prepareDocumentAcceptance(residue, receipt);
    assert.deepEqual(prepared.touchedRecords, receipt.touchedRecords);
    assert.ok(prepared.reviewUnit, 'the c4 unit is a member of the 64-unit manifest');
});

test('T8: without the capsule fallback the auto-acceptance receipt is unreachable (why the fallback exists)', () => {
    const entries = readJournalEntries(JOURNAL_FIXTURE);
    // Flat-field-only derivation (the pre-c3-fallback world): no flat
    // recordId on the prepared entry → no touched records → the receipt
    // builder refuses. This is the c3 refusal, replayed.
    const flatOnly = entries.map((entry) => {
        if (entry.type !== 'prepared') return entry;
        const { rollbackCapsule, ...rest } = entry;
        void rollbackCapsule;
        return rest;
    });
    assert.deepEqual(touchedRecordsFromJournal(flatOnly), []);
    assert.throws(
        () => buildAutoAcceptanceReceipt({
            reviewUnitId: C4_UNIT,
            executionJournalPath: JOURNAL_FIXTURE,
            executionJournalDigest: C4_JOURNAL_DIGEST,
            entries: flatOnly,
            documentLinks: ['https://example-feishu/docx/x'],
            recordLinks: ['https://example-feishu/bitable/x'],
        }),
        /no record-touching journal entries/,
    );
});

// ── T8-full: the whole acceptance write path, c5 seam included ──────────────
//
// c5 (2026-10-22) exposed the NEXT onion layer: acceptDocumentTwoGate reads
// `prepared.reviewUnit.batchDigest` — a session manifest unit field that
// review-units.js strips BY DESIGN (the digest-stamped manifest carries no
// per-unit digests), so no code path could ever satisfy it. c2/c3/c4 each
// died at an earlier layer and this one was never reached. The fix threads the
// approvedBatchDigest (the digest the write gate itself enforced) from
// sdk-doc-sync through acceptExecutedUnit. These tests replay the ENTIRE
// function against the frozen session — no layer after prepareDocumentAcceptance
// may hide again.

function fakeBitableWriterFor(baselineTargets) {
    // Live state at acceptance time: the executor's updateRecord has already
    // set Progress back to WIP and never touches Targets (baseline survives).
    const record = { record_id: C4_RECORD_ID, fields: { Progress: 'WIP', Targets: [...baselineTargets] } };
    const writes = [];
    return {
        writes,
        listRecords: async () => [{ record_id: record.record_id, fields: { ...record.fields } }],
        updateRecord: async (recordId, payload) => {
            writes.push({ recordId, ...payload });
            if (payload.progress) record.fields.Progress = payload.progress;
            if (payload.targets) record.fields.Targets = [...payload.targets];
            return { record_id: recordId, fields: { ...record.fields } };
        },
    };
}

function loadResidueSessionWith(journalPath) {
    const raw = fs.readFileSync(SESSION_FIXTURE, 'utf8');
    assert.ok(raw.includes('__FIXTURE_JOURNAL_PATH__'), 'the residue fixture keeps the placeholder contract');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't8-acceptance-'));
    const sessionPath = path.join(tmp, 'session-state.json');
    fs.writeFileSync(sessionPath, raw.split('__FIXTURE_JOURNAL_PATH__').join(journalPath));
    const loaded = loadReviewSessionState(sessionPath);
    return { tmp, sessionPath, session: loaded.session, stateDigest: loaded.sessionDigest };
}

function c4Receipt(journalPath) {
    const entries = readJournalEntries(journalPath);
    const unitTouched = touchedRecordsFromJournal(entries);
    return {
        entries,
        receipt: buildAutoAcceptanceReceipt({
            reviewUnitId: C4_UNIT,
            executionJournalPath: journalPath,
            executionJournalDigest: C4_JOURNAL_DIGEST,
            entries,
            documentLinks: [...new Set(unitTouched.map((record) => `https://example-feishu/docx/${record.documentToken}`))],
            recordLinks: unitTouched.map((record) => `https://example-feishu/bitable/${record.recordId}`),
        }),
    };
}

test('T8-full: the entire acceptance write path replays green against the frozen c4 session (fake BitableWriter)', async () => {
    const journalPath = JOURNAL_FIXTURE;
    const { tmp, sessionPath, session, stateDigest } = loadResidueSessionWith(journalPath);
    const { receipt } = c4Receipt(journalPath);
    const writer = fakeBitableWriterFor(['Milvus', 'Zilliz']);
    const receiptWrites = [];

    const nextSession = await acceptExecutedUnit({
        session,
        sessionPath,
        sessionDigest: stateDigest,
        reviewUnitId: C4_UNIT,
        executionJournalPath: journalPath,
        executionJournalDigest: C4_JOURNAL_DIGEST,
        documentLinks: receipt.documentLinks,
        recordLinks: receipt.recordLinks,
        approvedBatchDigest: 'sha256:5fd55a08d39f6bff5ed0335c48448c5e0dd7409df36f55d63ac044d1e5d311b9',
        targetsJson: TARGETS_FIXTURE,
        bitableWriter: writer,
        out: () => {},
    });
    void receiptWrites;

    // The governed write: exactly one WIP→Draft transition carrying the A2
    // ruling's final Targets ([Milvus, Zilliz] for the shared create_role).
    assert.equal(writer.writes.length, 1);
    assert.deepEqual(writer.writes[0], { recordId: C4_RECORD_ID, progress: 'Draft', targets: ['Milvus', 'Zilliz'] });
    // The unit finalized in the returned AND the persisted session.
    assert.equal(unitStatusOf(nextSession, C4_UNIT), 'finalized');
    const reloaded = loadReviewSessionState(sessionPath);
    assert.equal(unitStatusOf(reloaded.session, C4_UNIT), 'finalized');
    assert.equal((reloaded.session.acceptedReviewUnits || []).length, 1);
    fs.rmSync(tmp, { recursive: true, force: true });
});

test('T8-full: without the threaded approvedBatchDigest the acceptance refuses with the exact c5 message (fail-closed pin)', async () => {
    const journalPath = JOURNAL_FIXTURE;
    const { tmp, sessionPath, session, stateDigest } = loadResidueSessionWith(journalPath);
    const { receipt } = c4Receipt(journalPath);
    const writer = fakeBitableWriterFor(['Milvus', 'Zilliz']);

    await assert.rejects(
        acceptDocumentTwoGate({
            session,
            sessionPath,
            sessionDigest: stateDigest,
            receipt,
            // No approvedBatchDigest AND no manifest digest — the c5 shape.
            args: { targetsJson: TARGETS_FIXTURE },
            io: { bitableWriter: writer, writeUnitReceipt: (file, content) => receiptWritesPush(file, content) },
            out: () => {},
        }),
        (error) => {
            assert.match(error.message, /Acceptance requires the unit's approved batch digest for review:python:Authentication:create_role/);
            return true;
        },
    );
    // Fail-closed: nothing was written to Feishu before the refusal.
    assert.equal(writer.writes.length, 0);
    fs.rmSync(tmp, { recursive: true, force: true });
});

function receiptWritesPush() {
    // the negative path must never reach the receipt write; kept as a named
    // no-op so an unexpected call is visible in a stack trace
}

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
//   T1 — RETIRED 2026-10-23 with the dwf template (redesign: the
//        straight-line runner bin/sdk-release-sync.js replaced the template
//        orchestration). The acceptance-targets chain T1 protected is now
//        pinned by the runner's engine argv + tests/sdk-release-sync.test.js.
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

const FIXTURES = path.resolve(__dirname, 'conformance-fixtures', 'api-reference-sync', 'python-v30-sync');
const JOURNAL_FIXTURE = path.join(FIXTURES, 'm5-c4-create-role-execution-journal.jsonl');
const COPY_JOURNAL_FIXTURE = path.join(FIXTURES, 'm5-c6-remove-privileges-copy-journal.jsonl');
const SESSION_FIXTURE = path.join(FIXTURES, 'm5-c4-session-residue.json');
const TARGETS_FIXTURE = path.join(FIXTURES, 'targets-python-v30.json');

// The m5 c4 campaign's own recorded journal digest (exec result
// executionJournalDigest of run m5-live-20261021-c4) — the fixture must stay
// byte-identical to the campaign artifact.
const C4_JOURNAL_DIGEST = 'sha256:6bab8ce4b663d95f5a0a298df66fe2f28d83b4618b7d9145d203b0c96d8669d3';
// The m5 c6 copy-shape journal (COPY_PATCH_AND_REPOINT refusal,
// run run8-20261022) — same byte-identity contract.
const C6_COPY_JOURNAL_DIGEST = 'sha256:d91033b0bd3914769293ca43db63f6cb3c4a37672569a6265f27e3eb1e48d808';
const C4_UNIT = 'review:python:Authentication:create_role';
const C4_RECORD_ID = 'recu3QwdFC0YXO';
const C4_DOCUMENT_TOKEN = 'HRqudGOOnokInhxczclcADBDn8g';
const COPY_UNIT = 'review:python:Authentication:remove_privileges_from_group';
const COPY_RECORD_ID = 'recuAAA5Ub7Lhm';
const COPY_DOCUMENT_TOKEN = 'Vm7vddGfYo6dYsxJi1Ycjuycnad';

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
    // Flat-field-only derivation (the pre-c3 world): no flat recordId on the
    // prepared entry AND no capsule/observed evidence either (the observed
    // fallback landed with the c6 copy fix — strip it too to model the era
    // before any fallback) → no touched records → the receipt builder
    // refuses. This is the c3 refusal, replayed.
    const flatOnly = entries.map((entry) => {
        if (entry.type === 'prepared') {
            const { rollbackCapsule, ...rest } = entry;
            void rollbackCapsule;
            return rest;
        }
        if (entry.type === 'observed') {
            const { rollbackEvidence, ...rest } = entry;
            void rollbackEvidence;
            return rest;
        }
        return entry;
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

function fakeBitableWriterFor(baselineTargets, recordId = C4_RECORD_ID) {
    // Live state at acceptance time: the executor's updateRecord has already
    // set Progress back to WIP and never touches Targets (baseline survives).
    const record = { record_id: recordId, fields: { Progress: 'WIP', Targets: [...baselineTargets] } };
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

// ── T8-copy: the c6 COPY_PATCH_AND_REPOINT shape (observed-evidence fallback) ──
//
// c6 froze on its SECOND unit with the c4 refusal message ("requires
// documentLinks and recordLinks") — copy-type actions produce the document
// AFTER the prepared entry, so its token lives only in the observed entry's
// rollbackEvidence (createdDocument.documentToken), and the journal→identity
// derivation never saw it. The derivation now falls back flat → capsule →
// observed, per field; these tests pin the copy shape (and CREATE inherits the
// same recordId fallback from rollbackEvidence/postRecord).

test('T8-copy: the frozen c6 copy journal is byte-identical and its identity derives from observed evidence', () => {
    const entries = readJournalEntries(COPY_JOURNAL_FIXTURE);
    assert.equal(digestSemantic(entries), C6_COPY_JOURNAL_DIGEST,
        'the fixture must stay byte-identical to the c6 campaign journal');
    const prepared = entries.find((entry) => entry.type === 'prepared');
    // The copy shape: capsule has the before-record but NO documentRollback,
    // and no flat identity — the document exists only in observed evidence.
    assert.ok(!prepared.rollbackCapsule?.documentRollback?.documentToken, 'no usable capsule document token');
    assert.equal(prepared.documentToken, undefined);
    const observed = entries.find((entry) => entry.type === 'observed');
    assert.equal(observed.rollbackEvidence.createdDocument.documentToken, COPY_DOCUMENT_TOKEN);
    assert.deepEqual(touchedRecordsFromJournal(entries), [{
        actionId: 'python:Authentication:remove_privileges_from_group',
        recordId: COPY_RECORD_ID,
        documentToken: COPY_DOCUMENT_TOKEN,
    }]);
    // Without the observed fallback the derivation yields no documentToken —
    // exactly the c6 refusal precondition (empty documentLinks).
    const preparedOnly = entries.filter((entry) => entry.type !== 'observed');
    assert.equal(touchedRecordsFromJournal(preparedOnly)[0].documentToken, null);
});

test('T8-copy: the full acceptance write path replays green for the copy shape (milvus-only baseline record)', async () => {
    const journalPath = COPY_JOURNAL_FIXTURE;
    const { tmp, sessionPath, session, stateDigest } = loadResidueSessionWith(journalPath);
    // Bind the residue session's pending execution to THIS unit's journal
    // (the residue fixture ships create_role's binding; the manifest covers
    // all 64 units, so rebinding is a session-shape edit, not a new fixture).
    const rebound = {
        ...session,
        pendingExecutions: [{
            reviewUnitId: COPY_UNIT,
            executionJournalPath: journalPath,
            executionJournalDigest: C6_COPY_JOURNAL_DIGEST,
            executedAt: session.pendingExecutions[0].executedAt,
        }],
        activeExecution: {
            ...session.activeExecution,
            reviewUnitId: COPY_UNIT,
            executionJournalPath: journalPath,
            executionJournalDigest: C6_COPY_JOURNAL_DIGEST,
        },
    };
    fs.writeFileSync(sessionPath, `${JSON.stringify(rebound, null, 2)}\n`);
    const reloaded = loadReviewSessionState(sessionPath);

    const entries = readJournalEntries(journalPath);
    const unitTouched = touchedRecordsFromJournal(entries);
    const writer = fakeBitableWriterFor(['Milvus'], COPY_RECORD_ID); // journal baseline: milvus-only record
    const nextSession = await acceptExecutedUnit({
        session: reloaded.session,
        sessionPath,
        sessionDigest: reloaded.sessionDigest,
        reviewUnitId: COPY_UNIT,
        executionJournalPath: journalPath,
        executionJournalDigest: C6_COPY_JOURNAL_DIGEST,
        documentLinks: [...new Set(unitTouched.map((record) => `https://example-feishu/docx/${record.documentToken}`))],
        recordLinks: unitTouched.map((record) => `https://example-feishu/bitable/${record.recordId}`),
        approvedBatchDigest: 'sha256:d9e14f3bc0dab5cd24b645f8bcf15abc5443f3602eb308cb198830c288c66b34',
        targetsJson: TARGETS_FIXTURE,
        bitableWriter: writer,
        out: () => {},
    });
    assert.equal(writer.writes.length, 1);
    assert.equal(writer.writes[0].recordId, COPY_RECORD_ID);
    assert.equal(writer.writes[0].progress, 'Draft');
    assert.equal(unitStatusOf(nextSession, COPY_UNIT), 'finalized');
    fs.rmSync(tmp, { recursive: true, force: true });
});

// ── T8-governance: the acceptance manifest artifact keying (c7 seam) ────────
//
// c7 froze at the canary's acceptance with RUN_MANIFEST_EVIDENCE_CONFLICT:
// the artifact was keyed by UNIT alone, and run N+1's re-acceptance (the dwf
// template rebuilds its session per run) minted different content at the same
// path. The exec side never had this problem — its batchDigest itself moves
// with the tree state. The artifact is now keyed by the manifest's OWN digest:
// identical content → same path → byte-equal pass; different content → fresh
// path. The fake writer here carries a governance object so the governance
// block (skipped by the governance-less fakes above) actually runs.

test('T8-governance: the acceptance manifest artifact is keyed by its own manifest digest', async () => {
    const artifactWrites = [];
    const makeGovernanceWriter = (baseline) => {
        const writer = { ...fakeBitableWriterFor(baseline) };
        writer.governance = {
            bindApproval: () => {},
            bindRunManifest: (manifest) => artifactWrites.push({ bound: manifest }),
        };
        return writer;
    };
    const acceptWith = async (approvedBatchDigest) => {
        const { tmp, sessionPath, session, stateDigest } = loadResidueSessionWith(JOURNAL_FIXTURE);
        const { receipt } = c4Receipt(JOURNAL_FIXTURE);
        const writer = makeGovernanceWriter(['Milvus', 'Zilliz']);
        await acceptDocumentTwoGate({
            session,
            sessionPath,
            sessionDigest: stateDigest,
            receipt,
            args: { approvedBatchDigest, targetsJson: TARGETS_FIXTURE },
            io: {
                bitableWriter: writer,
                // The per-unit receipt keeps its real durable write (its
                // digest is re-validated from the file at rest); only the
                // MANIFEST artifact write is redirected — it is the seam
                // under test and must not stain the canonical namespace.
                writeRunManifestArtifact: (manifest, { filePath }) => artifactWrites.push({ manifest, filePath }),
            },
            out: () => {},
        });
        fs.rmSync(tmp, { recursive: true, force: true });
    };
    const FIRST = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';
    const SECOND = 'sha256:2222222222222222222222222222222222222222222222222222222222222222';
    await acceptWith(FIRST);
    await acceptWith(SECOND);
    const writes = artifactWrites.filter((entry) => entry.filePath);
    assert.equal(writes.length, 2, 'one manifest artifact write per acceptance');
    assert.notEqual(writes[0].filePath, writes[1].filePath,
        'different approved digests (different runs) must land at different artifact paths — the c7 collision');
    for (const write of writes) {
        assert.match(write.filePath, /run-manifest-document-acceptance-review-python-Authentication-create-role-[0-9a-f]{16}\.json$/,
            'the artifact filename carries the manifestDigest slice');
        assert.ok([FIRST, SECOND].includes(write.manifest.batchDigest));
        assert.equal(write.manifest.sessionDigest, `document-acceptance:${C4_UNIT}`);
    }
    assert.notEqual(writes[0].manifest.manifestDigest, writes[1].manifest.manifestDigest,
        'the key is content-addressed: different content, different name');
});

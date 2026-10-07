#!/usr/bin/env node
'use strict';

// Governed revision executor (java v3.0.x content revision round) — the
// revision campaign's per-unit write step. The fix IS the write: the unit's
// reviewed fixed canonical markdown lands through the same writer-governance
// and pr-polish validation machinery the release pipeline uses, authorized
// by the operator's APPROVE_WRITES batch digest.
//
// Per unit, in order:
//   1. recompute the execution batch from the reviewed context and refuse
//      unless --approve-digest equals its digest (approval binds content);
//   2. fetch the live raw_content as the base and journal a base-capture
//      content-fidelity outcome (the digest chain binds the exact bytes the
//      fix was computed against, plus a full rollback capsule of the prior
//      page body);
//   3. apply the restructure polish manifest — semantic-content-map zero
//      loss, fenced-code immutability, table source citations, base digest
//      binding all run unchanged (applyPolishManifest);
//   4. land it as a governed whole-body rebuild (conversion MUST produce
//      blocks before the patch is allowed to touch the page — the
//      2026-10-01 zero-block incident guard);
//   5. verify: layout conformance on the live block tree (zero error
//      findings) and a line-for-line raw_content comparison against the
//      recomputed polished content;
//   6. journal the execution (prepared / observed{success,verified} /
//      completion sentinel, digestSemantic digest) and record it on the
//      session as the unit's pending execution for the two-gate acceptance.
//
// Never resumes through sdk-doc-sync; session transitions go through the
// store. All live calls are injectable for offline tests.
//
// Usage:
//   node bin/revision-apply.js --session <session.json> --review-unit-id <id>
//       --scope <scope.json> --contexts <contexts.json>
//       --approve-digest sha256:... [--journal <path>] [--json]

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { digestSemantic, sha256Digest } = require('../../doc-ops-core/src/digest');
const {
    WriterGovernance,
    createApprovalEnvelope,
} = require('../../doc-ops-core/src/writer-governance');
const { createActionBatch } = require('../../doc-ops-core/src/action-batch');
const { loadReviewSessionState, recordDocumentExecution, saveReviewSession } = require('../src/sdk-doc-sync/review-session-store');
const { captureRecordState } = require('../src/sdk-doc-sync/record-state');
const {
    applyPolishManifest,
    assertPolishPreconditions,
    comparePolishedContent,
} = require('../src/sdk-doc-sync/pr-polish');
const { verbatimContentDigest, normalizeVerbatimContent } = require('../src/sdk-doc-sync/verbatim-content');
const { checkLayoutConformance, pageFactsFromBlocks } = require('../src/sdk-doc-sync/layout-conformance');
const { blocksToMarkdown } = require('../src/sdk-doc-sync/blocks-to-markdown');
const sdkLayoutProfiles = require('../src/renderers/sdk-layout-profiles');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const LARK = 'lark-cli';

function parseArgs(argv) {
    const args = {};
    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--session') args.session = path.resolve(argv[++index]);
        else if (arg === '--review-unit-id') args.reviewUnitId = argv[++index];
        else if (arg === '--scope') args.scope = path.resolve(argv[++index]);
        else if (arg === '--contexts') args.contexts = path.resolve(argv[++index]);
        else if (arg === '--approve-digest') args.approveDigest = argv[++index];
        else if (arg === '--journal') args.journal = path.resolve(argv[++index]);
        else if (arg === '--base-token') args.baseToken = argv[++index];
        else if (arg === '--table-id') args.tableId = argv[++index];
        else if (arg === '--batch-continue') args.batchContinue = true;
        else if (arg === '--json') args.json = true;
        else throw new Error(`Unknown argument: ${arg}`);
    }
    for (const required of ['session', 'reviewUnitId', 'scope', 'contexts', 'approveDigest', 'baseToken', 'tableId']) {
        if (!args[required]) {
            throw new Error(`Missing required argument: --${required.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
        }
    }
    return args;
}

function larkApi(method, pathname, params, data) {
    const result = spawnSync(LARK, ['api', method, pathname,
        ...(params ? ['--params', JSON.stringify(params)] : []),
        ...(data ? ['--data', JSON.stringify(data)] : []),
        '--format', 'json'], { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
    if (result.error) throw result.error;
    let parsed = null;
    try {
        parsed = JSON.parse(result.stdout);
    } catch (error) {
        throw new Error(`lark-cli output is not JSON: ${result.stdout.slice(0, 200)}`);
    }
    if (parsed.ok === false || (parsed.code && parsed.code !== 0)) {
        throw new Error(`lark-cli ${method} ${pathname} failed: ${JSON.stringify(parsed.error || parsed).slice(0, 300)}`);
    }
    return parsed;
}

function fetchRawContent(documentToken) {
    const parsed = larkApi('GET', `/open-apis/docx/v1/documents/${documentToken}/raw_content`);
    return (parsed.data && parsed.data.content) || '';
}

function fetchRecordState(baseToken, tableId, recordId) {
    const parsed = larkApi('GET', `/open-apis/bitable/v1/apps/${baseToken}/tables/${tableId}/records/${recordId}`);
    return (parsed.data && parsed.data.record) || null;
}

// Governed record re-open: revision rounds re-open records finalized by the
// previous campaign (Progress Draft → WIP) so the two-gate acceptance
// WIP→Draft transition is legal again. Goes through the same BitableWriter
// governance the acceptance writes use.
function reopenRecordWip({ baseToken, tableId, recordId }, governance) {
    const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
    const writer = new BitableWriter({ baseToken, tableId, governance });
    return writer.updateRecord(recordId, { progress: 'WIP' });
}

function fetchBlocks(documentToken) {
    const items = [];
    let pageToken = undefined;
    // Pages may exceed one 500-block page: walk has_more to the end — a
    // truncated block tree would silently drop structure from the map base.
    for (;;) {
        const params = pageToken ? { page_size: 500, page_token: pageToken } : { page_size: 500 };
        const parsed = larkApi('GET', `/open-apis/docx/v1/documents/${documentToken}/blocks`, params);
        items.push(...((parsed.data && parsed.data.items) || []));
        if (parsed.data?.has_more && parsed.data?.page_token) {
            pageToken = parsed.data.page_token;
            continue;
        }
        return items;
    }
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function loadContextEntries(filePath) {
    const raw = readJson(filePath);
    const container = raw.contexts || raw.byStableId || raw.bySlug || null;
    if (!container || typeof container !== 'object' || Array.isArray(container)) {
        throw new Error('Contexts document must carry a contexts/byStableId/bySlug object');
    }
    return container;
}

// Table citations ride the context's reviewedEvidence (kind 'source' with a
// tableHeader) — the same evidence the intake preflight already verifies
// against the SDK checkout. No extra context keys, so the certified
// intake-preflight contract stays untouched.
function sourcesFromContext(entry) {
    return (entry.reviewedEvidence || [])
        .filter((item) => item && item.kind === 'source' && item.tableHeader)
        .map((item) => ({
            tableHeader: item.tableHeader,
            path: item.path || item.locator || '',
            lines: item.lines || [],
        }));
}

function buildRevisionBatch({ stableId, reviewUnitId, documentToken, recordId, fixedContent, sources }) {
    const planDigest = digestSemantic({
        schemaVersion: 1,
        stableId,
        mode: 'restructure',
        documentToken,
        recordId,
        replacementContentDigest: sha256Digest(fixedContent),
        sources,
    });
    return createActionBatch({
        skill: 'api-reference-sync',
        operation: 'revision-apply',
        actions: [{
            actionId: stableId,
            target: reviewUnitId,
            dependsOn: [],
            // The record re-open (Progress → WIP) is part of the unit's
            // execution: revision rounds re-open records finalized by the
            // previous campaign so the acceptance WIP→Draft transition is
            // legal again.
            sideEffects: ['feishu.docx.patch', 'bitable.update'],
            planDigest,
        }],
    });
}

// Governed whole-body rebuild: conversion happens FIRST and must yield
// blocks before the patch is allowed to touch the page — patch_document's
// rebuild deletes the body before creating, so a zero-block conversion would
// wipe the page (incident 2026-10-01).
async function rebuildPage({ governance, documentToken, replacementContent }) {
    const MarkdownToFeishu = require('../src/markdown-to-feishu');
    const renderer = new MarkdownToFeishu({ governance });
    const { tokens } = await renderer.parse_markdown(replacementContent);
    const blocks = await renderer.markdown_to_blocks(tokens);
    if (!Array.isArray(blocks) || blocks.length === 0) {
        throw Object.assign(
            new Error('Revision rebuild conversion produced zero blocks; refusing to patch the live page'),
            { code: 'REVISION_REBUILD_CONVERSION_EMPTY' },
        );
    }
    await renderer.patch_document({ document_id: documentToken, blocks, strategy: 'rebuild' });
    return blocks.length;
}

function assertLiveLayoutConformance(documentToken, blocks) {
    const profile = sdkLayoutProfiles.java;
    const facts = pageFactsFromBlocks(blocks);
    // Every violation checkLayoutConformance reports is disqualifying: the
    // landed page must be fully conformant, not merely better than before.
    const { violations } = checkLayoutConformance(profile, facts);
    if (violations.length > 0) {
        const error = new Error(`Live layout conformance failed for ${documentToken}: ${violations.map((finding) => `${finding.code} ${finding.detail || ''}`.trim()).join('; ')}`);
        error.code = 'REVISION_LAYOUT_VERIFY_FAILED';
        throw error;
    }
}

async function runCli({ argv = process.argv, dependencies = {} } = {}) {
    const args = parseArgs(argv);
    const fetchRawContentFn = dependencies.fetchRawContent || fetchRawContent;
    const fetchBlocksFn = dependencies.fetchBlocks || fetchBlocks;
    const fetchRecordStateFn = dependencies.fetchRecordState || fetchRecordState;
    const reopenRecordFn = dependencies.reopenRecord
        || ((recordId) => reopenRecordWip({ baseToken: args.baseToken, tableId: args.tableId, recordId }, governance));

    const { session, sessionDigest } = loadReviewSessionState(path.resolve(args.session));
    if (session.scanStateUpdated === true) {
        throw new Error('Review session is finalized; revision units are terminal (corrective release instead)');
    }
    const unit = (session.reviewUnitManifest.units || []).find((item) => item.reviewUnitId === args.reviewUnitId);
    if (!unit) throw new Error(`Unknown review unit: ${args.reviewUnitId}`);
    if ((session.acceptedReviewUnits || []).some((item) => item.reviewUnitId === args.reviewUnitId)) {
        throw new Error(`Review unit already accepted: ${args.reviewUnitId}`);
    }

    const scope = readJson(args.scope);
    const action = (scope.actions || []).find((item) => item.stableId === unit.documentStableId);
    if (!action) {
        throw new Error(`Scope artifact has no action for ${unit.documentStableId}; regenerate the scope from the current sweep`);
    }
    const contexts = loadContextEntries(args.contexts);
    const entry = contexts[unit.documentStableId];
    if (!entry || typeof entry.verbatimContent !== 'string' || entry.verbatimContent.trim() === '') {
        throw new Error(`No reviewed fixed content for ${unit.documentStableId}`);
    }
    const sources = sourcesFromContext(entry);

    const batch = buildRevisionBatch({
        stableId: unit.documentStableId,
        reviewUnitId: args.reviewUnitId,
        documentToken: action.documentToken,
        recordId: action.recordId,
        fixedContent: entry.verbatimContent,
        sources,
    });
    if (args.approveDigest !== batch.batchDigest) {
        throw Object.assign(
            new Error(`Approval digest mismatch: the write gate approved ${batch.batchDigest}, got ${args.approveDigest}. The reviewed content changed since approval — re-present the write gate.`),
            { code: 'REVISION_APPROVAL_DIGEST_MISMATCH' },
        );
    }
    const batchDigest = batch.batchDigest;

    const governance = new WriterGovernance({ skill: 'api-reference-sync', operation: 'revision-apply' });
    governance.bindApproval({
        batchDigest,
        actionCount: 1,
        targets: [args.reviewUnitId, action.recordId],
        sideEffects: ['feishu.docx.patch', 'bitable.update'],
        approval: createApprovalEnvelope({
            skill: 'api-reference-sync',
            operation: 'revision-apply',
            batchDigest,
            actionCount: 1,
            targets: [args.reviewUnitId, action.recordId],
            sideEffects: ['feishu.docx.patch', 'bitable.update'],
            decision: 'approved',
        }),
        invariantAttestations: [],
    });
    const { createRunManifest, writeRunManifestArtifact } = require('../../doc-ops-core/src/run-manifest');
    governance.bindRunManifest(createRunManifest({
        skill: 'api-reference-sync',
        skillVersion: 'api-reference-sync/revision-apply@1',
        repoRoot: REPO_ROOT,
        batchDigest,
        sessionDigest: `revision-apply:${args.reviewUnitId}`,
    }), { repoRoot: REPO_ROOT });
    writeRunManifestArtifact(governance.run, {
        filePath: path.join(REPO_ROOT, 'tmp', 'api-reference-sync', `run-manifest-revision-apply-${args.reviewUnitId.replace(/[^A-Za-z0-9-]/g, '-')}.json`),
    });

    const documentToken = action.documentToken;
    // The semantic map base must be the AUTHORED form of the CURRENT page:
    // raw_content strips code fences and bullet prefixes, so a raw-derived
    // base sees zero items/code and would refuse the authored fixed content
    // for "adding" structure the live page already carries. Reconstruct the
    // authored base from the live block tree instead (blocksToMarkdown is
    // proven canonical against raw_content by its fixture set). The raw
    // bytes stay bound as the rollback capsule and the terminal comparator.
    const priorBlocks = await fetchBlocksFn(documentToken);
    const baseContent = blocksToMarkdown(priorBlocks);
    const priorRawContent = await fetchRawContentFn(documentToken);
    // Record state capture (BEFORE any mutation): the acceptance contract
    // derives the Targets baseline from the prepared entry's rollback capsule
    // beforeRecord, and the re-open below needs the pre-mutation Progress.
    const recordBefore = captureRecordState(await fetchRecordStateFn(args.baseToken, args.tableId, action.recordId));

    const journalPath = args.journal
        || path.join(REPO_ROOT, 'tmp', 'api-reference-sync', `${batchDigest.replace(/:/g, '-')}.jsonl`);
    if (fs.existsSync(journalPath)) {
        throw Object.assign(
            new Error(`Execution journal already exists: ${journalPath}; return EXECUTION_RECONCILIATION_REQUIRED — reconcile live state first, never delete or replay the journal`),
            { code: 'EXECUTION_RECONCILIATION_REQUIRED' },
        );
    }
    const journalLines = [];

    const writeJournal = () => {
        fs.mkdirSync(path.dirname(journalPath), { recursive: true });
        fs.writeFileSync(journalPath, `${journalLines.map((line) => JSON.stringify(line)).join('\n')}\n`);
    };
    const failJournal = (message) => {
        journalLines.push({
            schemaVersion: 1,
            type: 'observed',
            operation: 'revision-apply',
            actionId: unit.documentStableId,
            reviewUnitId: args.reviewUnitId,
            documentToken,
            status: 'failed',
            verified: false,
            error: message.slice(0, 300),
        });
        journalLines.push({ schemaVersion: 1, type: 'completion', status: 'verification_failed', scanStateUpdated: false });
        writeJournal();
    };

    // Base capture BEFORE any mutation: the content-fidelity outcome binds
    // the exact live bytes the fix was computed against, and the rollback
    // capsule preserves the prior page body for pre-finalization rollback.
    const baseOutcome = {
        schemaVersion: 1,
        type: 'content-fidelity',
        invariantId: 'api.pr-verbatim-content',
        decision: 'revision-base-captured',
        actionId: unit.documentStableId,
        documentToken,
        batchDigest,
        contentDigest: verbatimContentDigest(baseContent),
        priorRawContentDigest: verbatimContentDigest(priorRawContent),
        ok: true,
    };
    journalLines.push(baseOutcome);
    assertPolishPreconditions({ contentFidelity: baseOutcome, baseContent });

    const manifest = {
        schemaVersion: 1,
        mode: 'restructure',
        unit: args.reviewUnitId,
        baseContentDigest: verbatimContentDigest(baseContent),
        rationale: action.reason,
        replacementContent: entry.verbatimContent,
        sources,
    };
    const { polishedContent, provenance } = applyPolishManifest({ manifest, baseContent });

    journalLines.push({
        schemaVersion: 1,
        type: 'prepared',
        operation: 'revision-apply',
        actionId: unit.documentStableId,
        reviewUnitId: args.reviewUnitId,
        documentToken,
        recordId: action.recordId,
        batchDigest,
        manifestDigest: provenance.manifestDigest,
        baseContentDigest: provenance.baseContentDigest,
        mode: 'restructure',
        defectCodes: action.defects.map((defect) => defect.code),
        rollbackCapsule: {
            documentToken,
            recordId: action.recordId,
            priorRawContent,
            priorRawContentDigest: verbatimContentDigest(priorRawContent),
            priorBodyContentDigest: verbatimContentDigest(baseContent),
            beforeRecord: recordBefore,
        },
    });
    // Durable BEFORE the mutation: a crash after the rebuild must leave the
    // prepared journal (and its rollback capsule) on disk.
    writeJournal();

    const rebuildFn = dependencies.rebuildPage || rebuildPage;
    let rebuildBlocks;
    try {
        rebuildBlocks = await rebuildFn({ governance, documentToken, replacementContent: manifest.replacementContent });
    } catch (error) {
        failJournal(error.message);
        throw error;
    }

    // Post-write verification on the LIVE state before the journal may
    // complete: layout conformance on the live block tree, then a
    // line-for-line comparison of the reconstructed block-tree text against
    // the recomputed bytes. The comparison source is the BLOCK TREE
    // (blocksToMarkdown), not raw_content: raw_content's serialization of
    // nested bullet children is unreliable (observed 2026-10-07 on
    // updateUser — child sub-blocks emitted twice while the block tree held
    // them once), so a raw projection can disagree with a correct page.
    let liveBlocks;
    try {
        liveBlocks = await fetchBlocksFn(documentToken);
        assertLiveLayoutConformance(documentToken, liveBlocks);
    } catch (error) {
        failJournal(error.code ? `${error.code}: ${error.message}` : error.message);
        throw error;
    }
    // dropLeadingTitle unconditionally consumes the first observed line —
    // designed for raw_content (which leads with the page title). The
    // block-tree reconstruction carries no title line, so prepend a
    // PLACEHOLDER title line to the observed side for the comparator to
    // drop — otherwise the first body line would be consumed. The
    // reconstruction also goes through the same normalizeVerbatimContent
    // the expected side gets: it strips the trailing web-content metadata
    // comment the expected side is normalized without, keeping the two
    // sides symmetric.
    const rebuiltContent = normalizeVerbatimContent('__REVISION_PAGE_TITLE__\n' + blocksToMarkdown(liveBlocks));
    const comparison = comparePolishedContent({ polishedContent, rawContent: rebuiltContent });
    if (!comparison.ok) {
        failJournal(`terminal block-tree comparison failed: ${JSON.stringify(comparison.diffs).slice(0, 240)}`);
        const error = new Error(`Revision terminal verification failed for ${documentToken}: ${JSON.stringify(comparison.diffs).slice(0, 300)}`);
        error.code = 'PR_POLISH_CONTENT_VERIFICATION_FAILED';
        throw error;
    }

    // Post-write tree-delta outcome (api.versioned-tree-delta): a revision
    // rebuild is an in-place whole-body transition — same documentToken, same
    // recordId, no placement change. ok:true is earned by the two verifications
    // above (live layout conformance + line-for-line block-tree comparison), which
    // prove the landed body is the approved content; the unit-evidence
    // acceptance contract requires this journaled outcome to exist.
    journalLines.push({
        schemaVersion: 1,
        type: 'tree-delta',
        invariantId: 'api.versioned-tree-delta',
        decision: 'revision-rebuild-in-place',
        actionId: unit.documentStableId,
        reviewUnitId: args.reviewUnitId,
        documentToken,
        recordId: action.recordId,
        priorBodyContentDigest: verbatimContentDigest(baseContent),
        newBodyContentDigest: verbatimContentDigest(rebuiltContent),
        rebuildBlocks,
        placementUnchanged: true,
        ok: true,
    });
    // Record re-open (governed): the record was finalized to Draft by the
    // previous campaign; the two-gate acceptance transition (WIP→Draft +
    // Targets final value) requires it back at WIP. The full pre-mutation
    // state rides the rollback capsule above.
    try {
        await reopenRecordFn(action.recordId);
    } catch (error) {
        failJournal(`record re-open to WIP failed: ${String(error.message).slice(0, 200)}`);
        throw error;
    }
    journalLines.push({
        schemaVersion: 1,
        type: 'observed',
        operation: 'revision-apply',
        actionId: unit.documentStableId,
        reviewUnitId: args.reviewUnitId,
        documentToken,
        recordId: action.recordId,
        status: 'success',
        verified: true,
        rebuild: true,
        rebuildBlocks,
        recordReopen: {
            recordId: action.recordId,
            beforeProgress: recordBefore.rawFields.Progress || '(blank)',
            afterProgress: 'WIP',
        },
        polishedContentDigest: sha256Digest(polishedContent),
        sourcesDigest: provenance.sourcesDigest || null,
    });
    journalLines.push({
        schemaVersion: 1,
        type: 'completion',
        status: 'executed',
        completionSentinel: true,
        scanStateUpdated: false,
    });
    writeJournal();
    const journalDigest = digestSemantic(journalLines);

    const nextSession = recordDocumentExecution(session, {
        reviewUnitId: args.reviewUnitId,
        executionJournalPath: journalPath,
        executionJournalDigest: journalDigest,
    }, { batchContinue: args.batchContinue === true });
    saveReviewSession(path.resolve(args.session), nextSession, { expectedPreviousDigest: sessionDigest });

    const result = {
        status: 'EXECUTED',
        reviewUnitId: args.reviewUnitId,
        documentToken,
        recordId: action.recordId,
        batchDigest,
        journalPath,
        journalDigest,
        polishedContentDigest: sha256Digest(polishedContent),
    };
    if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else process.stdout.write(`Revision applied: ${args.reviewUnitId} (terminal verified, journal ${journalDigest.slice(0, 18)}…)\n`);
    return result;
}

module.exports = {
    buildRevisionBatch,
    rebuildPage,
    runCli,
    sourcesFromContext,
};

if (require.main === module) {
    runCli().catch((error) => {
        process.stderr.write(`${error.code ? `${error.code}: ` : ''}${error.message}\n`);
        process.exitCode = 1;
    });
}

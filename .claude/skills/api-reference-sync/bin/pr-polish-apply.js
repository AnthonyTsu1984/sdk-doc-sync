#!/usr/bin/env node
'use strict';

// Governed application of a validated post-verbatim polish manifest
// (api.pr-polish-governed, application step). The polish is authorized under
// the unit's already-approved write batch (--approve-digest must equal the
// executed batch digest); prose edits are anchored text replacements over
// prose blocks applied through writer governance, restructure manifests
// (2026-10-01 semantic ruling) rebuild the page body from the canonical
// replacement content through the same governed writer, and the run
// completes only after the refetched raw_content compares line-for-line
// against the recomputed polished content through the declared
// canonicalization.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const { sha256Digest } = require('../../doc-ops-core/src/digest');
const {
    WriterGovernance,
    createApprovalEnvelope,
} = require('../../doc-ops-core/src/writer-governance');
const { loadReviewSessionState } = require('../src/sdk-doc-sync/review-session-store');
const { planPolishBlockEdits, PolishApplyError } = require('../src/sdk-doc-sync/pr-polish-apply');
const {
    applyPolishManifest,
    assertPolishPreconditions,
    comparePolishedContent,
    RESTRUCTURE_MODE,
} = require('../src/sdk-doc-sync/pr-polish');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const LARK = 'lark-cli';

function parseArgs(argv) {
    const args = {};
    // Single-purpose bin: no subcommand token; options start at argv[2].
    for (let index = 2; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--session' && argv[index + 1]) args.session = argv[++index];
        else if (argument === '--review-unit-id' && argv[index + 1]) args.reviewUnitId = argv[++index];
        else if (argument === '--base-content' && argv[index + 1]) args.baseContent = path.resolve(argv[++index]);
        else if (argument === '--fidelity-outcome' && argv[index + 1]) args.fidelityOutcome = path.resolve(argv[++index]);
        else if (argument === '--manifest' && argv[index + 1]) args.manifest = path.resolve(argv[++index]);
        else if (argument === '--polished-output' && argv[index + 1]) args.polishedOutput = path.resolve(argv[++index]);
        else if (argument === '--provenance-output' && argv[index + 1]) args.provenanceOutput = path.resolve(argv[++index]);
        else if (argument === '--journal' && argv[index + 1]) args.journal = path.resolve(argv[++index]);
        else if (argument === '--approve-digest' && argv[index + 1]) args.approveDigest = argv[++index];
        else if (argument === '--doc-token' && argv[index + 1]) args.docToken = argv[++index];
        else if (argument === '--json') args.json = true;
        else throw new Error(`Unknown argument: ${argument}`);
    }
    for (const required of ['session', 'reviewUnitId', 'baseContent', 'fidelityOutcome', 'manifest', 'polishedOutput', 'provenanceOutput', 'journal', 'approveDigest']) {
        if (!args[required]) {
            throw new Error(`Missing required argument: --${required.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
        }
    }
    return args;
}

function larkApi(method, pathname, params, data) {
    const argv = [LARK, 'api', method, pathname];
    if (params) argv.push('--params', JSON.stringify(params));
    if (data) argv.push('--data', JSON.stringify(data));
    argv.push('--format', 'json');
    const result = spawnSync(LARK, argv.slice(1), { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
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

function fetchBlocks(documentToken) {
    const parsed = larkApi('GET', `/open-apis/docx/v1/documents/${documentToken}/blocks`, { page_size: 500 });
    return (parsed.data && parsed.data.items) || [];
}

function fetchRawContent(documentToken) {
    const parsed = larkApi('GET', `/open-apis/docx/v1/documents/${documentToken}/raw_content`);
    return (parsed.data && parsed.data.content) || '';
}

function patchTextBlock(documentToken, blockId, content) {
    return larkApi(
        'PATCH',
        `/open-apis/docx/v1/documents/${documentToken}/blocks/${blockId}`,
        null,
        { update_text_elements: { elements: [{ text_run: { content } }] } },
    );
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function out(line) {
    process.stdout.write(`${line}\n`);
}

async function runCli({ argv = process.argv, env = process.env, dependencies = {} } = {}) {
    const args = parseArgs(argv);
    const larkApiFn = dependencies.larkApi || larkApi;

    const { session } = loadReviewSessionState(path.resolve(args.session));
    if (session.scanStateUpdated === true) {
        throw new Error('Review session is finalized; polish cannot touch a finalized page (corrective release instead)');
    }
    const pendings = Array.isArray(session.pendingExecutions)
        ? session.pendingExecutions
        : (session.activeExecution ? [session.activeExecution] : []);
    const pending = pendings.find((item) => item.reviewUnitId === args.reviewUnitId);
    if (!pending) {
        throw new Error(`Review unit has no pending execution to polish: ${args.reviewUnitId}`);
    }
    // The polish is authorized under the unit's approved write batch (option-A
    // wiring): the digest the operator approved for the execution also covers
    // the governed polish application on the executed page.
    const journalEntries = fs.readFileSync(pending.executionJournalPath, 'utf8')
        .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const batchDigest = journalEntries[0] && journalEntries[0].batchDigest;
    if (args.approveDigest !== batchDigest) {
        throw new Error(`Polish approval digest mismatch: the unit executed under ${batchDigest}, got ${args.approveDigest}`);
    }

    const manifest = readJson(args.manifest);
    const baseContent = fs.readFileSync(args.baseContent, 'utf8');
    const contentFidelity = readJson(args.fidelityOutcome);
    // Fail-closed sequencing: no verified verbatim landing for THESE bytes,
    // no polish (digest-gated inside).
    assertPolishPreconditions({ contentFidelity, baseContent });

    const governance = new WriterGovernance({ skill: 'api-reference-sync', operation: 'pr-polish-apply' });
    const actionCount = manifest.mode === RESTRUCTURE_MODE ? 1 : manifest.edits.length;
    governance.bindApproval({
        batchDigest,
        actionCount,
        targets: [args.reviewUnitId],
        sideEffects: ['feishu.docx.patch'],
        approval: createApprovalEnvelope({
            skill: 'api-reference-sync',
            operation: 'pr-polish-apply',
            batchDigest,
            actionCount,
            targets: [args.reviewUnitId],
            sideEffects: ['feishu.docx.patch'],
            decision: 'approved',
        }),
        invariantAttestations: [],
    });
    const { createRunManifest, writeRunManifestArtifact } = require('../../doc-ops-core/src/run-manifest');
    governance.bindRunManifest(createRunManifest({
        skill: 'api-reference-sync',
        skillVersion: 'api-reference-sync/pr-polish-apply@1',
        repoRoot: REPO_ROOT,
        batchDigest,
        sessionDigest: `pr-polish-apply:${args.reviewUnitId}`,
    }), { repoRoot: REPO_ROOT });
    writeRunManifestArtifact(governance.run, {
        filePath: path.join(REPO_ROOT, 'tmp', 'api-reference-sync', `run-manifest-pr-polish-apply-${args.reviewUnitId.replace(/[^A-Za-z0-9-]/g, '-')}.json`),
    });

    const { polishedContent, provenance } = applyPolishManifest({ manifest, baseContent });

    const documentToken = args.docToken
        || (journalEntries.find((entry) => entry.type === 'observed' && entry.rollbackEvidence && entry.rollbackEvidence.createdDocument) || { rollbackEvidence: { createdDocument: {} } }).rollbackEvidence.createdDocument.documentToken;
    if (!documentToken) {
        throw new Error('No document token: pass --doc-token or ensure the execution journal recorded the created document');
    }

    if (fs.existsSync(args.journal)) {
        throw new Error(`Polish journal already exists: ${args.journal}`);
    }
    const journalLines = [];
    const journal = {
        prepared(entry) { journalLines.push(entry); },
        observed(entry) { journalLines.push(entry); },
        complete(status) { journalLines.push({ schemaVersion: 1, type: 'completion', status, polishSentinel: true, scanStateUpdated: false }); },
    };
    journal.prepared({
        schemaVersion: 1,
        type: 'prepared',
        operation: 'pr-polish-apply',
        reviewUnitId: args.reviewUnitId,
        documentToken,
        batchDigest,
        manifestDigest: provenance.manifestDigest,
        baseContentDigest: provenance.baseContentDigest,
        mode: manifest.mode === RESTRUCTURE_MODE ? RESTRUCTURE_MODE : 'prose',
        edits: manifest.mode === RESTRUCTURE_MODE
            ? []
            : manifest.edits.map((edit) => ({ anchor: edit.anchor, replacement: edit.replacement })),
    });

    let applied = 0;
    if (manifest.mode === RESTRUCTURE_MODE) {
        // Restructure application is a governed whole-body rebuild: the
        // canonical content converts to blocks and replaces the page body.
        // PR-verbatim pages carry no foreign preserved blocks (whiteboards
        // live elsewhere), so the rebuild path is safe here.
        journal.observed({
            schemaVersion: 1,
            type: 'observed',
            operation: 'pr-polish-apply',
            reviewUnitId: args.reviewUnitId,
            documentToken,
            rebuild: true,
            sourcesDigest: provenance.sourcesDigest,
        });
        if (dependencies.patchDocument) {
            await dependencies.patchDocument(documentToken, manifest.replacementContent, 'rebuild');
        } else {
            // Conversion happens FIRST and must yield blocks before the patch
            // is allowed to touch the page: patch_document's rebuild deletes
            // the body before creating, so a zero-block conversion would wipe
            // the page (incident 2026-10-01: parse_markdown returns { tokens
            // } — passing the wrapper object produced 0 blocks and the
            // rebuild deleted without creating).
            const MarkdownToFeishu = require('../src/markdown-to-feishu');
            const renderer = new MarkdownToFeishu({ governance });
            const { tokens } = await renderer.parse_markdown(manifest.replacementContent);
            const blocks = await renderer.markdown_to_blocks(tokens);
            if (!Array.isArray(blocks) || blocks.length === 0) {
                throw new PolishApplyError('PR_POLISH_REBUILD_CONVERSION_EMPTY', 'rebuild conversion produced zero blocks; refusing to patch the live page');
            }
            journal.observed({
                schemaVersion: 1,
                type: 'observed',
                operation: 'pr-polish-apply',
                reviewUnitId: args.reviewUnitId,
                documentToken,
                rebuildBlocks: blocks.length,
            });
            await renderer.patch_document({ document_id: documentToken, blocks, strategy: 'rebuild' });
        }
        applied = 1;
    } else {
        const blocks = await Promise.resolve(dependencies.fetchBlocks
            ? dependencies.fetchBlocks(documentToken)
            : fetchBlocks(documentToken));
        const planned = planPolishBlockEdits(blocks, manifest.edits);

        for (const edit of planned) {
            if (dependencies.patchTextBlock) {
                await dependencies.patchTextBlock(documentToken, edit.blockId, edit.contentAfter);
            } else {
                patchTextBlock(documentToken, edit.blockId, edit.contentAfter);
            }
            applied += 1;
            journal.observed({
                schemaVersion: 1,
                type: 'observed',
                operation: 'pr-polish-apply',
                reviewUnitId: args.reviewUnitId,
                blockId: edit.blockId,
                anchor: edit.anchor,
                applied: applied,
            });
        }
    }

    const rawContent = dependencies.fetchRawContent
        ? await dependencies.fetchRawContent(documentToken)
        : fetchRawContent(documentToken);
    const comparison = comparePolishedContent({ polishedContent, rawContent });
    if (!comparison.ok) {
        journal.complete('verification_failed');
        fs.writeFileSync(args.journal, `${journalLines.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
        const error = new Error(`Polish terminal verification failed: ${JSON.stringify(comparison.diffs).slice(0, 300)}`);
        error.code = 'PR_POLISH_CONTENT_VERIFICATION_FAILED';
        throw error;
    }

    fs.writeFileSync(args.polishedOutput, polishedContent);
    fs.writeFileSync(args.provenanceOutput, `${JSON.stringify({ ...provenance, documentToken, reviewUnitId: args.reviewUnitId, batchDigest }, null, 2)}\n`);
    journal.complete('polished');
    fs.writeFileSync(args.journal, `${journalLines.map((entry) => JSON.stringify(entry)).join('\n')}\n`);

    const result = {
        status: 'POLISHED',
        reviewUnitId: args.reviewUnitId,
        documentToken,
        batchDigest,
        appliedEdits: applied,
        polishedContentDigest: sha256Digest(Buffer.from(polishedContent, 'utf8')),
        provenance,
        journalPath: args.journal,
    };
    if (args.json) out(JSON.stringify(result, null, 2));
    else out(`Polish applied: ${args.reviewUnitId} (${applied} edits, terminal verified)`);
    return result;
}

module.exports = { runCli, parseArgs };

if (require.main === module) {
    runCli().catch((error) => {
        process.stderr.write(`Error: ${error.message}\n`);
        process.exit(1);
    });
}

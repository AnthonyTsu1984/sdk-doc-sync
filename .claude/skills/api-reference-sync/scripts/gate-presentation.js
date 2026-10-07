#!/usr/bin/env node
'use strict';

// Gate presentation three-piece (campaign-control hardening batch 3,
// docs/campaign-control-hardening.md §5, 2026-10-03 user ruling): gate cards
// render as PLAIN TEXT — markdown links and bare URLs are both unclickable
// there, yet the presentation materials (write-approval previews = the page
// verbatim, live pages, records, session files) are exactly what the
// operator must see to decide. Instead of hoping the runner relays links,
// this script makes the presentation deterministic:
//   1. writes a numbered local index (tmp/api-reference-sync/
//      gate-presentation/latest.html) holding every material link;
//   2. auto-opens it (single link → that URL; several → the index) via the
//      platform `open` on darwin;
//   3. copies the primary target to the clipboard (pbcopy) as the fallback.
// The gate CARD then carries only digest + unit list + the index path —
// this script's emitted card snippet contains no URLs, and it enforces that
// on itself (GATE_CARD_LINK_LEAK). Batch completion reports use the same
// treatment.
//
// Inputs (exactly one):
//   --manifest <file>   { gate, title?, run?, digest?, session?,
//                         links: [{ label, url }] }
//   --from-dryrun <file>  sdk-doc-sync dry-run JSON — extracts
//                         writeApprovalPresentation[] (document/record
//                         links per planned entry) as APPROVE_WRITES
//                         materials
// Flags:
//   --index-dir <dir>   default tmp/api-reference-sync/gate-presentation
//   --json              machine-readable result
//   --no-open / --no-clipboard   skip the side effects (tests, CI)
// Env: GATE_PRESENTATION_NO_OPEN=1 / GATE_PRESENTATION_NO_CLIPBOARD=1
//
// Exit 0 on success; 1 on GATE_PRESENTATION_MANIFEST_INVALID (nothing is
// written — a malformed presentation never partially reaches the operator)
// or when the generated card snippet would leak a URL.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

function parseArgs(argv) {
    const options = { json: false, open: true, clipboard: true };
    options.indexDir = path.resolve('tmp', 'api-reference-sync', 'gate-presentation');
    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--manifest') options.manifest = path.resolve(argv[++index]);
        else if (arg === '--from-dryrun') options.fromDryrun = path.resolve(argv[++index]);
        else if (arg === '--index-dir') options.indexDir = path.resolve(argv[++index]);
        else if (arg === '--json') options.json = true;
        else if (arg === '--no-open') options.open = false;
        else if (arg === '--no-clipboard') options.clipboard = false;
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (Boolean(options.manifest) === Boolean(options.fromDryrun)) {
        throw new Error('exactly one of --manifest or --from-dryrun is required');
    }
    return options;
}

function invalid(detail) {
    const error = new Error(detail);
    error.code = 'GATE_PRESENTATION_MANIFEST_INVALID';
    return error;
}

function readManifest(filePath) {
    let document;
    try {
        document = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        throw invalid(`manifest unreadable at ${filePath}: ${error.message}`);
    }
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
        throw invalid('manifest must be a JSON object');
    }
    if (typeof document.gate !== 'string' || document.gate.trim() === '') {
        throw invalid('manifest.gate must be a non-empty string (the gate this presentation serves, e.g. APPROVE_WRITES)');
    }
    if (document.digest !== undefined && !DIGEST_PATTERN.test(document.digest)) {
        throw invalid(`manifest.digest must match sha256:<64 hex> (got ${JSON.stringify(document.digest)})`);
    }
    if (document.session !== undefined && (typeof document.session !== 'string' || document.session.trim() === '')) {
        throw invalid('manifest.session, when present, must be a non-empty path string');
    }
    if (!Array.isArray(document.links) || document.links.length === 0) {
        throw invalid('manifest.links must be a non-empty array of { label, url } — a gate presentation with no materials is a bug');
    }
    const links = [];
    document.links.forEach((link, position) => {
        if (!link || typeof link !== 'object' || typeof link.label !== 'string' || link.label.trim() === ''
            || typeof link.url !== 'string' || link.url.trim() === '') {
            throw invalid(`manifest.links[${position}] must carry non-empty label and url strings`);
        }
        links.push({ label: link.label, url: link.url });
    });
    return {
        gate: document.gate,
        title: typeof document.title === 'string' && document.title.trim() !== '' ? document.title : null,
        run: typeof document.run === 'string' && document.run.trim() !== '' ? document.run : null,
        digest: document.digest || null,
        session: document.session || null,
        links,
        previews: Array.isArray(document.previews)
            ? document.previews.filter((preview) => preview && typeof preview.markdownPreview === 'string' && preview.markdownPreview.trim() !== '')
            : [],
    };
}

function manifestFromDryrun(filePath) {
    let document;
    try {
        document = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        throw invalid(`dry-run unreadable at ${filePath}: ${error.message}`);
    }
    const presentation = document?.writeApprovalPresentation;
    if (!Array.isArray(presentation) || presentation.length === 0) {
        throw invalid('dry-run JSON carries no writeApprovalPresentation entries — nothing to present (run the dry-run first)');
    }
    const links = [];
    const previews = [];
    for (const entry of presentation) {
        // For COPY_PATCH_AND_REPOINT plans the document link is the PRE-COPY
        // source page — labeling it "page preview" sent operators to the old
        // page (which legitimately lacks synthesized sections like BUILDER
        // METHODS) and hid the actual write content. The verbatim markdown
        // preview rides the presentation entry, so embed it inline in the
        // index (§3.7: "the preview is the page verbatim") and label the
        // link neutrally.
        if (typeof entry?.documentLink === 'string' && entry.documentLink !== '') {
            links.push({ label: `${entry.title || entry.stableId} — document link (for copy actions: the pre-copy source)`, url: entry.documentLink });
        }
        if (typeof entry?.recordLink === 'string' && entry.recordLink !== '') {
            links.push({ label: `${entry.title || entry.stableId} — Bitable record`, url: entry.recordLink });
        }
        if (typeof entry?.markdownPreview === 'string' && entry.markdownPreview.trim() !== '') {
            previews.push({
                title: entry.title || entry.stableId,
                markdownPreview: entry.markdownPreview,
            });
        }
    }
    if (links.length === 0) {
        throw invalid('writeApprovalPresentation entries carry no document/record links');
    }
    // The write gate's card snippet must bind the batch digest the approval
    // reply will carry (proposedExecutionBatch.batchDigest) — presenting a
    // write approval without its digest pushes digest assembly back onto
    // the runner, exactly what this script exists to remove.
    const batchDigest = document?.proposedExecutionBatch?.batchDigest;
    if (typeof batchDigest !== 'string' || !DIGEST_PATTERN.test(batchDigest)) {
        throw invalid(`dry-run proposedExecutionBatch.batchDigest must match sha256:<64 hex> to present a write approval (got ${JSON.stringify(batchDigest)})`);
    }
    return {
        gate: 'APPROVE_WRITES',
        title: `write-approval previews (${presentation.length} planned entr${presentation.length === 1 ? 'y' : 'ies'})`,
        run: null,
        digest: batchDigest,
        session: null,
        links,
        previews,
    };
}

function escapeHtml(text) {
    return String(text)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function renderIndexHtml(manifest) {
    const lines = [];
    lines.push('<!DOCTYPE html>');
    lines.push('<html lang="en">');
    lines.push('<head><meta charset="utf-8"><title>Gate presentation</title></head>');
    lines.push('<body>');
    lines.push(`<h1>${escapeHtml(manifest.gate)} — gate materials</h1>`);
    if (manifest.title) lines.push(`<p>${escapeHtml(manifest.title)}</p>`);
    if (manifest.run) lines.push(`<p>run: ${escapeHtml(manifest.run)}</p>`);
    if (manifest.digest) lines.push(`<p>bound digest: <code>${escapeHtml(manifest.digest)}</code></p>`);
    if (manifest.session) lines.push(`<p>session: <code>${escapeHtml(manifest.session)}</code></p>`);
    lines.push(`<p>generated: ${escapeHtml(new Date().toISOString())}</p>`);
    lines.push('<ol>');
    manifest.links.forEach((link) => {
        lines.push(`<li><a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a></li>`);
    });
    lines.push('</ol>');
    (manifest.previews || []).forEach((preview) => {
        lines.push(`<h2>${escapeHtml(preview.title)} — the page this approval writes (verbatim markdown preview)</h2>`);
        lines.push(`<pre style="white-space: pre-wrap; border: 1px solid #ccc; padding: 12px; background: #f7f7f7;">${escapeHtml(preview.markdownPreview)}</pre>`);
    });
    lines.push('</body></html>');
    return lines.join('\n');
}

function writeAtomic(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, content);
    fs.renameSync(temporary, filePath);
}

function runCommand(command, argsList) {
    const result = spawnSync(command, argsList, { encoding: 'utf8', timeout: 15000 });
    return result.status === 0 && !result.error;
}

function main(argv = process.argv) {
    const options = parseArgs(argv);
    const manifest = options.manifest
        ? readManifest(options.manifest)
        : manifestFromDryrun(options.fromDryrun);

    // `open` (and most launchers) parse a leading '-' as a flag; a
    // presentation target is a URL or a local path, never an option.
    // Checked before anything is written — a refused presentation leaves
    // no partial index behind (same zero-write semantics as a malformed
    // manifest).
    const primaryTarget = manifest.links.length === 1
        ? manifest.links[0].url
        : path.join(options.indexDir, 'latest.html');
    if (/^-/.test(primaryTarget)) {
        const error = new Error(`primary target starts with '-' and would be parsed as a flag by open: ${primaryTarget}`);
        error.code = 'GATE_PRESENTATION_MANIFEST_INVALID';
        throw error;
    }

    const indexPath = path.join(options.indexDir, 'latest.html');
    writeAtomic(indexPath, renderIndexHtml(manifest));

    const warnings = [];
    let opened = false;
    let copied = false;
    const allowOpen = options.open && process.env.GATE_PRESENTATION_NO_OPEN !== '1';
    const allowClipboard = options.clipboard && process.env.GATE_PRESENTATION_NO_CLIPBOARD !== '1';
    if (allowOpen) {
        opened = runCommand('open', [primaryTarget]);
        if (!opened) warnings.push(`auto-open failed for ${primaryTarget} (open the index manually)`);
    }
    if (allowClipboard) {
        // pbcopy reads the payload from stdin
        const clip = spawnSync('pbcopy', [], { input: `${primaryTarget}\n`, encoding: 'utf8', timeout: 15000 });
        copied = clip.status === 0 && !clip.error;
        if (!copied) warnings.push('clipboard copy failed');
    }

    const cardSnippet = [
        `[${manifest.gate}] materials index: ${path.relative(process.cwd(), indexPath)} (${manifest.links.length} link${manifest.links.length === 1 ? '' : 's'}: previews / records / session)`,
        opened ? 'Index opened in your browser.' : 'Open the index path above to review the materials.',
        copied ? `Primary target copied to the clipboard — ⌘V works in a browser address bar or terminal (${path.basename(primaryTarget)}).` : null,
        manifest.digest ? `Bound digest: ${manifest.digest}` : null,
    ].filter((line) => line !== null).join('\n');
    // Scheme-agnostic and case-insensitive: the snippet must carry no
    // clickable-looking target at all — https, HTTPS, file://, any scheme
    // (a leaked file:// path is just as much a link as a web URL).
    if (/\b[a-z][a-z0-9+.-]*:\/\//i.test(cardSnippet)) {
        const error = new Error('generated card snippet contains a URL — gate cards are plain text and must carry only the index path (2026-10-03 ruling)');
        error.code = 'GATE_CARD_LINK_LEAK';
        throw error;
    }

    const result = {
        ok: true,
        schemaVersion: 1,
        gate: manifest.gate,
        indexHtml: indexPath,
        linkCount: manifest.links.length,
        primaryTarget,
        opened,
        clipboard: copied,
        warnings,
        cardSnippet,
    };
    if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
        process.stdout.write(`${cardSnippet}\n`);
        for (const warning of warnings) process.stdout.write(`warning: ${warning}\n`);
    }
}

try {
    main(process.argv);
} catch (error) {
    console.error(`${error.code || 'GATE_PRESENTATION_FAILED'}: ${error.message}`);
    process.exit(1);
}

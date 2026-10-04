#!/usr/bin/env node
'use strict';

// Read-only corpus collector for the content sweep (campaign-control
// hardening batch 1): walks a language's registered release roots (or an
// explicit --root-token subtree), fetches every document's block tree with
// paginated GETs, and writes the [{ pageId, documentToken, name, folderPath,
// blocks }] dump that scripts/reconcile-content.js consumes as --blocks-json.
// Detect-only: this script never mutates live state. Feeds the
// api.sdk-page-layout reconcile stage, including the five 2026-10-03 global
// content rules.
//
// Usage:
//   node scripts/collect-page-blocks.js --language java --out <file>
//       [--registry config/release-tracks.json]
//       [--root-token <token>]   # explicit subtree instead of the language's release roots
//       [--limit N]              # cap pages (smoke runs)

const fs = require('node:fs');
const path = require('node:path');
const MarkdownToFeishu = require('../src/markdown-to-feishu');
const { LarkCliOps } = require('../src/sdk-doc-sync/lark-cli-ops');
const {
    listLanguageTracks,
    loadReleaseTrackRegistry,
    trackReleaseRootToken,
} = require('../src/sdk-doc-sync/release-track-registry');

const DEFAULT_REGISTRY_PATH = path.join(__dirname, '..', 'config', 'release-tracks.json');

function parseArgs(argv) {
    const options = { registry: DEFAULT_REGISTRY_PATH, limit: Number.POSITIVE_INFINITY };
    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--language') options.language = argv[++index];
        else if (arg === '--registry') options.registry = path.resolve(argv[++index]);
        else if (arg === '--root-token') options.rootToken = argv[++index];
        else if (arg === '--out') options.out = path.resolve(argv[++index]);
        else if (arg === '--limit') options.limit = Number(argv[++index]);
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!options.rootToken && !options.language) throw new Error('--language or --root-token is required');
    if (!options.out) throw new Error('--out is required');
    return options;
}

function parseJsonOutput(result) {
    const text = String(result?.stdout || '').trim();
    if (!text) return {};
    const start = text.indexOf('{');
    return JSON.parse(start >= 0 ? text.slice(start) : text);
}

function blocksFromPayload(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.blocks)) return payload.blocks;
    if (Array.isArray(payload.data?.items)) return payload.data.items;
    if (Array.isArray(payload.data?.blocks)) return payload.data.blocks;
    return [];
}

async function main(argv = process.argv) {
    const options = parseArgs(argv);
    const roots = [];
    if (options.rootToken) {
        roots.push({ label: options.rootToken, token: options.rootToken });
    } else {
        const registry = loadReleaseTrackRegistry(options.registry);
        const tracks = listLanguageTracks(registry, options.language);
        if (tracks.length === 0) throw new Error(`Language ${options.language} has no registered tracks`);
        for (const track of tracks) {
            const token = trackReleaseRootToken(track);
            if (!token) throw new Error(`Track ${track.version} has an unresolved release root`);
            roots.push({ label: `${options.language} ${track.version}`, token });
        }
    }

    const folderReader = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null });
    const ops = new LarkCliOps();

    // Walk each root, collecting docx documents with their folder paths.
    const documents = [];
    const walked = new Set();
    async function walk(folderToken, folderPath, label) {
        if (walked.has(folderToken)) return;
        walked.add(folderToken);
        const files = await folderReader.listFolder({ folderToken });
        for (const file of files) {
            const name = file.name || file.token || '';
            if (file.type === 'folder') {
                await walk(file.token, `${folderPath}/${name}`, label);
            } else if (file.type === 'docx' || file.type === 'doc') {
                documents.push({ documentToken: file.token, name, folderPath: `${folderPath}/${name}`, root: label });
            }
        }
    }
    for (const root of roots) {
        await walk(root.token, '', root.label);
    }

    const capped = documents.slice(0, options.limit);
    const pages = [];
    let failures = 0;
    for (let index = 0; index < capped.length; index += 1) {
        const document = capped[index];
        if (index > 0 && index % 20 === 0) {
            process.stderr.write(`collected ${index}/${capped.length} pages\n`);
        }
        try {
            const payload = parseJsonOutput(await ops.fetchDocBlocks(document.documentToken));
            pages.push({
                pageId: document.documentToken,
                documentToken: document.documentToken,
                name: document.name,
                folderPath: document.folderPath,
                root: document.root,
                blocks: blocksFromPayload(payload),
            });
        } catch (error) {
            failures += 1;
            process.stderr.write(`block fetch failed for ${document.name} (${document.documentToken}): ${error.message}\n`);
        }
    }

    const dump = {
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        discovered: documents.length,
        collected: pages.length,
        failures,
        pages,
    };
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, `${JSON.stringify(dump, null, 2)}\n`);
    process.stderr.write(`wrote ${pages.length}/${documents.length} page(s) (${failures} fetch failure(s)) to ${options.out}\n`);
    // Fail-closed: a truncated corpus must not pass a later --strict sweep.
    if (pages.length === 0 || failures > 0) process.exitCode = 1;
}

main(process.argv).catch((error) => {
    console.error(error.message);
    process.exit(1);
});

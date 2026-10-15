#!/usr/bin/env node
'use strict';

// Read-only PR page dumper (campaign-control batch 15, §5.2). Canonical home
// of the node intake's dump-pages-and-audit-input.js stage 1 plus the page
// export logic every 2026-10-15 campaign re-wrote by hand: batch-exports the
// PR pages a decisions file pins, byte-verifies each against the recorded
// sha256, and emits a manifest whose H1 list is the composer's first
// anti-drift report surface (with duplicate-H1 detection).
//
// Division of labor with sdk-pr-scan: the scan already pinned the merge
// revision and page digests; this dumper only bulk-exports and re-verifies
// bytes against those pins. It makes zero live calls — `git show` against
// the web-content checkout is its only external read.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

class PageDumpError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'PageDumpError';
        this.code = code;
        this.details = Object.freeze({ ...details });
    }
}

function sha256(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

const USAGE = 'usage: dump-pr-pages.js --decisions <decisions.json> --web-content-dir <git checkout> --output-dir <pages dir>';

function parseArgs(argv = process.argv) {
    const args = { decisions: null, webContentDir: null, outputDir: null };
    const options = new Set(['--decisions', '--web-content-dir', '--output-dir']);
    for (let index = 2; index < argv.length; index += 1) {
        const key = argv[index];
        if (!options.has(key)) throw new PageDumpError('PAGES_ARGS_INVALID', `Unknown argument: ${key}\n${USAGE}`);
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) throw new PageDumpError('PAGES_ARGS_INVALID', `Missing value for ${key}\n${USAGE}`);
        args[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
        index += 1;
    }
    for (const key of ['decisions', 'webContentDir', 'outputDir']) {
        if (!args[key]) throw new PageDumpError('PAGES_ARGS_INVALID', `Missing --${key}\n${USAGE}`);
    }
    return args;
}

function prOf(unit) {
    return unit?.decision?.pr || null;
}

// One PR revision per decisions file: the dump certifies a single tree state,
// so per-unit revision drift is refused before any byte is read.
function pinnedRevision(units) {
    let revision = null;
    for (const unit of units) {
        const pr = prOf(unit);
        if (!pr?.revision) continue;
        if (revision === null) revision = pr.revision;
        if (pr.revision !== revision) {
            throw new PageDumpError(
                'REVISION_DIVERGENT',
                `decisions pin divergent PR revisions: ${revision} vs ${pr.revision} (unit ${unit.id}); one dump certifies one tree state`,
                { revision, divergentRevision: pr.revision, unitId: unit.id },
            );
        }
    }
    if (!revision) {
        throw new PageDumpError('PAGES_REVISION_REQUIRED', 'no unit carries decision.pr.revision; nothing to dump');
    }
    return revision;
}

function dumpableUnits(units) {
    const dumpable = [];
    const skippedUnitIds = [];
    for (const unit of units) {
        const pr = prOf(unit);
        if (!pr?.path) {
            skippedUnitIds.push(unit.id);
            continue;
        }
        if (!pr.pageSha256) {
            throw new PageDumpError(
                'PAGE_DIGEST_REQUIRED',
                `unit ${unit.id} pins PR path ${pr.path} without decision.pr.pageSha256; refuse the unverified page`,
                { unitId: unit.id },
            );
        }
        if (!unit.decision.docIdentity?.canonicalSlug) {
            throw new PageDumpError(
                'PAGE_SLUG_REQUIRED',
                `unit ${unit.id} has no decision.docIdentity.canonicalSlug; refuse the unnameable page`,
                { unitId: unit.id },
            );
        }
        dumpable.push(unit);
    }
    return { dumpable, skippedUnitIds };
}

// Fence-aware first H1: lines inside ``` fences never count, so a page that
// only SHOWS markdown headings cannot fake its own title.
function extractH1(markdown) {
    let insideFence = false;
    for (const line of String(markdown).split(/\r?\n/)) {
        if (/^\s*```/.test(line)) {
            insideFence = !insideFence;
            continue;
        }
        if (!insideFence) {
            const match = line.match(/^#\s+(.+?)\s*$/);
            if (match) return match[1];
        }
    }
    return null;
}

function gitShow(webContentDir, revision, prPath) {
    try {
        return execFileSync('git', ['-C', webContentDir, 'show', `${revision}:${prPath}`], { encoding: 'utf8' });
    } catch (error) {
        throw new PageDumpError(
            'PAGE_SHOW_FAILED',
            `git show ${revision.slice(0, 12)}:${prPath} failed in ${webContentDir}: ${(error.stderr || error.message || '').trim().slice(0, 200)}`,
            { revision, prPath },
        );
    }
}

// Core dump loop, injectable for offline tests. Returns { pages, skippedUnitIds }
// where pages carry the manifest fields; digest mismatch fails closed.
function dumpPages({ decisions, showFn }) {
    const units = decisions?.units;
    if (!Array.isArray(units) || units.length === 0) {
        throw new PageDumpError('PAGES_DECISIONS_INVALID', 'decisions file carries no units array');
    }
    const revision = pinnedRevision(units);
    const { dumpable, skippedUnitIds } = dumpableUnits(units);
    const pages = [];
    for (const unit of dumpable) {
        const pr = prOf(unit);
        const slug = unit.decision.docIdentity.canonicalSlug;
        if (slug.includes('/') || slug.includes('..')) {
            throw new PageDumpError(
                'PAGE_SLUG_INVALID',
                `unit ${unit.id} slug ${slug} is not a safe single file name`,
                { unitId: unit.id, slug },
            );
        }
        const markdown = showFn(revision, pr.path);
        const digest = sha256(markdown);
        if (digest !== pr.pageSha256) {
            throw new PageDumpError(
                'PAGE_DUMP_DIGEST_MISMATCH',
                `page sha mismatch for ${slug}: decisions recorded ${pr.pageSha256}, rev bytes hash ${digest}`,
                { slug, unitId: unit.id, recorded: pr.pageSha256, actual: digest },
            );
        }
        pages.push({
            slug,
            path: `${slug}.md`,
            prPath: pr.path,
            revision,
            bytes: Buffer.byteLength(markdown, 'utf8'),
            sha256: digest,
            h1: extractH1(markdown),
            markdown,
        });
    }
    pages.sort((left, right) => (left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0));
    return { revision, pages, skippedUnitIds };
}

// Duplicate-H1 detection over the dumped pages: two pages claiming one title
// is upstream identity drift, refused before a composer can consume the dump.
function findDuplicateH1s(pages) {
    const byH1 = new Map();
    for (const page of pages) {
        if (!page.h1) continue;
        byH1.set(page.h1, [...(byH1.get(page.h1) || []), page.slug]);
    }
    return [...byH1.entries()]
        .filter(([, slugs]) => slugs.length > 1)
        .map(([h1, slugs]) => ({ h1, slugs: slugs.sort() }))
        .sort((left, right) => (left.h1 < right.h1 ? -1 : left.h1 > right.h1 ? 1 : 0));
}

function buildManifest({ decisionsPath, webContentDir, outputDir, dump }) {
    const duplicateH1s = findDuplicateH1s(dump.pages);
    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        decisions: path.resolve(decisionsPath),
        webContentDir: path.resolve(webContentDir),
        revision: dump.revision,
        // Manifest carries the report face only — never the page bytes.
        pages: dump.pages.map(({ markdown, ...page }) => page),
        missingH1s: dump.pages.filter((page) => !page.h1).map((page) => page.slug),
        duplicateH1s,
        skippedUnitIds: dump.skippedUnitIds,
        // No writesPerformed flag: unlike the live-read snapshot/audit tools,
        // this dumper makes zero live calls at all — writing local page files
        // under --output-dir is its entire effect.
    };
}

function main(argv = process.argv) {
    const args = parseArgs(argv);
    const decisionsPath = path.resolve(args.decisions);
    const decisions = JSON.parse(fs.readFileSync(decisionsPath, 'utf8'));
    const dump = dumpPages({
        decisions,
        showFn: (revision, prPath) => gitShow(path.resolve(args.webContentDir), revision, prPath),
    });
    const manifest = buildManifest({
        decisionsPath,
        webContentDir: args.webContentDir,
        outputDir: args.outputDir,
        dump,
    });
    const outputDir = path.resolve(args.outputDir);
    fs.mkdirSync(outputDir, { recursive: true });
    for (const page of dump.pages) {
        fs.writeFileSync(path.join(outputDir, page.path), page.markdown);
    }
    const manifestPath = path.join(outputDir, 'manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    process.stderr.write(`dumped ${dump.pages.length} page(s) at rev ${dump.revision.slice(0, 12)} -> ${args.outputDir} `
        + `(sha256 verified; manifest ${path.relative(process.cwd(), manifestPath)}; skipped ${dump.skippedUnitIds.length} unit(s) without PR pages)\n`);
    // Duplicate H1s still land in the manifest first — the evidence persists —
    // but the exit stays fail-closed.
    if (manifest.duplicateH1s.length > 0) {
        process.stderr.write(`[PAGE_H1_DUPLICATE] duplicate H1(s) in dump: ${
            manifest.duplicateH1s.map((dup) => `${dup.h1} <- ${dup.slugs.join(', ')}`).join('; ')}\n`);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`${error.code ? `[${error.code}] ` : ''}${error.message}\n`);
        process.exitCode = 1;
    }
}

module.exports = {
    PageDumpError,
    buildManifest,
    dumpPages,
    extractH1,
    findDuplicateH1s,
    gitShow,
    parseArgs,
    pinnedRevision,
    sha256,
};

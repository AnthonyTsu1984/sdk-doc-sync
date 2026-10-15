'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
    dumpPages,
    extractH1,
    findDuplicateH1s,
    gitShow,
    parseArgs,
    pinnedRevision,
    sha256,
} = require('../scripts/dump-pr-pages');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, '.claude', 'skills', 'api-reference-sync', 'scripts', 'dump-pr-pages.js');

// A real throwaway git checkout so `git show <rev>:<path>` runs for real.
function makeWebContentRepo(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dump-pr-pages-webcontent-'));
    execFileSync('git', ['-C', dir, 'init', '-q']);
    execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com']);
    execFileSync('git', ['-C', dir, 'config', 'user.name', 'test']);
    for (const [relative, content] of Object.entries(files)) {
        const target = path.join(dir, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
        execFileSync('git', ['-C', dir, 'add', relative]);
    }
    execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'pages']);
    const revision = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    return { dir, revision };
}

function unit(id, { slug, prPath, page, revision, omit }) {
    const pr = {
        number: 1180,
        path: prPath,
        revision,
        ...(omit?.pageSha256 ? {} : { pageSha256: page === undefined ? 'unrecorded' : sha256(page) }),
    };
    return {
        id,
        sourceStableId: `go:Client:${slug}`,
        actionIntent: 'UPDATE',
        decision: {
            docIdentity: { category: 'Client', stableId: `go:Client:${slug}`, canonicalSlug: slug, title: `${slug}()` },
            existingBitable: { status: 'matched', recordId: `rec-${slug}` },
            ...(omit?.pr ? {} : { pr }),
        },
    };
}

const PAGE_A = '# addPrivilegesToGroup()\n\nThis operation adds privileges.\n\n```javascript\nawait client.go()\n```\n';
const PAGE_B = '# alterRole()\n\nThis operation alters a role.\n\nSee [Notes on role behavior](x.md).\n';

test('extractH1 is fence-aware: headings displayed inside code fences never count', () => {
    assert.equal(extractH1, require('../src/sdk-doc-sync/pr-page-parser').extractH1,
        'extractH1 is single-sourced from the page-parser kernel (batch 15 slice 3-3)');
    assert.equal(extractH1(PAGE_A), 'addPrivilegesToGroup()');
    assert.equal(extractH1('```markdown\n# Not A Title\n```\n\n# Real Title\n'), 'Real Title');
    assert.equal(extractH1('## Only an H2\n'), null);
    assert.equal(extractH1('#   Spaced Title   \n'), 'Spaced Title');
});

test('pinnedRevision accepts one revision and refuses divergent pins before any read', () => {
    const units = [
        unit('u1', { slug: 'a', prPath: 'a.md', page: PAGE_A, revision: 'rev1' }),
        unit('u2', { slug: 'b', prPath: 'b.md', page: PAGE_B, revision: 'rev1' }),
    ];
    assert.equal(pinnedRevision(units), 'rev1');

    const divergent = [...units, unit('u3', { slug: 'c', prPath: 'c.md', page: PAGE_A, revision: 'rev2' })];
    assert.throws(
        () => pinnedRevision(divergent),
        (error) => error.code === 'REVISION_DIVERGENT' && /rev1 vs rev2 \(unit u3\)/.test(error.message),
    );
    assert.throws(() => pinnedRevision([]), /PAGES_REVISION_REQUIRED|nothing to dump/);
});

function liveDump(web, decisionsUnits) {
    return dumpPages({
        decisions: { units: decisionsUnits },
        showFn: (revision, prPath) => execFileSync('git', ['-C', web.dir, 'show', `${revision}:${prPath}`], { encoding: 'utf8' }),
    });
}

test('dumpPages exports every PR page byte-verified and shapes the manifest entries', () => {
    const web = makeWebContentRepo({
        'API_Reference/a.md': PAGE_A,
        'API_Reference/b.md': PAGE_B,
    });
    const decisions = {
        units: [
            unit('u-b', { slug: 'Authentication-alterRole', prPath: 'API_Reference/b.md', page: PAGE_B, revision: web.revision }),
            unit('u-a', { slug: 'Authentication-addPrivilegesToGroup', prPath: 'API_Reference/a.md', page: PAGE_A, revision: web.revision }),
            // A scan-only unit without PR evidence is skipped, not fatal.
            { id: 'u-scan', decision: { docIdentity: { canonicalSlug: 'Scan-only' } } },
        ],
    };
    const dump = liveDump(web, decisions.units);
    assert.equal(dump.revision, web.revision);
    assert.deepEqual(dump.skippedUnitIds, ['u-scan']);
    assert.deepEqual(dump.pages.map((page) => page.slug), ['Authentication-addPrivilegesToGroup', 'Authentication-alterRole']);
    const [first] = dump.pages;
    assert.equal(first.prPath, 'API_Reference/a.md');
    assert.equal(first.path, 'Authentication-addPrivilegesToGroup.md');
    assert.equal(first.sha256, sha256(PAGE_A));
    assert.equal(first.bytes, Buffer.byteLength(PAGE_A, 'utf8'));
    assert.equal(first.h1, 'addPrivilegesToGroup()');
});

test('a sha256 divergence from the decisions pin is a typed fail-closed refusal', () => {
    const web = makeWebContentRepo({ 'API_Reference/a.md': PAGE_A });
    const good = unit('u1', { slug: 'a', prPath: 'API_Reference/a.md', page: PAGE_A, revision: web.revision });
    good.decision.pr.pageSha256 = sha256('# tampered\n');
    assert.throws(
        () => liveDump(web, [good]),
        (error) => error.code === 'PAGE_DUMP_DIGEST_MISMATCH'
            && /decisions recorded/.test(error.message)
            && new RegExp(good.decision.pr.pageSha256.slice(0, 8)).test(error.details.recorded),
    );
});

test('duplicate H1s across pages are detected with both slugs named', () => {
    const pages = [
        { slug: 'Client-A', h1: 'describe()' },
        { slug: 'Client-B', h1: 'describe()' },
        { slug: 'Client-C', h1: 'other()' },
        { slug: 'Client-D', h1: null },
    ];
    assert.deepEqual(findDuplicateH1s(pages), [{ h1: 'describe()', slugs: ['Client-A', 'Client-B'] }]);
});

test('the CLI dumps pages plus manifest, refuses a digest mismatch, and flags duplicate H1s', () => {
    const dupPage = '# same Title()\n\nOne.\n';
    const web = makeWebContentRepo({
        'API_Reference/a.md': PAGE_A,
        'API_Reference/dup1.md': dupPage,
        'API_Reference/dup2.md': dupPage,
    });
    const mk = (id, slug, prPath, page) => unit(id, { slug, prPath, page, revision: web.revision });

    // Happy path: real CLI run writes pages + manifest.
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dump-pr-pages-out-'));
    const decisionsPath = path.join(temp, 'decisions.json');
    const outputDir = path.join(temp, 'pages-v30');
    fs.writeFileSync(decisionsPath, JSON.stringify({ units: [mk('u1', 'Authentication-addPrivilegesToGroup', 'API_Reference/a.md', PAGE_A)] }));
    const { spawnSync } = require('node:child_process');
    const goodRun = spawnSync(process.execPath, [SCRIPT, '--decisions', decisionsPath, '--web-content-dir', web.dir, '--output-dir', outputDir], { encoding: 'utf8' });
    assert.equal(goodRun.status, 0, goodRun.stderr);
    assert.equal(fs.readFileSync(path.join(outputDir, 'Authentication-addPrivilegesToGroup.md'), 'utf8'), PAGE_A);
    const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.revision, web.revision);
    assert.deepEqual(manifest.missingH1s, []);
    assert.deepEqual(manifest.duplicateH1s, []);
    assert.equal(manifest.pages[0].sha256, sha256(PAGE_A));
    assert.equal(manifest.pages[0].markdown, undefined, 'manifest never carries page bytes');

    // Digest mismatch exits non-zero with the typed code and writes nothing.
    const badDecisions = path.join(temp, 'bad-decisions.json');
    const badUnit = mk('u1', 'Authentication-addPrivilegesToGroup', 'API_Reference/a.md', PAGE_A);
    badUnit.decision.pr.pageSha256 = sha256('# different\n');
    fs.writeFileSync(badDecisions, JSON.stringify({ units: [badUnit] }));
    const badOut = path.join(temp, 'pages-bad');
    const badRun = spawnSync(process.execPath, [SCRIPT, '--decisions', badDecisions, '--web-content-dir', web.dir, '--output-dir', badOut], { encoding: 'utf8' });
    assert.equal(badRun.status, 1);
    assert.match(badRun.stderr, /\[PAGE_DUMP_DIGEST_MISMATCH\]/);
    assert.equal(fs.existsSync(badOut), false, 'no partial dump survives a digest refusal');

    // Duplicate H1s still write the manifest (evidence persists) but exit 1.
    const dupDecisions = path.join(temp, 'dup-decisions.json');
    fs.writeFileSync(dupDecisions, JSON.stringify({
        units: [mk('d1', 'Client-dupOne', 'API_Reference/dup1.md', dupPage), mk('d2', 'Client-dupTwo', 'API_Reference/dup2.md', dupPage)],
    }));
    const dupOut = path.join(temp, 'pages-dup');
    const dupRun = spawnSync(process.execPath, [SCRIPT, '--decisions', dupDecisions, '--web-content-dir', web.dir, '--output-dir', dupOut], { encoding: 'utf8' });
    assert.equal(dupRun.status, 1);
    assert.match(dupRun.stderr, /\[PAGE_H1_DUPLICATE\]/);
    const dupManifest = JSON.parse(fs.readFileSync(path.join(dupOut, 'manifest.json'), 'utf8'));
    assert.deepEqual(dupManifest.duplicateH1s, [{ h1: 'same Title()', slugs: ['Client-dupOne', 'Client-dupTwo'] }]);
});

test('parseArgs requires all three paths and refuses unknown arguments', () => {
    assert.throws(() => parseArgs(['node', 'script']), /Missing --decisions/);
    assert.throws(
        () => parseArgs(['node', 'script', '--decisions', 'd', '--web-content-dir', 'w', '--wat', 'x']),
        /Unknown argument: --wat/,
    );
    const args = parseArgs(['node', 'script', '--decisions', 'd.json', '--web-content-dir', 'repo', '--output-dir', 'pages-v30']);
    assert.deepEqual(args, { decisions: 'd.json', webContentDir: 'repo', outputDir: 'pages-v30' });
});

test('a missing PR page at the pinned revision is a typed refusal naming the path', () => {
    const web = makeWebContentRepo({ 'API_Reference/a.md': PAGE_A });
    assert.throws(
        () => gitShow(web.dir, web.revision, 'API_Reference/renamed-away.md'),
        (error) => error.code === 'PAGE_SHOW_FAILED'
            && /renamed-away\.md/.test(error.message)
            && error.details.prPath === 'API_Reference/renamed-away.md',
    );
    // The happy path returns the exact bytes.
    assert.equal(gitShow(web.dir, web.revision, 'API_Reference/a.md'), `${PAGE_A}`);
});

test('a unit pinning a PR path without a page digest is refused (no unverified pages)', () => {
    const web = makeWebContentRepo({ 'API_Reference/a.md': PAGE_A });
    const noDigest = unit('u1', { slug: 'a', prPath: 'API_Reference/a.md', page: PAGE_A, revision: web.revision, omit: { pageSha256: true } });
    assert.throws(
        () => liveDump(web, [noDigest]),
        (error) => error.code === 'PAGE_DIGEST_REQUIRED',
    );
});

test('a unit pinning a PR path without a revision is a typed refusal, never a silent skip', () => {
    // Review P2-6: a pinner without a revision used to fall out of the dump
    // when OTHER units carried the revision — a silently incomplete dump.
    // It must refuse at the same tier as the digest gate, before any read.
    const web = makeWebContentRepo({ 'API_Reference/a.md': PAGE_A, 'API_Reference/b.md': PAGE_B });
    const revisionLess = unit('u-no-rev', { slug: 'a', prPath: 'API_Reference/a.md', page: PAGE_A });
    assert.throws(
        () => liveDump(web, [revisionLess]),
        (error) => error.code === 'PAGES_REVISION_REQUIRED'
            && Array.isArray(error.details.unitIds) && error.details.unitIds.includes('u-no-rev')
            && /decision\.pr\.revision \(path-pinning units without one: u-no-rev\)/.test(error.message),
    );
    // Mixed batch: the revision-less pinner refuses the whole dump even when a
    // fully pinned sibling exists.
    const pinned = unit('u-ok', { slug: 'b', prPath: 'API_Reference/b.md', page: PAGE_B, revision: web.revision });
    assert.throws(
        () => liveDump(web, [pinned, revisionLess]),
        (error) => error.code === 'PAGES_REVISION_REQUIRED' && error.details.unitId === 'u-no-rev',
    );
});

test('duplicate canonicalSlugs across units are refused before any byte is read', () => {
    const web = makeWebContentRepo({ 'API_Reference/a.md': PAGE_A, 'API_Reference/b.md': PAGE_B });
    const first = unit('u1', { slug: 'Client-same', prPath: 'API_Reference/a.md', page: PAGE_A, revision: web.revision });
    const second = unit('u2', { slug: 'Client-same', prPath: 'API_Reference/b.md', page: PAGE_B, revision: web.revision });
    assert.throws(
        () => liveDump(web, [first, second]),
        (error) => error.code === 'PAGE_SLUG_DUPLICATE'
            && error.details.slug === 'Client-same'
            && error.details.unitId === 'u2',
    );
});

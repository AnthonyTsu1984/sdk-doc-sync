'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SKILL_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SKILL_ROOT, '..', '..');
const SCRIPT = path.join(SKILL_ROOT, 'scripts', 'gate-presentation.js');

function runPresentation(args, env = {}) {
    return spawnSync(process.execPath, [SCRIPT, ...args, '--no-open', '--no-clipboard'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: { ...process.env, ...env },
    });
}

function writeManifest(dir, manifest) {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'manifest.json');
    fs.writeFileSync(file, JSON.stringify(manifest));
    return file;
}

test('a valid manifest produces the numbered local index and a link-free card snippet', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-presentation-'));
    const indexDir = path.join(dir, 'gate-presentation-out');
    const manifest = writeManifest(dir, {
        gate: 'APPROVE_WRITES',
        title: 'batch 1 — K=2',
        run: 'run-x1',
        digest: `sha256:${'a'.repeat(64)}`,
        session: 'tmp/sdk-doc-sync-runs/java-v26/review-session.json',
        links: [
            { label: 'getAsync — page preview', url: 'https://zilliverse.feishu.cn/wiki/a' },
            { label: 'getAsync — Bitable record', url: 'https://zilliverse.feishu.cn/base/t/r' },
        ],
    });
    const result = runPresentation(['--manifest', manifest, '--index-dir', indexDir, '--json']);
    assert.equal(result.status, 0, result.stderr);

    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.gate, 'APPROVE_WRITES');
    assert.equal(report.linkCount, 2);
    assert.equal(report.indexHtml, path.join(indexDir, 'latest.html'));

    const html = fs.readFileSync(report.indexHtml, 'utf8');
    // Every material link is present, numbered, and escaped
    const items = html.match(/<li><a href="[^"]+">[^<]+<\/a><\/li>/g) || [];
    assert.equal(items.length, 2);
    assert.ok(html.includes('https://zilliverse.feishu.cn/wiki/a'));
    assert.ok(html.includes('sha256:aaaa'));
    assert.ok(html.includes('tmp/sdk-doc-sync-runs/java-v26/review-session.json'));

    // The card snippet is what the gate card embeds — it must carry the
    // index path and digest, never a URL (2026-10-03 ruling)
    assert.doesNotMatch(report.cardSnippet, /https?:\/\//);
    assert.match(report.cardSnippet, /materials index: .*latest\.html/);
    assert.match(report.cardSnippet, /bound digest: sha256:/);
    assert.match(report.cardSnippet, /GATE APPROVE_WRITES/);
    assert.match(report.cardSnippet, /If approved, reply exactly:\nAPPROVE_WRITES sha256:/);
});

test('malformed manifests fail closed with nothing written', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-presentation-'));
    const indexDir = path.join(dir, 'gate-presentation-out');
    const cases = [
        { bad: 'gate missing', manifest: { links: [{ label: 'a', url: 'https://x' }] } },
        { bad: 'digest shape', manifest: { gate: 'G', digest: 'sha256:short', links: [{ label: 'a', url: 'https://x' }] } },
        { bad: 'links empty', manifest: { gate: 'G', links: [] } },
        { bad: 'link missing url', manifest: { gate: 'G', links: [{ label: 'a' }] } },
        { bad: 'top-level array', manifest: [1, 2] },
    ];
    for (const { bad, manifest } of cases) {
        const file = writeManifest(dir, manifest);
        const result = runPresentation(['--manifest', file, '--index-dir', indexDir]);
        assert.notEqual(result.status, 0, bad);
        assert.match(result.stderr, /GATE_PRESENTATION_MANIFEST_INVALID/, bad);
    }
    // Nothing was written for any of the invalid runs
    assert.equal(fs.existsSync(indexDir), false);
});

test('labels and URLs are HTML-escaped in the index', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-presentation-'));
    const indexDir = path.join(dir, 'gate-presentation-out');
    const manifest = writeManifest(dir, {
        gate: '<script>',
        links: [{ label: '<img src=x onerror=alert(1)>', url: 'https://x/"><script>' }],
    });
    const result = runPresentation(['--manifest', manifest, '--index-dir', indexDir, '--json']);
    assert.equal(result.status, 0, result.stderr);
    const html = fs.readFileSync(path.join(indexDir, 'latest.html'), 'utf8');
    assert.doesNotMatch(html, /<script>/);
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(html.includes('https://x/&quot;&gt;&lt;script&gt;'));
});

test('--from-dryrun extracts writeApprovalPresentation links and binds the batch digest (null record links skipped)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-presentation-'));
    const indexDir = path.join(dir, 'gate-presentation-out');
    const dryrun = path.join(dir, 'unit-dryrun.json');
    fs.writeFileSync(dryrun, JSON.stringify({
        proposedExecutionBatch: { batchDigest: `sha256:${'b'.repeat(64)}` },
        writeApprovalPresentation: [
            { stableId: 'java:Collections:getAsync', title: 'getAsync()', documentLink: 'https://host/wiki/a', recordLink: 'https://host/base/t/ra', markdownPreview: 'x' },
            { stableId: 'java:Collections:queryAsync', title: 'queryAsync()', documentLink: 'https://host/wiki/b', recordLink: null, markdownPreview: 'x' },
        ],
    }));
    const result = runPresentation(['--from-dryrun', dryrun, '--index-dir', indexDir, '--json']);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.gate, 'APPROVE_WRITES');
    assert.equal(report.linkCount, 3);
    // The card snippet binds the digest the APPROVE_WRITES reply carries
    assert.match(report.cardSnippet, /bound digest: sha256:bbbb/);
    assert.match(report.cardSnippet, /APPROVE_WRITES sha256:bbbb/);
    const html = fs.readFileSync(report.indexHtml, 'utf8');
    assert.ok(html.includes('getAsync() — document link (for copy actions: the pre-copy source)'));
    assert.ok(html.includes('queryAsync() — Bitable record') === false);
});

test('--from-dryrun embeds the verbatim markdown preview inline in the index', () => {
    // COPY units' documentLink is the pre-copy SOURCE page — the operator
    // reviewing that link sees the old page (no synthesized BUILDER METHODS)
    // and reports exactly that. The verbatim preview of the page the
    // approval WRITES must be embedded in the index itself (§3.7).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-presentation-'));
    const indexDir = path.join(dir, 'gate-presentation-out');
    const dryrun = path.join(dir, 'unit-dryrun.json');
    fs.writeFileSync(dryrun, JSON.stringify({
        proposedExecutionBatch: { batchDigest: `sha256:${'c'.repeat(64)}` },
        writeApprovalPresentation: [
            {
                stableId: 'go:Authentication:CreateRole',
                title: 'CreateRole',
                documentLink: 'https://host/docx/source-page',
                recordLink: 'https://host/base/t/r',
                markdownPreview: '**BUILDER METHODS:**\n\n- `NewCreateRoleOption(roleName)`',
            },
        ],
    }));
    const result = runPresentation(['--from-dryrun', dryrun, '--index-dir', indexDir, '--json', '--no-open', '--no-clipboard']);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    const html = fs.readFileSync(report.indexHtml, 'utf8');
    assert.ok(html.includes('the page this approval writes (verbatim markdown preview)'));
    assert.ok(html.includes('**BUILDER METHODS:**'), 'the write content is embedded, not just the source link');
    assert.ok(html.includes('document link (for copy actions: the pre-copy source)'), 'the source-page link is labeled as such');
});

test('--from-dryrun without presentation entries fails closed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-presentation-'));
    const dryrun = path.join(dir, 'dryrun.json');
    fs.writeFileSync(dryrun, JSON.stringify({ plans: [] }));
    const result = runPresentation(['--from-dryrun', dryrun]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /writeApprovalPresentation/);
});

test('--from-dryrun without a well-formed batch digest fails closed (review r1 P2)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-presentation-'));
    for (const [name, batch] of [
        ['missing', undefined],
        ['short', { batchDigest: 'sha256:short' }],
        ['null', { batchDigest: null }],
    ]) {
        const dryrun = path.join(dir, `dryrun-${name}.json`);
        fs.writeFileSync(dryrun, JSON.stringify({
            proposedExecutionBatch: batch,
            writeApprovalPresentation: [
                { stableId: 's', title: 't', documentLink: 'https://host/wiki/a', recordLink: null, markdownPreview: 'x' },
            ],
        }));
        const result = runPresentation(['--from-dryrun', dryrun]);
        assert.notEqual(result.status, 0, name);
        assert.match(result.stderr, /batchDigest must match sha256:<64 hex>/, name);
    }
});

test('a card snippet that would leak ANY scheme (HTTPS://, file://) fails with GATE_CARD_LINK_LEAK (review r1 P2)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-presentation-'));
    for (const [name, gate] of [
        ['uppercase-https', 'G — HTTPS://EVIL.COM/payload'],
        ['file-scheme', 'G file:///etc/passwd'],
    ]) {
        const manifest = writeManifest(dir, { gate, links: [{ label: 'a', url: 'https://x' }] });
        const result = runPresentation(['--manifest', manifest, '--index-dir', path.join(dir, `out-${name}`)]);
        assert.notEqual(result.status, 0, name);
        assert.match(result.stderr, /GATE_CARD_LINK_LEAK/, name);
    }
});

test('a primary target starting with "-" is refused before open (flag injection)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-presentation-'));
    const manifest = writeManifest(dir, {
        gate: 'DOCUMENT_REVIEW',
        links: [{ label: 'weird', url: '-foo' }],
    });
    const outDir = path.join(dir, 'out');
    const result = runPresentation(['--manifest', manifest, '--index-dir', outDir]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /would be parsed as a flag/);
    // Zero-write semantics (review r2 note): the refusal leaves no index behind
    assert.equal(fs.existsSync(outDir), false);
});

test('exactly one input mode is required; open/clipboard skip via env as well', () => {
    const none = runPresentation([]);
    assert.notEqual(none.status, 0);
    assert.match(none.stderr, /exactly one of --manifest or --from-dryrun/);

    const both = runPresentation(['--manifest', '/dev/null', '--from-dryrun', '/dev/null']);
    assert.notEqual(both.status, 0);
    assert.match(both.stderr, /exactly one of --manifest or --from-dryrun/);
});

test('single-link presentations make the URL itself the primary target; multi-link ones open the index', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-presentation-'));
    const singleDir = path.join(dir, 'single');
    const multiDir = path.join(dir, 'multi');
    const single = writeManifest(path.join(singleDir, 'src'), {
        gate: 'DOCUMENT_REVIEW',
        links: [{ label: 'live page', url: 'https://host/wiki/only' }],
    });
    const multi = writeManifest(path.join(multiDir, 'src'), {
        gate: 'DOCUMENT_REVIEW',
        links: [
            { label: 'page A', url: 'https://host/wiki/a' },
            { label: 'page B', url: 'https://host/wiki/b' },
        ],
    });
    const one = runPresentation(['--manifest', single, '--index-dir', path.join(singleDir, 'out'), '--json']);
    const many = runPresentation(['--manifest', multi, '--index-dir', path.join(multiDir, 'out'), '--json']);
    assert.equal(JSON.parse(one.stdout).primaryTarget, 'https://host/wiki/only');
    assert.equal(JSON.parse(many.stdout).primaryTarget, path.join(multiDir, 'out', 'latest.html'));
});

// --- canonical card (2026-10-10): one layout for every gate of every
// campaign — units list and the pre-filled reply line are part of the card,
// so a conversation switch cannot change what the operator sees ---

test('the canonical card carries the unit composition and the exact pre-filled reply line', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-presentation-card-'));
    const indexDir = path.join(dir, 'out');
    const manifest = writeManifest(dir, {
        gate: 'APPROVE_DOCUMENT',
        title: 'document gate — Vector:get',
        digest: `sha256:${'c'.repeat(64)}`,
        session: 'tmp/sdk-release-scout/java-v30-session.json',
        units: ['java:v2-Vector:get'],
        replyLine: 'APPROVE_DOCUMENT review:java:v2-Vector:get sha256:cccc',
        links: [
            { label: 'Vector:get — page', url: 'https://zilliverse.feishu.cn/wiki/vg' },
            { label: 'Vector:get — Bitable record', url: 'https://zilliverse.feishu.cn/base/t/rec' },
        ],
    });
    const result = runPresentation(['--manifest', manifest, '--index-dir', indexDir, '--json']);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.match(report.cardSnippet, /units \(1\): java:v2-Vector:get/);
    assert.match(report.cardSnippet, /If approved, reply exactly:\nAPPROVE_DOCUMENT review:java:v2-Vector:get sha256:cccc/);
    assert.doesNotMatch(report.cardSnippet, /:\/\//);
});

test('long unit lists truncate at eight with a count tail; unknown gates carry no reply line', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-presentation-trunc-'));
    const indexDir = path.join(dir, 'out');
    const units = Array.from({ length: 10 }, (_, index) => `go:Cat:Unit${index}`);
    const manifest = writeManifest(dir, {
        gate: 'APPROVE_WRITES',
        digest: `sha256:${'d'.repeat(64)}`,
        units,
        links: [{ label: 'only link', url: 'https://zilliverse.feishu.cn/wiki/x' }],
    });
    const result = runPresentation(['--manifest', manifest, '--index-dir', indexDir, '--json']);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.match(report.cardSnippet, /units \(10\): go:Cat:Unit0, .*go:Cat:Unit7 \(\+2 more\)/);
    assert.match(report.cardSnippet, /APPROVE_WRITES sha256:d{64}/);
});

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
    assert.match(report.cardSnippet, /Bound digest: sha256:/);
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

test('--from-dryrun extracts writeApprovalPresentation links (null record links skipped)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-presentation-'));
    const indexDir = path.join(dir, 'gate-presentation-out');
    const dryrun = path.join(dir, 'unit-dryrun.json');
    fs.writeFileSync(dryrun, JSON.stringify({
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
    const html = fs.readFileSync(report.indexHtml, 'utf8');
    assert.ok(html.includes('getAsync() — page preview'));
    assert.ok(html.includes('queryAsync() — Bitable record') === false);
});

test('--from-dryrun without presentation entries fails closed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-presentation-'));
    const dryrun = path.join(dir, 'dryrun.json');
    fs.writeFileSync(dryrun, JSON.stringify({ plans: [] }));
    const result = runPresentation(['--from-dryrun', dryrun]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /writeApprovalPresentation/);
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

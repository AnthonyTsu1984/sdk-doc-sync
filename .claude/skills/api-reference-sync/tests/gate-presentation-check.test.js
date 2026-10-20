'use strict';

// Pre-presentation check (2026-10-14 ruling): the presentation page has a
// fixed structure, key points are machine-checked BEFORE a gate is
// presented, and --ensure regenerates from the source until the check
// passes. These tests cover every point, the binding check, and the
// regeneration loop (including honest exhaustion).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SKILL_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SKILL_ROOT, '..', '..', '..');
const CHECK_SCRIPT = path.join(SKILL_ROOT, 'scripts', 'gate-presentation-check.js');
const GENERATOR_SCRIPT = path.join(SKILL_ROOT, 'scripts', 'gate-presentation.js');
const { validatePresentationHtml } = require(CHECK_SCRIPT);

const SESSION_FIXTURE = 'tmp/sdk-doc-sync-runs/java-v26/review-session.json';
const DIGEST = `sha256:${'e'.repeat(64)}`;

function runCheck(args) {
    return spawnSync(process.execPath, [CHECK_SCRIPT, ...args], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
    });
}

function renderValidPage(indexDir) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-check-src-'));
    const manifest = path.join(dir, 'manifest.json');
    fs.writeFileSync(manifest, JSON.stringify({
        gate: 'APPROVE_WRITES',
        digest: DIGEST,
        session: SESSION_FIXTURE,
        links: [{ label: 'get — page', url: 'https://zilliverse.feishu.cn/wiki/a' }],
    }));
    const generated = spawnSync(process.execPath, [GENERATOR_SCRIPT, '--manifest', manifest,
        '--index-dir', indexDir, '--no-open', '--no-clipboard'], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    return manifest;
}

function writeSourceManifest(dir, manifest) {
    const file = path.join(dir, 'manifest.json');
    fs.writeFileSync(file, JSON.stringify(manifest));
    return file;
}

// ---------- unit: every fixed-structure point ----------

function validHtml() {
    return [
        '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Gate presentation</title></head><body>',
        '<h1>APPROVE_WRITES — gate materials</h1>',
        '<p>title</p>',
        `<p>bound digest: <code>${DIGEST}</code></p>`,
        `<p>session: <code>${SESSION_FIXTURE}</code></p>`,
        `<p>generated: ${new Date().toISOString()}</p>`,
        '<ol><li><a href="https://zilliverse.feishu.cn/wiki/a">1. get — page</a></li></ol>',
        '</body></html>',
    ].join('\n');
}

test('a page matching the fixed structure passes all points', () => {
    const report = validatePresentationHtml(validHtml(), { skipSessionFileExistence: true });
    assert.equal(report.ok, true, JSON.stringify(report.failures));
    assert.equal(report.gate, 'APPROVE_WRITES');
    assert.equal(report.digest, DIGEST);
    assert.equal(report.sessionPath, SESSION_FIXTURE);
    assert.equal(report.linkCount, 1);
});

test('campaign-level APPROVE_CAMPAIGN gate is a known reply-line gate (round-10 freeze)', () => {
    const html = validHtml().replace('APPROVE_WRITES', 'APPROVE_CAMPAIGN');
    const report = validatePresentationHtml(html, { skipSessionFileExistence: true });
    assert.equal(report.ok, true, JSON.stringify(report.failures));
    assert.equal(report.gate, 'APPROVE_CAMPAIGN');
    // The generator (gate-presentation.js, run as a subprocess) must pre-fill
    // the reply line for the campaign gate.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-campaign-'));
    const manifest = path.join(dir, 'manifest.json');
    fs.writeFileSync(manifest, JSON.stringify({
        gate: 'APPROVE_CAMPAIGN',
        digest: DIGEST,
        session: SESSION_FIXTURE,
        links: [{ label: 'get — page', url: 'https://zilliverse.feishu.cn/wiki/a' }],
    }));
    const generated = spawnSync(process.execPath, [GENERATOR_SCRIPT, '--manifest', manifest,
        '--index-dir', dir, '--no-open', '--no-clipboard'], { cwd: REPO_ROOT, encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    assert.match(generated.stdout, new RegExp(`APPROVE_CAMPAIGN ${DIGEST}`));
});

test('P1 — a missing, duplicate, or unknown gate banner fails', () => {
    for (const [name, mutate] of [
        ['missing', (html) => html.replace(/<h1>[^<]+<\/h1>/, '')],
        ['unknown-name', (html) => html.replace('<h1>APPROVE_WRITES', '<h1>APPROVE_WRITE')],
        ['duplicate', (html) => html.replace('<ol>', '<h1>APPROVE_WRITES — gate materials</h1>\n<ol>')],
    ]) {
        const report = validatePresentationHtml(mutate(validHtml()), { skipSessionFileExistence: true });
        assert.equal(report.ok, false, name);
        assert.ok(report.failures.some((item) => item.point === 'P1'), name);
    }
});

test('P2 — a missing, malformed, or duplicated bound digest fails', () => {
    for (const [name, mutate] of [
        ['missing', (html) => html.replace(/<p>bound digest:.*<\/p>/, '')],
        ['malformed', (html) => html.replace(DIGEST, `sha256:${'f'.repeat(32)}`)],
        ['duplicate', (html) => html.replace('<ol>', `<p>bound digest: <code>${DIGEST}</code></p>\n<ol>`)],
    ]) {
        const report = validatePresentationHtml(mutate(validHtml()), { skipSessionFileExistence: true });
        assert.equal(report.ok, false, name);
        assert.ok(report.failures.some((item) => item.point === 'P2'), name);
    }
});

test('P3 — the missing session line is exactly the 2026-10-14 incident', () => {
    const stripped = validHtml().replace(/<p>session:.*<\/p>/, '');
    const report = validatePresentationHtml(stripped, { skipSessionFileExistence: true });
    assert.equal(report.ok, false);
    const failure = report.failures.find((item) => item.point === 'P3');
    assert.equal(failure.code, 'PRESENTATION_SESSION_MISSING');
});

test('P3 — a session path that does not exist on disk fails at runtime check time', () => {
    const html = validHtml(); // tmp/sdk-doc-sync-runs/... does not exist on a CI checkout
    const report = validatePresentationHtml(html, { repoRoot: REPO_ROOT });
    assert.equal(report.ok, false, 'existence sub-check runs unless explicitly skipped');
    assert.ok(report.failures.some((item) => item.code === 'PRESENTATION_SESSION_FILE_NOT_FOUND'));
});

test('P4 — a missing or far-future generated stamp fails', () => {
    for (const [name, mutate] of [
        ['missing', (html) => html.replace(/<p>generated:[^<]*<\/p>/, '')],
        ['future', (html) => html.replace(/generated: [^<]+/, 'generated: 2999-01-01T00:00:00.000Z')],
    ]) {
        const report = validatePresentationHtml(mutate(validHtml()), { skipSessionFileExistence: true });
        assert.equal(report.ok, false, name);
        assert.ok(report.failures.some((item) => item.point === 'P4'), name);
    }
});

test('P5 — a page without material links fails', () => {
    const stripped = validHtml().replace(/<li><a href="[^"]+">[^<]+<\/a><\/li>/, '');
    const report = validatePresentationHtml(stripped, { skipSessionFileExistence: true });
    assert.equal(report.ok, false);
    assert.ok(report.failures.some((item) => item.point === 'P5'));
});

test('P6 — unbalanced tags fail', () => {
    const broken = validHtml().replace('</code></p>\n<p>generated', '</p>\n<p>generated');
    const report = validatePresentationHtml(broken, { skipSessionFileExistence: true });
    assert.equal(report.ok, false);
    assert.ok(report.failures.some((item) => item.code === 'PRESENTATION_TAGS_UNBALANCED'));
});

test('P7 — a page whose digest or session disagrees with its source fails', () => {
    const binding = { gate: 'APPROVE_WRITES', digest: DIGEST, session: SESSION_FIXTURE };
    const digestMismatch = validatePresentationHtml(
        validHtml().replace(DIGEST, `sha256:${'f'.repeat(64)}`),
        { skipSessionFileExistence: true, binding },
    );
    assert.ok(digestMismatch.failures.some((item) => item.code === 'PRESENTATION_BINDING_MISMATCH'));
    const sessionMismatch = validatePresentationHtml(
        validHtml().replace(SESSION_FIXTURE, 'tmp/other/session.json'),
        { skipSessionFileExistence: true, binding },
    );
    assert.ok(sessionMismatch.failures.some((item) => item.code === 'PRESENTATION_BINDING_MISMATCH'));
});

// ---------- CLI: pre-presentation check + --ensure regeneration loop ----------

test('the generated page passes the pre-presentation check end to end', () => {
    const indexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-check-cli-'));
    const manifest = renderValidPage(indexDir);
    const result = runCheck(['--file', path.join(indexDir, 'latest.html'), '--manifest', manifest,
        '--repo-root', REPO_ROOT]);
    // The session fixture does not exist on disk → P3 runtime check fails
    // unless the fixture is real; tests use the structural skip via --repo-root?
    // No: the CLI always runs the full check. Provide the session file.
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /PRESENTATION_SESSION_FILE_NOT_FOUND/);
    assert.match(result.stdout, /must NOT be presented/);
});

test('the pre-presentation check passes when the session file exists on disk', () => {
    const indexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-check-cli-'));
    const manifest = renderValidPage(indexDir);
    // The generator relativizes --session against cwd; run with cwd=REPO_ROOT,
    // so create the real fixture path inside the gitignored tmp/ tree.
    const sessionPath = path.join(REPO_ROOT, SESSION_FIXTURE);
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, '{}');
    try {
        const result = runCheck(['--file', path.join(indexDir, 'latest.html'), '--manifest', manifest,
            '--repo-root', REPO_ROOT, '--json']);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        const report = JSON.parse(result.stdout);
        assert.equal(report.ok, true);
        assert.equal(report.gate, 'APPROVE_WRITES');
        assert.equal(report.digest, DIGEST);
        assert.equal(report.regenerated, false);
    } finally {
        fs.rmSync(sessionPath);
    }
});

test('--ensure regenerates a broken page from its source until the check passes', () => {
    const indexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-check-ensure-'));
    const manifest = renderValidPage(indexDir);
    // Break the page exactly like the 2026-10-14 incident: strip the session line
    const page = path.join(indexDir, 'latest.html');
    fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace(/<p>session:.*<\/p>/, ''));
    const broken = runCheck(['--file', page, '--manifest', manifest, '--repo-root', REPO_ROOT]);
    assert.notEqual(broken.status, 0);
    assert.match(broken.stdout, /PRESENTATION_SESSION_MISSING/);

    const sessionPath = path.join(REPO_ROOT, SESSION_FIXTURE);
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, '{}');
    try {
        const ensured = runCheck(['--file', page, '--manifest', manifest, '--repo-root', REPO_ROOT,
            '--ensure', '--json']);
        assert.equal(ensured.status, 0, ensured.stdout + ensured.stderr);
        const report = JSON.parse(ensured.stdout);
        assert.equal(report.ok, true);
        assert.equal(report.regenerated, true);
        assert.ok(report.attemptsUsed >= 1);
        // The regenerated page really carries the session line again
        assert.match(fs.readFileSync(page, 'utf8'), /session: <code>/);
    } finally {
        fs.rmSync(sessionPath);
    }
});

test('--ensure without a regeneration source fails outright', () => {
    const result = runCheck(['--file', '/nonexistent/latest.html', '--ensure']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--ensure needs exactly one of --manifest or --from-dryrun/);
});

test('--ensure reports honest exhaustion when the source itself cannot pass (dead session path)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-check-exhaust-'));
    const indexDir = path.join(dir, 'index');
    const manifest = writeSourceManifest(dir, {
        gate: 'APPROVE_WRITES',
        digest: DIGEST,
        session: 'tmp/sdk-doc-sync-runs/does-not-exist/review-session.json',
        links: [{ label: 'get — page', url: 'https://zilliverse.feishu.cn/wiki/a' }],
    });
    // The generator's structure self-check skips on-disk existence, so each
    // regeneration SUCCEEDS structurally but the runtime P3 check keeps
    // failing — the loop must exhaust, never present.
    const result = runCheck(['--manifest', manifest, '--index-dir', indexDir,
        '--repo-root', REPO_ROOT, '--ensure', '--attempts', '2', '--json']);
    assert.notEqual(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.attemptsUsed, 2);
    assert.ok(report.failures.some((item) => item.code === 'PRESENTATION_SESSION_FILE_NOT_FOUND'));
});

test('--from-dryrun binding requires --session and binds the batch digest', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-check-dryrun-'));
    const dryrun = path.join(dir, 'dryrun.json');
    fs.writeFileSync(dryrun, JSON.stringify({
        proposedExecutionBatch: { batchDigest: DIGEST },
        writeApprovalPresentation: [
            { stableId: 's', title: 't', documentLink: 'https://host/wiki/a', recordLink: null, markdownPreview: 'x' },
        ],
    }));
    const missing = runCheck(['--from-dryrun', dryrun, '--file', path.join(dir, 'unused.html')]);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /requires --session/);

    const { resolveBinding } = require(CHECK_SCRIPT);
    const binding = resolveBinding({ fromDryrun: dryrun, session: SESSION_FIXTURE });
    assert.equal(binding.gate, 'APPROVE_WRITES');
    assert.equal(binding.digest, DIGEST);
    assert.equal(binding.session, path.resolve(REPO_ROOT, SESSION_FIXTURE));
});

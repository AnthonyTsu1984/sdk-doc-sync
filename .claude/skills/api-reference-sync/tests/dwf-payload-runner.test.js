'use strict';

// P1-2 (2026-10-21): dwf-payload-runner — the real CLI replacing the release-sync
// template's inline `node -e "<payload>"` strings (r1/r4 escape-seam class).
// Each subcommand mirrors a retired payload constant with logic byte-preserved;
// these tests pin the observable contracts the template's freeze paths depend on.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'dwf-payload-runner.js');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function run(subcommand, args = []) {
  return spawnSync(process.execPath, [SCRIPT, subcommand, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120000,
  });
}

function tempFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dwf-runner-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

test('detect-model-writing reports hasModelWriting from scope action types', () => {
  const pureUpdate = run('detect-model-writing', [tempFile('scope.json', JSON.stringify({
    actions: [{ type: 'UPDATE', stableId: 'a' }, { type: 'UPDATE', stableId: 'b' }],
  }))]);
  assert.equal(pureUpdate.status, 0, pureUpdate.stderr);
  assert.deepEqual(JSON.parse(pureUpdate.stdout), { ok: true, hasModelWriting: false, createLike: 0, total: 2 });

  const mixed = run('detect-model-writing', [tempFile('scope2.json', JSON.stringify({
    actions: [{ type: 'UPDATE', stableId: 'a' }, { type: 'CREATE', stableId: 'b' }, { type: 'BACKFILL', stableId: 'c' }],
  }))]);
  assert.deepEqual(JSON.parse(mixed.stdout), { ok: true, hasModelWriting: true, createLike: 2, total: 3 });
});

test('derive-audience-entries maps reviewed-context entries to the audience shape', () => {
  const ctx = tempFile('ctx.json', JSON.stringify({ contexts: {
    'python:Auth:create_role': { symbolName: 'create_role', title: 'create_role()', kind: 'method', category: 'Auth' },
  } }));
  const out = path.join(os.tmpdir(), 'entries-' + Date.now() + '.json');
  const result = run('derive-audience-entries', [ctx, out]);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.entries, 1);
  const entries = JSON.parse(fs.readFileSync(out, 'utf8')).entries;
  assert.deepEqual(entries[0], { symbol: 'create_role', page: 'create_role()', kind: 'method', category: 'Auth', stableId: 'python:Auth:create_role' });
});

test('extract-units validates digest shape and sorts previews', () => {
  const dry = tempFile('dry.json', JSON.stringify({ reviewUnitPreviews: [
    { reviewUnitId: 'b', batchDigest: 'sha256:' + 'b'.repeat(64) },
    { reviewUnitId: 'a', batchDigest: 'sha256:' + 'a'.repeat(64) },
  ] }));
  const out = path.join(os.tmpdir(), 'previews-' + Date.now() + '.json');
  const result = run('extract-units', [dry, out]);
  assert.equal(result.status, 0, result.stderr);
  const previews = JSON.parse(fs.readFileSync(out, 'utf8')).units;
  assert.deepEqual(previews.map((u) => u.reviewUnitId), ['a', 'b']);

  const badDigest = run('extract-units', [tempFile('bad.json', JSON.stringify({ reviewUnitPreviews: [{ reviewUnitId: 'x', batchDigest: 'nope' }] })), out]);
  assert.equal(badDigest.status, 1);
  assert.match(badDigest.stderr, /UNIT_DIGEST_INVALID/);
});

test('self-check rejects a drifted template pin (TEMPLATE_DRIFTED)', () => {
  const plan = tempFile('plan.json', JSON.stringify({
    kind: 'release-sync',
    // Real existing template file with a WRONG pinned hash → recompute differs.
    template: { path: path.resolve(__dirname, '..', 'workflows', 'release-sync-campaign.dwf.ts'), sha256: 'sha256:' + '0'.repeat(64) },
  }));
  const result = run('self-check', [plan, 'nonce']);
  assert.equal(result.status, 1);
  // The template reads the self-check verdict from STDOUT ({ok:false,...} JSON).
  assert.match(result.stdout, /TEMPLATE_DRIFTED/);
});

test('write-json / append / echo / clear-session tiny ops', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dwf-runner-ops-'));
  const file = path.join(dir, 'x.json');
  assert.equal(run('write-json', [file, '{"a":1}']).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).a, 1);
  assert.equal(run('append', [file, 'line1']).status, 0);
  assert.match(fs.readFileSync(file, 'utf8'), /line1\n$/);
  const echo = run('echo', ['hello']);
  assert.equal(echo.stdout, 'hello');
  assert.equal(run('clear-session', [file]).status, 0);
  assert.equal(fs.existsSync(file), false);
});

test('generic-run spawns a child CLI and captures stdout/stderr separately', () => {
  const out = path.join(os.tmpdir(), 'generic-out-' + Date.now() + '.txt');
  const err = out + '.stderr';
  // A real child script (the template passes CLI paths, not -e strings).
  const child = tempFile('child.js', 'console.log("hi");');
  const result = run('generic-run', [JSON.stringify([child]), out, err, '', '', '']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(out, 'utf8').trim(), 'hi');
});

test('gates subcommand emits the single-source gate registry (P1-3)', () => {
  const result = run('gates');
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.gates, [
    'APPROVE_GROUPING',
    'APPROVE_WRITES',
    'APPROVE_DOCUMENT',
    'APPROVE_ROLLBACK',
    'APPROVE_ACCEPTANCE',
    'APPROVE_CAMPAIGN',
  ]);
});

test('unknown subcommand fails with the known list', () => {
  const result = run('no-such-subcommand');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown dwf-payload-runner subcommand/);
});

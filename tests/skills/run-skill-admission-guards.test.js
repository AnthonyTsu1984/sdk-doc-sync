'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CANONICAL_SKILLS,
  admissionSourceFingerprint,
  dirtyPatchDigest,
  parseArgs,
  runAdmission,
} = require('../../scripts/run-skill-admission');
const {
  parseMajorVersion,
  runToolchainPreflight,
} = require('../../scripts/admission/toolchain-preflight');

function writeFixture(root) {
  for (const skill of CANONICAL_SKILLS) {
    const directory = path.join(root, '.claude', 'skills', skill);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'capabilities.json'), `${JSON.stringify({
      adapterPolicy: {
        operations: [{ operation: `${skill}-operation`, status: 'adopted' }],
      },
    })}\n`);
  }
}

const CLEAN_TREE = { dirty: false, statusOutput: '', diffOutput: '' };
const ALL_TOOLS_PRESENT = () => ({ ok: true, output: 'mock tool 22.0' });

test('parseMajorVersion reads the first version pair from probe output', () => {
  assert.equal(parseMajorVersion('v22.23.2'), 22);
  assert.equal(parseMajorVersion('javac 17.0.2'), 17);
  assert.equal(parseMajorVersion('no version here'), null);
  assert.equal(parseMajorVersion(''), null);
});

test('toolchain preflight fails closed when the manifest is missing or malformed', () => {
  for (const manifest of [undefined, {}, { tools: 'nope' }]) {
    const report = runToolchainPreflight({ manifest, probe: ALL_TOOLS_PRESENT });
    assert.equal(report.ok, false);
    assert.equal(report.failures[0].status, 'TOOLCHAIN_MANIFEST_INVALID');
  }
});

test('toolchain preflight passes when every manifest tool probes green', () => {
  const report = runToolchainPreflight({
    manifest: { tools: [
      { id: 'node', probes: [{ command: 'node', args: ['--version'] }], minMajor: 22 },
      { id: 'cpp-compiler', probes: [{ command: 'clang++', args: ['--version'] }] },
    ] },
    probe: () => ({ ok: true, output: 'v22.11.0' }),
  });
  assert.equal(report.ok, true);
  assert.deepEqual(report.failures, []);
  assert.equal(report.checks.length, 2);
});

test('toolchain preflight names the missing binary with its hint', () => {
  const report = runToolchainPreflight({
    manifest: { tools: [
      { id: 'javac', probes: [{ command: 'javac', args: ['-version'] }], minMajor: 17, hint: 'install a JDK' },
    ] },
    probe: () => ({ ok: false, output: '', detail: 'spawn javac ENOENT' }),
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.failures, [{
    id: 'javac',
    ok: false,
    status: 'TOOLCHAIN_MISSING',
    hint: 'install a JDK',
    observed: 'spawn javac ENOENT',
  }]);
});

test('toolchain preflight rejects a version below the manifest floor', () => {
  const report = runToolchainPreflight({
    manifest: { tools: [
      { id: 'node', probes: [{ command: 'node', args: ['--version'] }], minMajor: 22 },
    ] },
    probe: () => ({ ok: true, output: 'v20.19.4' }),
  });
  assert.equal(report.ok, false);
  assert.equal(report.failures[0].status, 'TOOLCHAIN_VERSION_TOO_LOW');
  assert.equal(report.failures[0].requiredMinMajor, 22);
  assert.equal(report.failures[0].observed, 'v20.19.4');
});

test('toolchain preflight falls back through the probe list before declaring a miss', () => {
  const report = runToolchainPreflight({
    manifest: { tools: [
      { id: 'cpp-compiler', probes: [
        { command: 'clang++', args: ['--version'] },
        { command: 'g++', args: ['--version'] },
      ] },
    ] },
    probe: (command) => (command === 'clang++'
      ? { ok: false, output: '', detail: 'spawn clang++ ENOENT' }
      : { ok: true, output: 'g++ (GCC) 14.2.0' }),
  });
  assert.equal(report.ok, true);
  assert.equal(report.checks[0].observed, 'g++ (GCC) 14.2.0');
});

test('admission refuses a dirty worktree before running any gate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'admission-dirty-refused-'));
  writeFixture(root);
  const calls = [];
  const result = runAdmission({
    repoRoot: root,
    phase: 'guard-dirty',
    now: () => '2026-09-26T00:00:00.000Z',
    dirtyState: () => ({ dirty: true, statusOutput: ' M CLAUDE.md\n?? stray.txt\n', diffOutput: 'diff --git a/CLAUDE.md' }),
    probe: ALL_TOOLS_PRESENT,
    runCommand: (entry) => { calls.push(entry.label); return { status: 0, signal: null }; },
  });

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.blocker, 'ADMISSION_DIRTY_WORKTREE');
  assert.deepEqual(result.dirtyPaths, [' M CLAUDE.md', '?? stray.txt']);
  assert.deepEqual(calls, []);
  assert.equal(result.sourceFingerprint, undefined);
  assert.equal(fs.existsSync(result.outputPath), true);
});

test('admission with --allow-dirty binds the dirty patch digest into the artifact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'admission-dirty-allowed-'));
  writeFixture(root);
  const dirty = { dirty: true, statusOutput: ' M CLAUDE.md\n', diffOutput: 'diff --git a/CLAUDE.md' };
  const expectedDigest = `sha256:${crypto.createHash('sha256')
    .update(dirty.statusOutput)
    .update('\0')
    .update(dirty.diffOutput)
    .digest('hex')}`;
  const result = runAdmission({
    repoRoot: root,
    phase: 'guard-dirty-allowed',
    allowDirty: true,
    now: () => '2026-09-26T00:00:00.000Z',
    dirtyState: () => dirty,
    probe: ALL_TOOLS_PRESENT,
    runCommand: () => ({ status: 0, signal: null }),
  });

  assert.equal(result.status, 'ADMITTED');
  assert.equal(result.dirtyTree, true);
  assert.equal(result.dirtyPatchDigest, expectedDigest);
  assert.equal(dirtyPatchDigest(dirty), expectedDigest);
});

test('admission fails closed when the dirty state cannot be determined', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'admission-dirty-error-'));
  writeFixture(root);
  const calls = [];
  const result = runAdmission({
    repoRoot: root,
    phase: 'guard-dirty-error',
    now: () => '2026-09-26T00:00:00.000Z',
    dirtyState: () => ({ error: 'git: not a repository' }),
    probe: ALL_TOOLS_PRESENT,
    runCommand: (entry) => { calls.push(entry.label); return { status: 0, signal: null }; },
  });

  assert.equal(result.status, 'BLOCKED');
  assert.match(result.blocker, /^ADMISSION_DIRTY_STATE_UNAVAILABLE: git: not a repository$/);
  assert.deepEqual(calls, []);
});

test('admission blocks at preflight with the typed toolchain blocker and runs no gate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'admission-toolchain-'));
  writeFixture(root);
  const calls = [];
  const result = runAdmission({
    repoRoot: root,
    phase: 'guard-toolchain',
    now: () => '2026-09-26T00:00:00.000Z',
    dirtyState: () => CLEAN_TREE,
    probe: (command) => (command === 'javac'
      ? { ok: false, output: '', detail: 'spawn javac ENOENT' }
      : { ok: true, output: 'mock tool 22.0' }),
    runCommand: (entry) => { calls.push(entry.label); return { status: 0, signal: null }; },
  });

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.blocker, 'TOOLCHAIN_PRECONDITION_FAILED: javac');
  assert.equal(result.toolchain.ok, false);
  assert.deepEqual(result.toolchain.failures.map(failure => failure.id), ['javac']);
  assert.deepEqual(calls, []);
});

test('admission voids every prior stage result when the source drifts mid-run', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'admission-drift-'));
  writeFixture(root);
  const target = path.join(root, '.claude', 'skills', 'api-reference-sync', 'capabilities.json');
  const calls = [];
  const result = runAdmission({
    repoRoot: root,
    phase: 'guard-drift',
    now: () => '2026-09-26T00:00:00.000Z',
    dirtyState: () => CLEAN_TREE,
    probe: ALL_TOOLS_PRESENT,
    runCommand: (entry) => {
      calls.push(entry.label);
      if (entry.label === 'validate:skills') fs.appendFileSync(target, '\n');
      return { status: 0, signal: null };
    },
  });

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.blocker, 'ADMISSION_SOURCE_CHANGED_DURING_RUN');
  assert.equal(result.voidedResults, true);
  assert.deepEqual(calls, ['validate:skills']);
  assert.deepEqual(result.results.map(record => record.label), ['validate:skills']);
  assert.equal(result.results.every(record => record.voided === true), true);
  assert.equal(result.sourceDrift.at, 'before:check:invariants');
  assert.notEqual(result.sourceDrift.observed, result.sourceDrift.expected);
  assert.equal(result.status, 'BLOCKED');
});

test('a clean guarded admission records the toolchain report and no dirty fields', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'admission-clean-'));
  writeFixture(root);
  const result = runAdmission({
    repoRoot: root,
    phase: 'guard-clean',
    now: () => '2026-09-26T00:00:00.000Z',
    dirtyState: () => CLEAN_TREE,
    probe: ALL_TOOLS_PRESENT,
    runCommand: () => ({ status: 0, signal: null }),
  });

  assert.equal(result.status, 'ADMITTED');
  assert.equal(result.toolchain.ok, true);
  assert.equal('dirtyTree' in result, false);
  assert.equal('dirtyPatchDigest' in result, false);
  assert.match(result.sourceFingerprint, /^sha256:[0-9a-f]{64}$/);
});

test('the toolchain manifest is part of the admission source fingerprint', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'admission-manifest-pin-'));
  writeFixture(root);
  const admissionDir = path.join(root, 'scripts', 'admission');
  fs.mkdirSync(admissionDir, { recursive: true });
  const manifestPath = path.join(admissionDir, 'toolchain-manifest.json');
  fs.writeFileSync(manifestPath, '{"tools":[]}\n');
  const before = admissionSourceFingerprint({ repoRoot: root });
  fs.writeFileSync(manifestPath, '{"tools":[{"id":"javac"}]}\n');
  const after = admissionSourceFingerprint({ repoRoot: root });
  assert.notEqual(before, after);
});

test('CLI exposes --allow-dirty and keeps it out of the default options', () => {
  assert.equal(parseArgs(['--phase', 'p']).allowDirty, false);
  assert.equal(parseArgs(['--phase', 'p', '--allow-dirty']).allowDirty, true);
  assert.throws(() => parseArgs(['--phase', 'p', '--allow-dirty-file', 'x']), /ADMISSION_ARGUMENT_UNKNOWN/);
});

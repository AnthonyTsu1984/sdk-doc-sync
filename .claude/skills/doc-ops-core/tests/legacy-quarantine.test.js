'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  EXIT_QUARANTINED,
  QUARANTINE_ENV_FLAG,
  createExceptionGovernance,
  enforceLegacyQuarantine,
  evaluateLegacyQuarantine,
} = require('../../doc-ops-core/src/legacy-quarantine');
const {
  hasFirstStatementLegacyGuard,
  loadWriteEntrypointRegistry,
} = require('../../doc-ops-core/src/write-entrypoint-registry');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function registryWith(entries) {
  return { schemaVersion: 1, baseline: { legacyLiveCount: 0 }, entries };
}

const LEGACY_ENTRY = {
  path: 'scripts/legacy-one-off.js',
  classification: 'legacy-live',
  quarantineFlag: QUARANTINE_ENV_FLAG,
  canonicalReplacement: 'canonical/sync.js',
  admittedAtBaseline: true,
};

test('evaluation quarantines legacy-live entrypoints without the environment gate', () => {
  const decision = evaluateLegacyQuarantine({
    entrypointPath: 'scripts/legacy-one-off.js',
    env: {},
    registry: registryWith([LEGACY_ENTRY]),
    expectedChanges: [],
  });
  assert.equal(decision.quarantined, true);
  assert.equal(decision.reason, 'environment-gate-closed');
});

test('evaluation requires an unexpired reviewed exception even with the gate open', () => {
  const env = { [QUARANTINE_ENV_FLAG]: '1' };
  const registry = registryWith([LEGACY_ENTRY]);

  const missing = evaluateLegacyQuarantine({
    entrypointPath: 'scripts/legacy-one-off.js',
    env,
    registry,
    expectedChanges: [],
  });
  assert.equal(missing.quarantined, true);
  assert.equal(missing.reason, 'no-unexpired-exception');

  const expired = evaluateLegacyQuarantine({
    entrypointPath: 'scripts/legacy-one-off.js',
    env,
    registry,
    expectedChanges: [{ entrypointPath: 'scripts/legacy-one-off.js', expiresAt: '2026-01-01T00:00:00.000Z' }],
    now: '2026-09-23T00:00:00.000Z',
  });
  assert.equal(expired.quarantined, true);

  const allowed = evaluateLegacyQuarantine({
    entrypointPath: 'scripts/legacy-one-off.js',
    env,
    registry,
    expectedChanges: [{ entrypointPath: 'scripts/legacy-one-off.js', expiresAt: '2026-10-01T00:00:00.000Z' }],
    now: '2026-09-23T00:00:00.000Z',
  });
  assert.equal(allowed.quarantined, false);
  assert.equal(allowed.reason, 'exception-and-gate-present');
  assert.equal(allowed.exceptionExpiresAt, '2026-10-01T00:00:00.000Z');
});

test('evaluation admits non-legacy classifications without any gate', () => {
  const decision = evaluateLegacyQuarantine({
    entrypointPath: 'scripts/canonical-sync.js',
    env: {},
    registry: registryWith([{ path: 'scripts/canonical-sync.js', classification: 'canonical-governed' }]),
    expectedChanges: [],
  });
  assert.equal(decision.quarantined, false);
});

test('enforceLegacyQuarantine skips enforcement when the file is imported rather than run', () => {
  const decision = enforceLegacyQuarantine({
    entrypointPath: '/repo/scripts/legacy-one-off.js',
    env: {},
    repoRoot: '/repo',
    registry: registryWith([{ ...LEGACY_ENTRY, path: 'scripts/legacy-one-off.js' }]),
    argv: ['/usr/local/bin/node', '/repo/tests/some.test.js'],
    exit: () => { throw new Error('must not exit on import'); },
  });
  assert.equal(decision.quarantined, false);
  assert.equal(decision.reason, 'not-main-module');
});

test('enforceLegacyQuarantine terminates a quarantined run with the canonical replacement', () => {
  const messages = [];
  let exitCode = null;
  const decision = enforceLegacyQuarantine({
    entrypointPath: '/repo/scripts/legacy-one-off.js',
    env: {},
    repoRoot: '/repo',
    registry: registryWith([{ ...LEGACY_ENTRY, path: 'scripts/legacy-one-off.js' }]),
    argv: ['/usr/local/bin/node', '/repo/scripts/legacy-one-off.js'],
    write: (message) => messages.push(message),
    exit: (code) => { exitCode = code; },
  });
  assert.equal(decision.quarantined, true);
  assert.equal(exitCode, EXIT_QUARANTINED);
  const output = messages.join('');
  assert.match(output, /LEGACY_LIVE_QUARANTINED/);
  assert.match(output, /canonical\/sync\.js/);
  assert.match(output, /NOT harness-guaranteed/);
});

test('every registered legacy-live entrypoint carries the runtime guard as its first statement', () => {
  const registry = loadWriteEntrypointRegistry({ repoRoot: REPO_ROOT });
  const legacy = registry.entries.filter((entry) => entry.classification === 'legacy-live');
  assert.equal(legacy.length, 8); // 5 baseline + 3 Golden Rule 4 post-actions under exception (phase-6 wave-1 disposition removed the other 79)
  for (const entry of legacy) {
    const source = fs.readFileSync(path.join(REPO_ROOT, entry.path), 'utf8');
    const guardIndex = source.split('\n').findIndex((line) => line.includes('enforceLegacyQuarantine'));
    assert.ok(guardIndex >= 0, `${entry.path} is missing the quarantine guard`);
    assert.ok(guardIndex <= 2, `${entry.path} must call the guard at the top of the file (found at line ${guardIndex + 1})`);
    assert.equal(
      hasFirstStatementLegacyGuard(source),
      true,
      `${entry.path} guard must be the first executable statement`,
    );
  }
});

test('running a real quarantined entrypoint refuses before any skill module loads', () => {
  const result = spawnSync(process.execPath, [
    path.join(REPO_ROOT, '.claude', 'skills', 'api-reference-sync', 'scripts', 'node-v30-update.js'),
    '--help',
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, [QUARANTINE_ENV_FLAG]: '' },
  });
  assert.equal(result.status, EXIT_QUARANTINED);
  assert.match(result.stderr, /LEGACY_LIVE_QUARANTINED/);
  assert.doesNotMatch(result.stderr, / dotenv|FEISHU|token/i);
});

test('guard coverage admission fails for a legacy-live entrypoint without the guard', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-quarantine-'));
  const scripts = path.join(root, 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(path.join(scripts, 'unguarded-legacy.js'), 'writer.updateRecord(rec);\n');
  const { validateWriteEntrypointRegistry } = require('../../doc-ops-core/src/write-entrypoint-registry');
  try {
    const registry = {
      schemaVersion: 1,
      baseline: { legacyLiveCount: 1 },
      entries: [{
        path: 'scripts/unguarded-legacy.js',
        classification: 'legacy-live',
        quarantineFlag: QUARANTINE_ENV_FLAG,
        canonicalReplacement: 'canonical.js',
        admittedAtBaseline: true,
      }],
    };
    fs.mkdirSync(path.join(root, '.claude', 'skills', 'doc-ops-core'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.claude', 'skills', 'doc-ops-core', 'write-entrypoints.json'),
      JSON.stringify(registry),
    );
    const result = validateWriteEntrypointRegistry({ repoRoot: root });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.code === 'LEGACY_LIVE_RUNTIME_GUARD_REQUIRED'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a symlinked invocation of a legacy-live entrypoint stays quarantined', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-symlink-'));
  const scripts = path.join(root, 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  const realScript = path.join(scripts, 'real-legacy.js');
  fs.writeFileSync(realScript, 'writer.deleteRecord(r);\n');
  const link = path.join(root, 'legacy-alias.js');
  fs.symlinkSync(realScript, link);

  let exitCode = null;
  const messages = [];
  enforceLegacyQuarantine({
    entrypointPath: realScript,
    env: {},
    repoRoot: root,
    registry: registryWith([{ ...LEGACY_ENTRY, path: 'scripts/real-legacy.js' }]),
    argv: [process.execPath, link],
    write: (message) => messages.push(message),
    exit: (code) => { exitCode = code; },
  });
  assert.equal(exitCode, EXIT_QUARANTINED, 'symlinked entrypoints must not slip past the guard');
  assert.match(messages.join(''), /LEGACY_LIVE_QUARANTINED/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('guard anchoring rejects mentions that are not the first executable statement', () => {
  const guarded = [
    "require('../doc-ops-core/src/legacy-quarantine').enforceLegacyQuarantine({ entrypointPath: __filename });\nwriter.deleteRecord(r);\n",
    "#!/usr/bin/env node\nrequire('./legacy-quarantine.js').enforceLegacyQuarantine({ entrypointPath: __filename });\nmain();\n",
    "/* header\n   comment */\nconst decision = require('./legacy-quarantine.js').enforceLegacyQuarantine({ entrypointPath: __filename });\nmain();\n",
    "const { enforceLegacyQuarantine, createExceptionGovernance } = require('../../doc-ops-core/src/legacy-quarantine.js');\n// comment\nconst g = createExceptionGovernance({ decision: enforceLegacyQuarantine({ entrypointPath: __filename }) });\n",
    "'use strict';\nrequire('./legacy-quarantine.js').enforceLegacyQuarantine({ entrypointPath: __filename });\n",
  ];
  for (const source of guarded) {
    assert.equal(hasFirstStatementLegacyGuard(source), true, source.slice(0, 60));
  }
  const unguarded = [
    "writer.deleteRecord(r);\nrequire('./legacy-quarantine.js').enforceLegacyQuarantine({ entrypointPath: __filename });\n",
    "// require('./legacy-quarantine.js').enforceLegacyQuarantine({ entrypointPath: __filename });\nwriter.deleteRecord(r);\n",
    "if (false) { require('./legacy-quarantine.js').enforceLegacyQuarantine({ entrypointPath: __filename }); }\nwriter.deleteRecord(r);\n",
    "const { enforceLegacyQuarantine } = require('./legacy-quarantine.js');\nsetup();\nenforceLegacyQuarantine({ entrypointPath: __filename });\nwriter.deleteRecord(r);\n",
  ];
  for (const source of unguarded) {
    assert.equal(hasFirstStatementLegacyGuard(source), false, source.slice(0, 60));
  }
});

test('exception governance is minted only from a sanctioned decision and records the exception', () => {
  const sanctioned = evaluateLegacyQuarantine({
    entrypointPath: 'scripts/legacy-one-off.js',
    env: { [QUARANTINE_ENV_FLAG]: '1' },
    registry: registryWith([LEGACY_ENTRY]),
    expectedChanges: [{ entrypointPath: 'scripts/legacy-one-off.js', expiresAt: '2026-10-01T00:00:00.000Z' }],
    now: '2026-09-23T00:00:00.000Z',
  });
  // 6.5: the exception governance now also binds a run manifest over the
  // widened working-tree fingerprint — carved out of nothing, source-bound
  // like the canonical path.
  const exceptionRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'exception-manifest-'));
  spawnSync('git', ['init', '-q', '.'], { cwd: exceptionRepo });
  fs.writeFileSync(path.join(exceptionRepo, 'one-off.js'), 'write stuff\n');
  const governance = createExceptionGovernance({ skill: 'api-reference-sync', operation: 'feishu-doc', decision: sanctioned, repoRoot: exceptionRepo });
  assert.equal(governance.runManifestBound, true);
  assert.match(governance.run.skillVersion, /^legacy-exception@/);
  assert.equal(governance.isBound, true);
  assert.equal(governance.assertMutationAllowed({ method: 'push_markdown', target: 'doc-1' }), true);

  assert.throws(
    () => createExceptionGovernance({ skill: 'api-reference-sync', operation: 'feishu-doc', decision: { quarantined: false, reason: 'not-legacy-live' } }),
    (error) => error.code === 'LEGACY_EXCEPTION_GOVERNANCE_REFUSED',
  );
  assert.throws(
    () => createExceptionGovernance({ skill: 'api-reference-sync', operation: 'feishu-doc', decision: { quarantined: true, reason: 'environment-gate-closed', entry: LEGACY_ENTRY } }),
    (error) => error.code === 'LEGACY_EXCEPTION_GOVERNANCE_REFUSED',
  );
});

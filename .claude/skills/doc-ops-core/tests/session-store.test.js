'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { loadState, saveState, stateDigest, SessionStoreError } = require('../src/session-store');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'session-store-'));
}

test('saveState writes atomically and loadState returns the state with its digest', () => {
  const root = tempDir();
  const filePath = path.join(root, 'nested', 'session.json');
  const state = { schemaVersion: 1, sessionId: 's1', status: 'queue_ready' };
  const saved = saveState(filePath, state, { expectedPreviousDigest: null });
  assert.equal(fs.existsSync(saved.path), true);
  // No temporary residue: the atomic replace cleaned up after itself.
  assert.deepEqual(fs.readdirSync(path.dirname(filePath)).filter(name => name.includes('.tmp')), []);
  const { state: loaded, stateDigest: digest } = loadState(filePath);
  assert.deepEqual(loaded, state);
  assert.equal(digest, saved.stateDigest);
  assert.equal(digest, stateDigest(state));
});

test('a matching expectedPreviousDigest saves; a stale one refuses the save (lost-update detection)', () => {
  const root = tempDir();
  const filePath = path.join(root, 'session.json');
  const first = { schemaVersion: 1, sessionId: 's1' };
  saveState(filePath, first, { expectedPreviousDigest: null });
  const { stateDigest: firstDigest } = loadState(filePath);

  // A concurrent writer lands between the caller's load and its save.
  const concurrent = { schemaVersion: 1, sessionId: 's2' };
  saveState(filePath, concurrent, { expectedPreviousDigest: firstDigest });

  assert.throws(
    () => saveState(filePath, first, { expectedPreviousDigest: firstDigest }),
    (error) => error instanceof SessionStoreError && error.code === 'SESSION_STATE_DIGEST_MISMATCH',
  );
  // The concurrent evidence is intact — not clobbered.
  assert.equal(loadState(filePath).state.sessionId, 's2');

  // The caller that reloaded first saves cleanly.
  const { stateDigest: currentDigest } = loadState(filePath);
  const updated = { ...concurrent, status: 'finalized' };
  saveState(filePath, updated, { expectedPreviousDigest: currentDigest });
  assert.equal(loadState(filePath).state.status, 'finalized');
});

test('the compare-and-set expectation is mandatory and create semantics refuse an existing file', () => {
  const root = tempDir();
  const filePath = path.join(root, 'session.json');

  // Omitting the expectation used to skip the on-disk check entirely and
  // overwrite concurrent evidence — it is now a typed refusal.
  assert.throws(
    () => saveState(filePath, { schemaVersion: 1 }),
    (error) => error instanceof SessionStoreError && error.code === 'SESSION_EXPECTED_DIGEST_REQUIRED',
  );

  saveState(filePath, { schemaVersion: 1, sessionId: 's1' }, { expectedPreviousDigest: null });

  // `null` asserts a create: a second creator may not reset the session.
  assert.throws(
    () => saveState(filePath, { schemaVersion: 1, sessionId: 's2' }, { expectedPreviousDigest: null }),
    (error) => error instanceof SessionStoreError && error.code === 'SESSION_STATE_EXISTS',
  );
  assert.equal(loadState(filePath).state.sessionId, 's1');

  // A digest expectation against a file that vanished is a mismatch, not a
  // silent recreate.
  fs.rmSync(filePath);
  assert.throws(
    () => saveState(filePath, { schemaVersion: 1, sessionId: 's3' }, { expectedPreviousDigest: 'sha256:gone' }),
    (error) => error instanceof SessionStoreError && error.code === 'SESSION_STATE_DIGEST_MISMATCH'
      && error.details.onDiskDigest === null,
  );
});

test('custom serializers and file modes survive the round trip', () => {
  const root = tempDir();
  const filePath = path.join(root, 'session.json');
  const canonicalLine = require('../src/canonical-json').canonicalStringify;
  const state = { schemaVersion: 1, sessionId: 's3' };
  const saved = saveState(filePath, state, {
    expectedPreviousDigest: null,
    serialize: state2 => canonicalLine(state2),
    mode: 0o600,
  });
  const mode = fs.statSync(saved.path).mode & 0o777;
  assert.equal(mode, 0o600);
  const { state: loaded } = loadState(filePath);
  assert.deepEqual(loaded, state);
});

test('saveState refuses non-object state and a missing path', () => {
  const root = tempDir();
  assert.throws(() => saveState(null, {}), (error) => error.code === 'SESSION_STORE_PATH_REQUIRED');
  assert.throws(() => saveState(path.join(root, 'x.json'), null), (error) => error.code === 'SESSION_STORE_STATE_REQUIRED');
});

// --- Cross-process races ---------------------------------------------------
//
// The durability contract's whole point is what happens when two PROCESSES
// race; sequential in-process calls cannot prove it. Each child waits on a
// barrier file, optionally loads the current digest, reports readiness, and
// saves under the parent's second barrier — so both children hold the same
// base expectation before either writes.

const CHILD_SCRIPT = `
const fs = require('node:fs');
const { loadState, saveState } = require(process.env.CHILD_STORE);
const spec = JSON.parse(fs.readFileSync(process.env.CHILD_SPEC, 'utf8'));
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function waitBarrier(file) {
  const deadline = Date.now() + 15000;
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) { console.log(JSON.stringify({ ok: false, code: 'CHILD_BARRIER_TIMEOUT' })); process.exit(0); }
    sleep(5);
  }
}
waitBarrier(spec.barrier1);
let expected = null;
if (spec.mode === 'cas') expected = loadState(spec.filePath).stateDigest;
if (spec.readyFile) fs.writeFileSync(spec.readyFile, 'ready');
waitBarrier(spec.barrier2);
try {
  const saved = saveState(spec.filePath, spec.value, { expectedPreviousDigest: expected });
  console.log(JSON.stringify({ ok: true, digest: saved.stateDigest, value: spec.value }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, code: error.code || String(error && error.message) }));
}
`;

function runChild(specPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', CHILD_SCRIPT], {
      env: { ...process.env, CHILD_SPEC: specPath, CHILD_STORE: path.join(__dirname, '..', 'src', 'session-store.js') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('error', reject);
    child.on('close', () => {
      try {
        resolve(JSON.parse(out.trim().split('\n').pop()));
      } catch {
        reject(new Error(`child did not report JSON: ${out}`));
      }
    });
  });
}

function writeSpec(directory, index, spec) {
  const specPath = path.join(directory, `spec-${index}.json`);
  fs.writeFileSync(specPath, JSON.stringify(spec));
  return specPath;
}

function awaitReady(directory, count) {
  const ready = Array.from({ length: count }, (_, index) => path.join(directory, `ready-${index}`));
  const deadline = Date.now() + 10_000;
  while (!ready.every((file) => fs.existsSync(file))) {
    if (Date.now() > deadline) throw new Error('children never reported readiness');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
}

test('two concurrent processes cannot both create the same session (create race)', async () => {
  const root = tempDir();
  const filePath = path.join(root, 'session.json');
  const barrier1 = path.join(root, 'barrier-1');
  const barrier2 = path.join(root, 'barrier-2');
  const values = [{ schemaVersion: 1, sessionId: 'winner-A' }, { schemaVersion: 1, sessionId: 'winner-B' }];
  const specs = values.map((value, index) => writeSpec(root, index, {
    filePath, value, mode: 'create', barrier1, barrier2, readyFile: path.join(root, `ready-${index}`),
  }));
  fs.writeFileSync(barrier1, 'go');
  fs.writeFileSync(barrier2, 'go');
  const results = await Promise.all(specs.map(runChild));

  const winners = results.filter((result) => result.ok);
  assert.equal(winners.length, 1, `exactly one creator may win, got: ${JSON.stringify(results)}`);
  const loser = results.find((result) => !result.ok);
  assert.equal(loser.code, 'SESSION_STATE_EXISTS');

  // The surviving file is the winner's, byte-for-byte by digest — no mixture.
  const final = loadState(filePath);
  assert.deepEqual(final.state, winners[0].value);
  assert.equal(final.stateDigest, winners[0].digest);

  // No lock or temporary residue after the race.
  assert.deepEqual(fs.readdirSync(root).filter((name) => name.endsWith('.lock') || name.includes('.tmp')), []);
});

test('two concurrent processes saving from the same base digest: exactly one lands (lost-update race)', async () => {
  const root = tempDir();
  const filePath = path.join(root, 'session.json');
  saveState(filePath, { schemaVersion: 1, sessionId: 'base', revision: 1 }, { expectedPreviousDigest: null });

  const barrier1 = path.join(root, 'barrier-1');
  const barrier2 = path.join(root, 'barrier-2');
  const values = [{ schemaVersion: 1, sessionId: 'base', revision: 2 }, { schemaVersion: 1, sessionId: 'base', revision: 3 }];
  const specs = values.map((value, index) => writeSpec(root, index, {
    filePath, value, mode: 'cas', barrier1, barrier2, readyFile: path.join(root, `ready-${index}`),
  }));
  // Both children load the base digest before either is allowed to save, so
  // both hold the same stale expectation — exactly the interleaving a
  // non-atomic check-then-act would lose an update in.
  const pending = Promise.all(specs.map(runChild));
  fs.writeFileSync(barrier1, 'go');
  awaitReady(root, values.length);
  fs.writeFileSync(barrier2, 'go');
  const results = await pending;

  const winner = results.find((result) => result.ok);
  assert.ok(winner, `exactly one writer must land, got: ${JSON.stringify(results)}`);
  assert.equal(results.filter((result) => result.ok).length, 1);
  const loser = results.find((result) => !result.ok);
  assert.equal(loser.code, 'SESSION_STATE_DIGEST_MISMATCH');

  const final = loadState(filePath);
  assert.deepEqual(final.state, winner.value);
  assert.equal(final.stateDigest, winner.digest);
});

test('a live lock holder refuses the save instead of bypassing the compare-and-set', () => {
  const root = tempDir();
  const filePath = path.join(root, 'session.json');
  const lockPath = `${filePath}.lock`;
  fs.mkdirSync(lockPath);
  // The test process itself is the live holder: its pid is alive, so the
  // lock is not stale and contention must surface as a typed refusal.
  fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({
    pid: process.pid,
    host: os.hostname(),
    acquiredAt: Date.now(),
  }));
  assert.throws(
    () => saveState(filePath, { schemaVersion: 1 }, { expectedPreviousDigest: null, lockTimeoutMs: 200 }),
    (error) => error instanceof SessionStoreError && error.code === 'SESSION_LOCK_CONTENDED',
  );
  fs.rmSync(lockPath, { recursive: true, force: true });
  saveState(filePath, { schemaVersion: 1 }, { expectedPreviousDigest: null });
  assert.equal(loadState(filePath).state.schemaVersion, 1);
});

test('a stale lock is reclaimed: dead owner pid and an orphaned lock directory', async () => {
  const root = tempDir();
  const filePath = path.join(root, 'session.json');
  const lockPath = `${filePath}.lock`;

  // A lock whose owner pid no longer exists is dead weight — reclaim it.
  const deadChild = spawn(process.execPath, ['-e', 'process.exit(0)']);
  await new Promise((resolve) => deadChild.on('close', resolve));
  fs.mkdirSync(lockPath);
  fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({
    pid: deadChild.pid,
    host: os.hostname(),
    acquiredAt: Date.now(),
  }));
  saveState(filePath, { schemaVersion: 1, sessionId: 'after-dead-pid' }, { expectedPreviousDigest: null });
  assert.equal(loadState(filePath).state.sessionId, 'after-dead-pid');
  assert.equal(fs.existsSync(lockPath), false);

  // An owner file that never materialized becomes stealable after the grace
  // window, so a crash between mkdir and the owner write cannot deadlock
  // every future save.
  const orphanRoot = tempDir();
  const orphanPath = path.join(orphanRoot, 'session.json');
  fs.mkdirSync(`${orphanPath}.lock`);
  saveState(orphanPath, { schemaVersion: 1 }, {
    expectedPreviousDigest: null,
    lockStaleGraceMs: 10,
  });
  assert.equal(loadState(orphanPath).state.schemaVersion, 1);
});

test('a foreign-host lock is never reclaimed by pid liveness — only by TTL', () => {
  const root = tempDir();
  const filePath = path.join(root, 'session.json');
  const lockPath = `${filePath}.lock`;
  fs.mkdirSync(lockPath);
  // pid 999999 is dead on THIS host, but the owner names another host:
  // liveness there is unknowable from the local process table, so the lock
  // must survive until its TTL lapses.
  fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({
    pid: 999999,
    host: 'some-other-host',
    acquiredAt: Date.now(),
  }));
  assert.throws(
    () => saveState(filePath, { schemaVersion: 1 }, { expectedPreviousDigest: null, lockTimeoutMs: 150 }),
    (error) => error instanceof SessionStoreError && error.code === 'SESSION_LOCK_CONTENDED',
  );
  // Once the TTL lapses, the foreign lock is reclaimable again.
  fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({
    pid: 999999,
    host: 'some-other-host',
    acquiredAt: Date.now() - 60_000,
  }));
  saveState(filePath, { schemaVersion: 1 }, { expectedPreviousDigest: null });
  assert.equal(loadState(filePath).state.schemaVersion, 1);
});

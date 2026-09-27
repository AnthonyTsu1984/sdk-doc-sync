'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadState, saveState, stateDigest, SessionStoreError } = require('../src/session-store');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'session-store-'));
}

test('saveState writes atomically and loadState returns the state with its digest', () => {
  const root = tempDir();
  const filePath = path.join(root, 'nested', 'session.json');
  const state = { schemaVersion: 1, sessionId: 's1', status: 'queue_ready' };
  const saved = saveState(filePath, state);
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
  saveState(filePath, first);
  const { stateDigest: firstDigest } = loadState(filePath);

  // A concurrent writer lands between the caller's load and its save.
  const concurrent = { schemaVersion: 1, sessionId: 's2' };
  saveState(filePath, concurrent);

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

test('custom serializers and file modes survive the round trip', () => {
  const root = tempDir();
  const filePath = path.join(root, 'session.json');
  const canonicalLine = require('../src/canonical-json').canonicalStringify;
  const state = { schemaVersion: 1, sessionId: 's3' };
  const saved = saveState(filePath, state, {
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

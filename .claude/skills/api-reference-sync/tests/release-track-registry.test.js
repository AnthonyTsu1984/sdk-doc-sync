'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_REGISTRY_PATH,
  adjacentTracks,
  getTrack,
  listLanguageTracks,
  loadReleaseTrackRegistry,
  requireTrack,
  resolveIdentity,
  trackBaseToken,
  trackReleaseRootToken,
  validateReleaseTrackRegistry,
} = require('../src/sdk-doc-sync/release-track-registry');

test('the committed registry loads and models cpp dual-track adjacency', () => {
  const registry = loadReleaseTrackRegistry();

  assert.deepEqual(validateReleaseTrackRegistry(registry), { valid: true, errors: [] });

  const cppTracks = listLanguageTracks(registry, 'cpp').map((track) => track.version);
  assert.deepEqual(cppTracks, ['v2.6.x', 'v3.0.x']);

  const v26 = requireTrack(registry, 'cpp', 'v2.6.x');
  // The v2.6 configured Drive root is a multi-version container; the release
  // root is the explicit child folder (sdk-cpp.md placement rule).
  assert.equal(trackBaseToken(v26), 'XmndbkxkQaigA8soRiCcTT41nMd');
  assert.equal(trackReleaseRootToken(v26), 'CSzVfDgfAlne87dDj3vcnR3nnsg');
  assert.equal(v26.drive.releaseRoot.resolution, 'explicit-child');
  assert.notEqual(v26.drive.configuredRootToken, trackReleaseRootToken(v26));

  const v30 = requireTrack(registry, 'cpp', 'v3.0.x');
  assert.equal(trackBaseToken(v30), 'QdLkbfmnFatl4TsThKDc5Dobn5g');
  assert.equal(trackReleaseRootToken(v30), 'NVjgfJr5aleBsedDoKCcDpnJn9b');
  assert.equal(v30.drive.releaseRoot.resolution, 'configured-root');

  assert.deepEqual(
    adjacentTracks(registry, 'cpp', 'v3.0.x').map((track) => track.version),
    ['v2.6.x'],
  );
  assert.equal(getTrack(registry, 'cpp', 'v9.9.x'), null);
});

test('registry identities match the published sdk reference tables', () => {
  const registry = loadReleaseTrackRegistry();
  const cppDoc = fs.readFileSync(
    path.join(__dirname, '..', 'sdk-cpp.md'),
    'utf8',
  );
  for (const track of listLanguageTracks(registry, 'cpp')) {
    assert.ok(
      cppDoc.includes(trackBaseToken(track)),
      `cpp ${track.version} base token must stay in sync with sdk-cpp.md`,
    );
    assert.ok(
      cppDoc.includes(trackReleaseRootToken(track)),
      `cpp ${track.version} release root must stay in sync with sdk-cpp.md`,
    );
  }
});

test('registry resolution supports env references and rejects unresolved identities', () => {
  assert.equal(resolveIdentity({ env: 'TRACK_BASE' }, { TRACK_BASE: 'base-from-env' }), 'base-from-env');
  assert.equal(resolveIdentity({ env: 'TRACK_BASE' }, {}), null);
  assert.equal(resolveIdentity('literal'), 'literal');
  assert.equal(resolveIdentity(null), null);

  const registry = loadReleaseTrackRegistry();
  const envTrack = {
    version: 'v2.6.x',
    bitable: { baseToken: { env: 'CPP_V26_BASE' }, tableId: null },
    drive: { releaseRoot: { resolution: 'explicit-child', token: { env: 'CPP_V26_ROOT' } } },
  };
  assert.equal(trackBaseToken(envTrack, { CPP_V26_BASE: 'base-x' }), 'base-x');
  assert.equal(trackBaseToken(envTrack, {}), null);
  assert.equal(trackReleaseRootToken(envTrack, { CPP_V26_ROOT: 'root-x' }), 'root-x');

  assert.throws(
    () => requireTrack(registry, 'cpp', 'v9.9.x'),
    (error) => error.code === 'TRACK_REGISTRY_TRACK_NOT_REGISTERED',
  );
  assert.throws(
    () => listLanguageTracks(registry, 'rust'),
    (error) => error.code === 'TRACK_REGISTRY_LANGUAGE_NOT_REGISTERED',
  );
});

test('registry validation rejects missing bases, duplicate versions, and bad roots', () => {
  const bad = {
    schemaVersion: 1,
    languages: {
      cpp: {
        tracks: [
          { version: 'v2.6.x', bitable: { baseToken: 'base-a' }, drive: { releaseRoot: { resolution: 'explicit-child', token: null } } },
          { version: 'v2.6.x', bitable: { baseToken: null } },
          { version: 'v3.0.x', bitable: { baseToken: 'base-b' }, drive: { releaseRoot: { resolution: 'somewhere' } } },
        ],
      },
    },
  };
  const validation = validateReleaseTrackRegistry(bad);
  assert.equal(validation.valid, false);
  const codes = validation.errors.map((error) => error.code);
  assert.ok(codes.includes('TRACK_REGISTRY_RELEASE_ROOT_INVALID'));
  assert.ok(codes.includes('TRACK_REGISTRY_VERSION_DUPLICATE'));
  assert.ok(codes.includes('TRACK_REGISTRY_BASE_TOKEN_REQUIRED'));

  assert.equal(validateReleaseTrackRegistry({ schemaVersion: 2 }).valid, false);
  assert.equal(validateReleaseTrackRegistry(null).valid, false);

  const temp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'track-registry-')), 'missing.json');
  assert.throws(
    () => loadReleaseTrackRegistry(temp),
    (error) => error.code === 'TRACK_REGISTRY_UNREADABLE',
  );
});

test('the default registry path points at the committed config file', () => {
  assert.equal(
    DEFAULT_REGISTRY_PATH,
    path.join(__dirname, '..', 'config', 'release-tracks.json'),
  );
  assert.equal(fs.existsSync(DEFAULT_REGISTRY_PATH), true);
});

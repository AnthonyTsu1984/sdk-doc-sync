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

test('rust registry identities match the published sdk-rust.md table', () => {
  const registry = loadReleaseTrackRegistry();
  const rustDoc = fs.readFileSync(
    path.join(__dirname, '..', 'sdk-rust.md'),
    'utf8',
  );
  for (const track of listLanguageTracks(registry, 'rust')) {
    assert.ok(
      rustDoc.includes(trackBaseToken(track)),
      `rust ${track.version} base token must stay in sync with sdk-rust.md`,
    );
    assert.ok(
      rustDoc.includes(trackReleaseRootToken(track)),
      `rust ${track.version} release root must stay in sync with sdk-rust.md`,
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
});

test('the committed registry loads rust dual-track with derived scan-state keys', () => {
  const registry = loadReleaseTrackRegistry();

  const rustTracks = listLanguageTracks(registry, 'rust').map((track) => track.version);
  assert.deepEqual(rustTracks, ['v2.6.x', 'v3.0.x']);

  // Both release roots are explicit children of the RUST container folder
  // (verified via drive/v1/files enumeration 2026-10-08); scan-state keys
  // derive as rust-v26 / rust-v30 with no override pinned.
  const v26 = requireTrack(registry, 'rust', 'v2.6.x');
  assert.equal(v26.scanStateKey ?? 'rust-v26', 'rust-v26');
  assert.equal(trackBaseToken(v26), 'HmCmbiQEcawJzxszPj1cBH7Gnwd');
  assert.equal(trackReleaseRootToken(v26), 'NnYMfAqtJlzJ8zdwpiNcJOuGnF9');
  assert.equal(v26.drive.releaseRoot.resolution, 'explicit-child');
  assert.equal(v26.drive.configuredRootToken, 'PeN4ftfCglBs4AdS8CTcjtdOnPJ');

  const v30 = requireTrack(registry, 'rust', 'v3.0.x');
  assert.equal(v30.scanStateKey ?? 'rust-v30', 'rust-v30');
  assert.equal(trackBaseToken(v30), 'ONBTbsAdha3UNvsfnG5cEISvnBZ');
  assert.equal(trackReleaseRootToken(v30), 'XiM3fDXSBldV2IdN0r9cXCe6nqw');
  assert.equal(v30.drive.releaseRoot.resolution, 'explicit-child');

  assert.throws(
    () => requireTrack(registry, 'rust', 'v9.9.x'),
    (error) => error.code === 'TRACK_REGISTRY_TRACK_NOT_REGISTERED',
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

test('scanStateKey overrides are typed, unique, and pin the real durable keys', () => {
  // The committed registry's six overrides point at keys scan-state.json
  // actually owns (bare-major / language-only forms) and collide with nothing.
  const registry = loadReleaseTrackRegistry();
  assert.deepEqual(validateReleaseTrackRegistry(registry), { valid: true, errors: [] });
  const overrides = [];
  for (const [language, entry] of Object.entries(registry.languages)) {
    entry.tracks.forEach((track) => {
      if (track.scanStateKey) overrides.push(`${language} ${track.version} → ${track.scanStateKey}`);
    });
  }
  assert.deepEqual(overrides.sort(), [
    'go v2.6.x → go',
    'go v3.0.x → go-v3',
    'node v2.6.x → node-v26',
    'node v3.0.x → node',
    'python v2.6.x → python',
    'python v3.0.x → python-v3',
  ]);

  // Same effective key twice (explicit × explicit, cross-language included —
  // the dashboard keys counts globally) fails closed instead of silently
  // dropping one track's campaigns.
  const dup = {
    schemaVersion: 1,
    languages: {
      go: {
        tracks: [
          { version: 'v2.6.x', scanStateKey: 'go', bitable: { baseToken: 'base-a' } },
          { version: 'v3.0.x', scanStateKey: 'go', bitable: { baseToken: 'base-b' } },
        ],
      },
    },
  };
  const dupValidation = validateReleaseTrackRegistry(dup);
  assert.equal(dupValidation.valid, false);
  const duplicate = dupValidation.errors.find((error) => error.code === 'TRACK_REGISTRY_SCANSTATEKEY_DUPLICATE');
  assert.ok(duplicate, 'duplicate effective key rejected');
  assert.equal(duplicate.details.key, 'go');
  assert.equal(duplicate.details.firstSeen, '$.languages.go.tracks[0]');

  // An explicit override can also shadow another track's derived key.
  const shadow = {
    schemaVersion: 1,
    languages: {
      cpp: { tracks: [{ version: 'v3.0.x', scanStateKey: 'java-v30', bitable: { baseToken: 'base-a' } }] },
      java: { tracks: [{ version: 'v3.0.x', bitable: { baseToken: 'base-b' } }] },
    },
  };
  const shadowValidation = validateReleaseTrackRegistry(shadow);
  assert.ok(shadowValidation.errors.some((error) => error.code === 'TRACK_REGISTRY_SCANSTATEKEY_DUPLICATE'));

  // Empty/non-string overrides are invalid, not silently ignored.
  const badType = {
    schemaVersion: 1,
    languages: {
      go: {
        tracks: [
          { version: 'v2.6.x', scanStateKey: '', bitable: { baseToken: 'base-a' } },
          { version: 'v3.0.x', scanStateKey: 3, bitable: { baseToken: 'base-b' } },
        ],
      },
    },
  };
  const typeValidation = validateReleaseTrackRegistry(badType);
  assert.equal(typeValidation.errors.filter((error) => error.code === 'TRACK_REGISTRY_SCANSTATEKEY_INVALID').length, 2);
});

test('the default registry path points at the committed config file', () => {
  assert.equal(
    DEFAULT_REGISTRY_PATH,
    path.join(__dirname, '..', 'config', 'release-tracks.json'),
  );
  assert.equal(fs.existsSync(DEFAULT_REGISTRY_PATH), true);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {prepareFragmentCollection, writeFragmentCollection} = require('../src/rest-fragments/fragment-producer');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const REVIEW_DIGEST = `sha256:${'1'.repeat(64)}`;
const APPROVAL_DIGEST = `sha256:${'2'.repeat(64)}`;
const CONFIG_DIGEST = `sha256:${'3'.repeat(64)}`;

function input(overrides = {}) {
  return {
    apiSurface: 'data-plane',
    releaseTrack: '2.6.x',
    serviceId: 'milvus-rest',
    spec: {
      openapi: '3.0.3',
      info: {title: 'Milvus REST', version: 'v2'},
      paths: {'/v2/vectordb/entities/search': {post: {operationId: 'searchEntities', responses: {200: {description: 'ok'}}}}},
    },
    source: {repository: 'milvus-io/milvus', revision: SHA_A},
    generator: {repository: 'feishu-markdown-bridge', revision: SHA_B, configDigest: CONFIG_DIGEST},
    reviewManifest: {
      manifestDigest: REVIEW_DIGEST,
      tracks: ['2.6.x'],
      units: [{sourceEvidence: {revision: SHA_A}}],
    },
    reviewManifestDigest: REVIEW_DIGEST,
    approvalDigest: APPROVAL_DIGEST,
    ...overrides,
  };
}

test('prepares byte-identical canonical data-plane collections', () => {
  const first = prepareFragmentCollection(input());
  const second = prepareFragmentCollection(input());
  assert.deepEqual(first, second);
  assert.equal(first.manifest.apiSurface, 'data-plane');
  assert.equal(first.manifest.releaseTrack, '2.6.x');
  assert.equal(first.manifest.services[0].operationCount, 1);
  const fragment = JSON.parse(first.files[0].bytes.toString('utf8'));
  assert.deepEqual(fragment['x-zdoc-fragment'], {schemaVersion: '1.0', apiSurface: 'data-plane', service: 'milvus-rest'});
});

test('rejects review source, track, and digest mismatches', () => {
  assert.throws(() => prepareFragmentCollection(input({source: {repository: 'milvus', revision: 'c'.repeat(40)}})), /REST_REVIEW_SOURCE_MISMATCH/);
  assert.throws(() => prepareFragmentCollection(input({releaseTrack: '3.0.x'})), /REST_REVIEW_TRACK_MISMATCH/);
  assert.throws(() => prepareFragmentCollection(input({reviewManifestDigest: `sha256:${'4'.repeat(64)}`})), /REST_REVIEW_DIGEST_MISMATCH/);
});

test('writes a collection atomically and refuses overwrite', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rest-fragment-producer-'));
  const output = path.join(root, 'collection');
  const prepared = prepareFragmentCollection(input());
  const written = writeFragmentCollection(output, prepared);
  assert.deepEqual(written.map(file => file.filename), ['milvus-rest.openapi.json', 'collection-manifest.json']);
  assert.throws(() => writeFragmentCollection(output, prepared), /REST_OUTPUT_EXISTS/);
  fs.rmSync(root, {recursive: true, force: true});
});

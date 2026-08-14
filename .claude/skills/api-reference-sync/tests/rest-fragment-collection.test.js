'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {buildCollectionManifest, sha256Digest} = require('../src/rest-fragments/collection-manifest');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const DIGEST_A = `sha256:${'1'.repeat(64)}`;
const DIGEST_B = `sha256:${'2'.repeat(64)}`;

function options(overrides = {}) {
  return {
    apiSurface: 'data-plane',
    releaseTrack: '2.6.x',
    source: {repository: 'milvus-io/milvus', revision: SHA_A},
    generator: {repository: 'feishu-markdown-bridge', revision: SHA_B, configDigest: DIGEST_A},
    review: {manifestDigest: DIGEST_A, approvalDigest: DIGEST_B},
    services: [{id: 'milvus-rest', fragment: 'milvus-rest.openapi.json', sha256: DIGEST_A, operationCount: 1}],
    ...overrides,
  };
}

test('builds deterministic collection identity and sorted services', () => {
  const first = buildCollectionManifest(options({services: [
    {id: 'zeta', fragment: 'zeta.openapi.json', sha256: DIGEST_A, operationCount: 1},
    {id: 'alpha', fragment: 'alpha.openapi.json', sha256: DIGEST_B, operationCount: 2},
  ]}));
  const second = buildCollectionManifest(options({services: [...first.services].reverse()}));
  assert.deepEqual(first, second);
  assert.deepEqual(first.services.map(service => service.id), ['alpha', 'zeta']);
  assert.match(first.collectionId, /^data-plane-[a-f0-9]{16}$/);
});

test('rejects abbreviated revisions, invalid digests, and duplicate services', () => {
  assert.throws(() => buildCollectionManifest(options({source: {repository: 'milvus', revision: 'abc123'}})), /REST_SOURCE_REVISION_INVALID/);
  assert.throws(() => buildCollectionManifest(options({review: {manifestDigest: 'abc', approvalDigest: DIGEST_B}})), /REST_DIGEST_INVALID/);
  assert.throws(() => buildCollectionManifest(options({services: [options().services[0], options().services[0]]})), /REST_SERVICE_DUPLICATE/);
});

test('control plane rejects release tracks', () => {
  assert.throws(() => buildCollectionManifest(options({apiSurface: 'control-plane'})), /REST_CONTROL_PLANE_REJECTS_TRACK/);
});

test('sha256 digests use the shared prefixed format', () => {
  assert.match(sha256Digest(Buffer.from('fragment')), /^sha256:[a-f0-9]{64}$/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { digestSemantic } = require('../src/digest');
const { createLineageArtifact, assertParentDigest } = require('../src/artifact-lineage');

test('semantic digests are stable SHA-256 values', () => {
  assert.match(digestSemantic({ b: 2, a: 1 }), /^sha256:[a-f0-9]{64}$/);
  assert.equal(digestSemantic({ b: 2, a: 1 }), digestSemantic({ a: 1, b: 2 }));
});

test('lineage artifacts are immutable and retain their exact parent digest', () => {
  const parent = digestSemantic({ scope: 'release' });
  const artifact = createLineageArtifact({ kind: 'candidate', parentDigest: parent, payload: { id: 'a' } });
  assert.equal(artifact.parentDigest, parent);
  assert.equal(Object.isFrozen(artifact), true);
  assert.equal(Object.isFrozen(artifact.payload), true);
  assert.doesNotThrow(() => assertParentDigest(artifact, parent));
  assert.throws(() => assertParentDigest(artifact, digestSemantic({ scope: 'other' })), /PARENT_DIGEST_MISMATCH/);
});

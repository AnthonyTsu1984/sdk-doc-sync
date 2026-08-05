'use strict';

const { canonicalize } = require('./canonical-json');
const { digestSemantic } = require('./digest');

class ArtifactLineageError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = 'ArtifactLineageError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function createLineageArtifact({ kind, parentDigest = null, payload }) {
  if (typeof kind !== 'string' || !kind) {
    throw new ArtifactLineageError('ARTIFACT_KIND_REQUIRED', 'kind must be a non-empty string');
  }
  if (parentDigest !== null && !/^sha256:[a-f0-9]{64}$/.test(parentDigest)) {
    throw new ArtifactLineageError('PARENT_DIGEST_INVALID', 'parentDigest must be a SHA-256 digest');
  }
  const semantic = canonicalize({ schemaVersion: 1, kind, parentDigest, payload });
  return deepFreeze({ ...semantic, semanticDigest: digestSemantic(semantic) });
}

function assertParentDigest(artifact, expectedParentDigest) {
  if (artifact?.parentDigest !== expectedParentDigest) {
    throw new ArtifactLineageError('PARENT_DIGEST_MISMATCH', 'artifact parent digest does not match', {
      expected: expectedParentDigest,
      actual: artifact?.parentDigest ?? null,
    });
  }
  return true;
}

module.exports = { ArtifactLineageError, createLineageArtifact, assertParentDigest, deepFreeze };

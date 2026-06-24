const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const samplePath = path.join(__dirname, 'fixtures/reference-index.sample.json');
const { loadReferenceIndex, buildMatrix } = require('../src/reference-scan');
const { buildCandidates, assertIdempotentCandidates, assertNoDuplicateCandidates } = require('../src/diff-plan');

test('buildMatrix returns per-operation per-language status map', () => {
  const reference = loadReferenceIndex(samplePath);
  const matrix = buildMatrix(reference, {
    languages: ['python', 'java', 'go', 'node', 'rest'],
  });

  assert.deepEqual(matrix, {
    'collections/create_collection': {
      python: 'supported',
      java: 'missing',
      go: 'unclear',
      node: 'unclear',
      rest: 'unclear',
    },
    'collections/drop_collection': {
      python: 'supported',
      java: 'unclear',
      go: 'unclear',
      node: 'supported',
      rest: 'missing',
    },
  });
});

test('buildCandidates includes only supported entries', () => {
  const reference = loadReferenceIndex(samplePath);
  const matrix = buildMatrix(reference, {
    languages: ['python', 'java', 'go', 'node', 'rest'],
  });

  const candidates = buildCandidates(matrix);

  assert.deepEqual(candidates, [
    { operationKey: 'collections/create_collection', language: 'python' },
    { operationKey: 'collections/drop_collection', language: 'node' },
    { operationKey: 'collections/drop_collection', language: 'python' },
  ]);
});

test('assertIdempotentCandidates throws for duplicate operation+language', () => {
  assert.throws(
    () => assertIdempotentCandidates([
      { operationKey: 'collections/create_collection', language: 'python' },
      { operationKey: 'collections/create_collection', language: 'python' },
    ]),
    /Duplicate candidate detected: collections\/create_collection\|python/
  );
});

test('assertNoDuplicateCandidates remains as backwards-compatible alias', () => {
  assert.throws(
    () => assertNoDuplicateCandidates([
      { operationKey: 'collections/drop_collection', language: 'node' },
      { operationKey: 'collections/drop_collection', language: 'node' },
    ]),
    /Duplicate candidate detected: collections\/drop_collection\|node/
  );
});

test('buildMatrix throws for duplicate operation+language rows', () => {
  const reference = {
    entries: [
      { operationKey: 'collections/create_collection', language: 'python', status: 'supported' },
      { operationKey: 'collections/create_collection', language: 'python', status: 'missing' },
    ],
  };

  assert.throws(
    () => buildMatrix(reference, { languages: ['python'] }),
    /Duplicate reference entry detected: collections\/create_collection\|python/
  );
});

test('loadReferenceIndex normalizes invalid statuses to unclear before buildMatrix', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-code-blocks-'));
  const tmpPath = path.join(tmpDir, 'reference-index.invalid-status.json');
  fs.writeFileSync(tmpPath, JSON.stringify({
    entries: [
      { operationKey: 'collections/create_collection', language: 'python', status: 'SUPPORTED' },
      { operationKey: 'collections/create_collection', language: 'java', status: 'not-a-real-status' },
    ],
  }), 'utf8');

  const reference = loadReferenceIndex(tmpPath);
  const matrix = buildMatrix(reference, { languages: ['python', 'java'] });

  assert.deepEqual(matrix, {
    'collections/create_collection': {
      python: 'supported',
      java: 'unclear',
    },
  });
});

test('loadReferenceIndex wraps parse/read errors with file path context', () => {
  const missingPath = '/tmp/patch-code-blocks-definitely-missing-reference-index.json';

  assert.throws(
    () => loadReferenceIndex(missingPath),
    /Failed to load reference index at \/tmp\/patch-code-blocks-definitely-missing-reference-index\.json/
  );
});

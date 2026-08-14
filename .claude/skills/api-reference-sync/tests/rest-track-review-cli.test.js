const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const bin = path.join(__dirname, '..', 'bin', 'rest-track-review.js');
const fixtureDir = path.join(__dirname, 'fixtures', 'rest-track');
const fixture26 = path.join(fixtureDir, '2.6.x.json');
const fixture30 = path.join(fixtureDir, '3.0.x.json');

function run(args, options = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: 'utf8',
    ...options,
  });
}

function baseArgs(outputPath) {
  return [
    '--track-spec', `2.6.x=${fixture26}`,
    '--track-spec', `3.0.x=${fixture30}`,
    '--source-revision', '2.6.x=milvus-io/milvus@v2.6.22',
    '--source-revision', '3.0.x=milvus-io/milvus@v3.0.0',
    '--managed-floor', '2.6.x',
    '--output', outputPath,
    '--json',
  ];
}

test('REST track review CLI writes deterministic JSON and a full digest', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rest-track-review-'));
  const outputPath = path.join(directory, 'manifest.json');
  const before26 = fs.readFileSync(fixture26, 'utf8');
  const before30 = fs.readFileSync(fixture30, 'utf8');

  const result = run(baseArgs(outputPath));

  assert.equal(result.status, 0, result.stderr);
  const stdout = JSON.parse(result.stdout);
  const file = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.deepEqual(stdout, file);
  assert.match(file.manifestDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(fs.readFileSync(fixture26, 'utf8'), before26);
  assert.equal(fs.readFileSync(fixture30, 'utf8'), before30);
});

test('CLI rejects duplicate track specs with exit 64', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rest-track-review-duplicate-'));
  const result = run([
    '--track-spec', `2.6.x=${fixture26}`,
    '--track-spec', `2.6.x=${fixture26}`,
    '--source-revision', '2.6.x=milvus-io/milvus@v2.6.22',
    '--managed-floor', '2.6.x',
    '--output', path.join(directory, 'manifest.json'),
    '--json',
  ]);

  assert.equal(result.status, 64);
});

test('CLI rejects missing source revisions with exit 64', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rest-track-review-source-'));
  const result = run([
    '--track-spec', `2.6.x=${fixture26}`,
    '--track-spec', `3.0.x=${fixture30}`,
    '--source-revision', '2.6.x=milvus-io/milvus@v2.6.22',
    '--managed-floor', '2.6.x',
    '--output', path.join(directory, 'manifest.json'),
    '--json',
  ]);

  assert.equal(result.status, 64);
});

test('CLI rejects patch-form tracks with exit 64', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rest-track-review-patch-'));
  const result = run([
    '--track-spec', `2.6.22=${fixture26}`,
    '--source-revision', '2.6.x=milvus-io/milvus@v2.6.22',
    '--managed-floor', '2.6.x',
    '--output', path.join(directory, 'manifest.json'),
    '--json',
  ]);

  assert.equal(result.status, 64);
});

test('CLI rejects missing output path with exit 64', () => {
  const result = run([
    '--track-spec', `2.6.x=${fixture26}`,
    '--source-revision', '2.6.x=milvus-io/milvus@v2.6.22',
    '--managed-floor', '2.6.x',
    '--json',
  ]);

  assert.equal(result.status, 64);
});

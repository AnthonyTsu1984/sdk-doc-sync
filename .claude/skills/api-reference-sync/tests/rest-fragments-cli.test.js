'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const bin = path.join(__dirname, '..', 'bin', 'rest-fragments.js');
const fixture = path.join(__dirname, 'fixtures', 'rest-track', '2.6.x.json');
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const REVIEW_DIGEST = `sha256:${'1'.repeat(64)}`;
const APPROVAL_DIGEST = `sha256:${'2'.repeat(64)}`;
const CONFIG_DIGEST = `sha256:${'3'.repeat(64)}`;

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rest-fragments-cli-'));
  const review = path.join(root, 'review.json');
  fs.writeFileSync(review, `${JSON.stringify({
    manifestDigest: REVIEW_DIGEST,
    tracks: ['2.6.x'],
    units: [{sourceEvidence: {revision: SHA_A}}],
  }, null, 2)}\n`);
  return {root, review, output: path.join(root, 'output')};
}

function args(paths) {
  return [
    'produce-data-plane', '--spec', fixture, '--service-id', 'milvus-rest',
    '--source-repository', 'milvus-io/milvus', '--source-revision', SHA_A,
    '--generator-repository', 'feishu-markdown-bridge', '--generator-revision', SHA_B,
    '--config-digest', CONFIG_DIGEST, '--review-manifest', paths.review,
    '--approval-digest', APPROVAL_DIGEST, '--release-track', '2.6.x', '--output', paths.output,
  ];
}

test('CLI writes a manifest-backed data-plane collection', () => {
  const paths = setup();
  const result = spawnSync(process.execPath, [bin, ...args(paths)], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(paths.output, 'collection-manifest.json')), true);
  assert.equal(fs.existsSync(path.join(paths.output, 'milvus-rest.openapi.json')), true);
  fs.rmSync(paths.root, {recursive: true, force: true});
});

test('CLI rejects abbreviated source revisions', () => {
  const paths = setup();
  const invalid = args(paths);
  invalid[invalid.indexOf('--source-revision') + 1] = 'abc123';
  const result = spawnSync(process.execPath, [bin, ...invalid], {encoding: 'utf8'});
  assert.equal(result.status, 64);
  assert.match(result.stderr, /REST_SOURCE_REVISION_INVALID/);
  fs.rmSync(paths.root, {recursive: true, force: true});
});

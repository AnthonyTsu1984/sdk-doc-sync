'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { runReleaseScout } = require('../src/sdk-doc-sync/release-scope/release-scout');
const { runCli } = require('../bin/sdk-release-scout');

const fixtureDir = path.join(__dirname, 'fixtures', 'release-scope');

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
}

function writeText(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function git(repo, args) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

test('runReleaseScout emits the bounded Python v2.6 release artifact', async () => {
  const scope = await runReleaseScout({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    scanState: { python: { lastScannedTag: 'v2.6.12' } },
    targetTag: 'v2.6.17',
    publicRoots: ['pymilvus/'],
    identityMapPath: path.join(__dirname, '..', 'references', 'identity', 'python-v26.json'),
    baselineSymbols: fixture('python-v26-scanned-baseline.json'),
    targetSymbols: fixture('python-v26-scanned-target.json'),
    runGit(args) {
      const key = args.join(' ');
      return {
        'rev-list -n 1 v2.6.17': '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4\n',
        'show -s --format=%cI v2.6.17': '2026-07-15T16:32:32+08:00\n',
        'diff --name-only v2.6.12..v2.6.17': 'pymilvus/client/field_ops.py\npymilvus/milvus_client/milvus_client.py\n',
      }[key];
    },
  });

  assert.equal(scope.approvalGrade, true);
  assert.equal(scope.writesPerformed, false);
  assert.equal(scope.scanStateUpdated, false);
  assert.deepEqual(scope.actions.map((action) => [action.type, action.stableId]), [
    ['UPDATE', 'python:Management:compact'],
    ['CREATE', 'python:Vector:FieldOp'],
  ]);
});

test('runReleaseScout scans baseline and target tag snapshots without injected symbols', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-release-scout-git-'));
  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'sdk-release-scout@example.test']);
  git(repo, ['config', 'user.name', 'SDK Release Scout']);
  writeText(path.join(repo, 'pymilvus', 'milvus_client', 'milvus_client.py'), `
class MilvusClient:
    def compact(self, collection_name: str, timeout: float = None) -> int:
        return 1
`);
  git(repo, ['add', '.']);
  git(repo, [
    'update-index',
    '--add',
    '--cacheinfo',
    '160000',
    '882e58722273dc27b37b11a20de5b4592fe02da9',
    'pymilvus/grpc_gen/milvus-proto',
  ]);
  git(repo, ['commit', '-m', 'baseline']);
  git(repo, ['tag', 'v2.6.12']);
  writeText(path.join(repo, 'pymilvus', 'milvus_client', 'milvus_client.py'), `
class MilvusClient:
    def compact(self, collection_name: str, target_size: int = None, timeout: float = None) -> int:
        return 1
`);
  writeText(path.join(repo, 'pymilvus', 'client', 'field_ops.py'), `
class FieldOp:
    pass
`);
  git(repo, ['add', '.']);
  git(repo, [
    'update-index',
    '--add',
    '--cacheinfo',
    '160000',
    '882e58722273dc27b37b11a20de5b4592fe02da9',
    'pymilvus/grpc_gen/milvus-proto',
  ]);
  git(repo, ['commit', '-m', 'target']);
  git(repo, ['tag', 'v2.6.17']);

  const scope = await runReleaseScout({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    scanState: { python: { lastScannedTag: 'v2.6.12' } },
    targetTag: 'v2.6.17',
    repoDir: repo,
    sdkDir: path.join(repo, 'pymilvus'),
    publicRoots: ['pymilvus/'],
    identityMapPath: path.join(__dirname, '..', 'references', 'identity', 'python-v26.json'),
  });

  assert.deepEqual(scope.changedFiles, [
    'pymilvus/client/field_ops.py',
    'pymilvus/milvus_client/milvus_client.py',
  ]);
  assert.deepEqual(scope.actions.map((action) => [action.type, action.stableId]), [
    ['UPDATE', 'python:Management:compact'],
    ['CREATE', 'python:Vector:FieldOp'],
  ]);
});

test('sdk-release-scout CLI writes JSON and does not print raw scanner dumps', async () => {
  const stdout = [];
  const stderr = [];
  const writes = [];
  const result = await runCli({
    argv: [
      'node',
      'sdk-release-scout',
      '--language',
      'python',
      '--sdk-name',
      'pymilvus',
      '--track',
      'v2.6.x',
      '--target-tag',
      'v2.6.17',
      '--json',
      '--output',
      '/tmp/python-v26-release-scope.json',
    ],
    dependencies: {
      loadScanState() { return { python: { lastScannedTag: 'v2.6.12' } }; },
      runReleaseScout: async () => ({
        schemaVersion: 1,
        language: 'python',
        sdkName: 'pymilvus',
        track: 'v2.6.x',
        baselineTag: 'v2.6.12',
        targetTag: 'v2.6.17',
        targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
        targetDate: '2026-07-15T08:32:32.000Z',
        releaseRange: 'v2.6.12..v2.6.17',
        approvalGrade: true,
        changedFiles: [],
        actions: [],
        scannerDiagnostics: [],
        writesPerformed: false,
        scanStateUpdated: false,
      }),
      writeFile(file, content) { writes.push([file, JSON.parse(content)]); },
      onStdout(line) { stdout.push(line); },
      onStderr(line) { stderr.push(line); },
    },
  });

  assert.equal(result.targetTag, 'v2.6.17');
  assert.deepEqual(stderr, []);
  assert.equal(writes[0][0], '/tmp/python-v26-release-scope.json');
  assert.match(stdout.join('\n'), /"approvalGrade": true/);
  assert.doesNotMatch(stdout.join('\n'), /"scanned": \[/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createReleaseImpact,
  collectReleaseImpact,
  extractReleaseImpactsFromBody,
  tagsInRange,
} = require('../src/sdk-doc-sync/release-scope/zilliz-cli-release-impact');
const {
  auditHandwrittenCommands,
} = require('../src/sdk-doc-sync/scanners/zilliz-cli-handwritten-audit');
const { runCli: runImpactCli } = require('../bin/zilliz-cli-release-impact');
const { runCli: runAuditCli } = require('../bin/zilliz-cli-handwritten-audit');

function writeText(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

test('release impact parser extracts commands, flags, renames, and validation requirement', () => {
  const impacts = extractReleaseImpactsFromBody({
    tag: 'zilliz-v1.4.5',
    body: [
      '- Added `zilliz cluster create --replica --autoscaling-cu-min --autoscaling-cu-max` for dynamic CU.',
      '- Renamed `query-cluster list` to `on-demand-cluster list`.',
      '- Deprecated `zilliz completion install` because completion is automatic.',
    ].join('\n'),
  });

  assert.deepEqual(impacts.map((impact) => [impact.type, impact.command, impact.flags]), [
    ['CREATE', 'cluster create', ['--autoscaling-cu-max', '--autoscaling-cu-min', '--replica']],
    ['UPDATE', 'query-cluster list', []],
    ['UPDATE', 'on-demand-cluster list', []],
    ['DEPRECATE', 'completion install', []],
  ]);
  assert.deepEqual(impacts[1].rename, { from: 'query-cluster list', to: 'on-demand-cluster list' });
  assert.equal(impacts.every((impact) => impact.sourceValidation === 'required'), true);
});

test('release impact artifact separates packaging-only public diff from doc impacts', () => {
  const impact = createReleaseImpact({
    baselineTag: 'zilliz-v1.4.4',
    targetTag: 'zilliz-v1.4.5',
    releaseBodies: {
      'zilliz-v1.4.5': '- Added `zilliz stage list` compatibility note.\n',
    },
    diff: [
      { status: 'M', path: 'README.md' },
      { status: 'M', path: 'install.sh' },
    ],
  });

  assert.equal(impact.needsSourceValidation, true);
  assert.equal(impact.candidateDocImpacts.length, 1);
  assert.deepEqual(impact.diagnostics.map((diagnostic) => diagnostic.code), [
    'PACKAGING_ONLY_PUBLIC_DIFF',
    'RELEASE_NOTES_DOC_IMPACT',
    'SOURCE_VALIDATION_REQUIRED',
  ]);
});

test('collectReleaseImpact reads tag bodies from a fixture directory', () => {
  const bodyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zilliz-release-bodies-'));
  writeText(path.join(bodyDir, 'zilliz-v1.4.5.md'), '- Added `zilliz cluster create --replica`.\n');

  const impact = collectReleaseImpact({
    repoDir: '/repo/zilliz-cli',
    baselineTag: 'zilliz-v1.4.4',
    targetTag: 'zilliz-v1.4.5',
    bodyDir,
    run(command, args) {
      const key = `${command} ${args.join(' ')}`;
      return {
        'git tag --list zilliz-v*': 'zilliz-v1.4.4\nzilliz-v1.4.5\n',
        'git diff --name-status zilliz-v1.4.4..zilliz-v1.4.5': 'M\tREADME.md\n',
      }[key];
    },
  });

  assert.deepEqual(impact.releaseTags, ['zilliz-v1.4.5']);
  assert.equal(impact.candidateDocImpacts[0].command, 'cluster create');
});

test('tagsInRange sorts semver tags and excludes the baseline', () => {
  assert.deepEqual(tagsInRange({
    baselineTag: 'zilliz-v1.4.2',
    targetTag: 'zilliz-v1.4.10',
    tags: ['zilliz-v1.4.10', 'zilliz-v1.4.2', 'zilliz-v1.4.3', 'other'],
  }), ['zilliz-v1.4.3', 'zilliz-v1.4.10']);
});

test('handwritten command audit reports missing and stale scanner flags', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'zilliz-handwritten-audit-'));
  writeText(path.join(repo, 'src', 'cli', 'help.rs'), `
const HAND_WRITTEN_OPS: &[(&str, &str, &str)] = &[
    ("cluster", "create", "Create a cluster"),
];
`);
  writeText(path.join(repo, 'src', 'cli', 'cluster.rs'), `
println!("--name --replica --autoscaling-cu-min");
`);

  const audit = auditHandwrittenCommands({
    rootDir: repo,
    metadata: {
      'cluster-create': [
        { name: '--name' },
        { name: '--stale' },
      ],
    },
  });

  assert.equal(audit.ok, false);
  assert.deepEqual(audit.diagnostics.map((diagnostic) => diagnostic.code), [
    'HANDWRITTEN_FLAG_MISSING',
    'HANDWRITTEN_FLAG_MISSING',
    'HANDWRITTEN_FLAG_STALE',
  ]);
});

test('release impact CLI writes JSON through injected dependencies', () => {
  let output = '';
  const scope = runImpactCli({
    argv: [
      'node',
      'zilliz-cli-release-impact',
      '--baseline-tag',
      'zilliz-v1.4.4',
      '--target-tag',
      'zilliz-v1.4.5',
      '--repo-dir',
      '/repo/zilliz-cli',
      '--json',
    ],
    dependencies: {
      onStdout(line) { output = line; },
      run(command, args) {
        const key = `${command} ${args.join(' ')}`;
        return {
          'git tag --list zilliz-v*': 'zilliz-v1.4.5\n',
          'git diff --name-status zilliz-v1.4.4..zilliz-v1.4.5': 'M\tREADME.md\n',
          'gh release view zilliz-v1.4.5 -R zilliztech/zilliz-cli --json body --jq .body': '- Added `zilliz cluster create --replica`.\n',
        }[key];
      },
    },
  });

  assert.equal(scope.candidateDocImpacts.length, 1);
  assert.equal(JSON.parse(output).kind, 'zilliz-cli-release-impact');
});

test('handwritten audit CLI returns audit JSON', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'zilliz-handwritten-audit-cli-'));
  writeText(path.join(repo, 'src', 'cli', 'help.rs'), `
const HAND_WRITTEN_OPS: &[(&str, &str, &str)] = &[
];
`);
  let output = '';
  const audit = runAuditCli({
    argv: ['node', 'zilliz-cli-handwritten-audit', '--sdk-dir', repo, '--json'],
    dependencies: {
      onStdout(line) { output = line; },
    },
  });

  assert.equal(audit.kind, 'zilliz-cli-handwritten-audit');
  assert.equal(JSON.parse(output).kind, 'zilliz-cli-handwritten-audit');
});

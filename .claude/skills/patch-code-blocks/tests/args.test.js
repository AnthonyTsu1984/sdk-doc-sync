const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs } = require('../src/args');

const TARGET = 'https://zilliverse.feishu.cn/wiki/abc';

test('rejects missing --target', () => {
  assert.throws(() => parseArgs([]), /Missing required --target/);
});

test('rejects unknown flag', () => {
  assert.throws(
    () => parseArgs(['--target', TARGET, '--release', 'v2.6.x', '--wat']),
    /Unknown argument: --wat/
  );
});

test('rejects unexpected positional args', () => {
  assert.throws(
    () => parseArgs(['--target', TARGET, '--release', 'v2.6.x', 'extra']),
    /Unexpected positional argument: extra/
  );
});

test('rejects missing value for flag', () => {
  assert.throws(
    () => parseArgs(['--target', TARGET, '--release']),
    /Missing value for --release/
  );
});

test('rejects invalid --product', () => {
  assert.throws(
    () => parseArgs(['--target', TARGET, '--product', 'cloud', '--release', 'v2.6.x']),
    /Invalid --product: cloud/
  );
});

test('requires --release for milvus', () => {
  assert.throws(
    () => parseArgs(['--target', TARGET, '--product', 'milvus']),
    /--release is required when --product=milvus/
  );
});

test('rejects invalid --languages token', () => {
  assert.throws(
    () => parseArgs(['--target', TARGET, '--product', 'zilliz-saas', '--languages', 'python,ruby']),
    /Invalid language: ruby/
  );
});

test('rejects invalid --language-order token', () => {
  assert.throws(
    () => parseArgs([
      '--target', TARGET,
      '--product', 'zilliz-saas',
      '--languages', 'python,rest,cli',
      '--language-order', 'python,ruby'
    ]),
    /Invalid language-order value: ruby/
  );
});

test('rejects language-order values not present in --languages', () => {
  assert.throws(
    () => parseArgs([
      '--target', TARGET,
      '--product', 'zilliz-saas',
      '--languages', 'python,rest',
      '--language-order', 'python,cli'
    ]),
    /language-order value must also be present in --languages: cli/
  );
});

test('rejects invalid --apply value', () => {
  assert.throws(
    () => parseArgs(['--target', TARGET, '--release', 'v2.6.x', '--apply', 'yes']),
    /Invalid boolean value: yes/
  );
});

test('normalizes rest aliases', () => {
  const cfg = parseArgs([
    '--target', TARGET,
    '--product', 'zilliz-saas',
    '--languages', 'python,restful,cli'
  ]);
  assert.deepEqual(cfg.languages, ['python', 'rest', 'cli']);
});

test('parses happy-path config', () => {
  const cfg = parseArgs([
    '--target', TARGET,
    '--product', 'zilliz-paas',
    '--reference', '/tmp/reference',
    '--languages', 'python,restful-api,cli',
    '--language-order', 'cli,python',
    '--apply', 'true'
  ]);

  assert.deepEqual(cfg, {
    target: TARGET,
    product: 'zilliz-paas',
    release: null,
    reference: '/tmp/reference',
    languages: ['python', 'rest', 'cli'],
    languageOrder: ['cli', 'python'],
    apply: true,
  });
});

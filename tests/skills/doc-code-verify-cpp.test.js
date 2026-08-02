'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const VERIFIER = path.join(
  REPO_ROOT,
  '.claude',
  'skills',
  'doc-code-verify',
  'scripts',
  'verify-feishu-doc-code.js',
);

function cppCompilerAvailable() {
  return ['clang++', 'g++'].some(command => spawnSync(command, ['--version'], {
    encoding: 'utf8',
  }).status === 0);
}

test('doc-code-verify compiles a C++ translation unit without nesting it in a fragment main', {
  skip: cppCompilerAvailable() ? false : 'no C++ compiler is available',
}, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-code-verify-cpp-'));
  const markdownPath = path.join(tmp, 'translation-unit.md');
  const reportPath = path.join(tmp, 'report.json');
  fs.writeFileSync(markdownPath, [
    '```cpp',
    '#include <vector>',
    '',
    'int size() {',
    '    std::vector<int> values{1, 2, 3};',
    '    return static_cast<int>(values.size());',
    '}',
    '```',
    '',
  ].join('\n'));

  const result = spawnSync(process.execPath, [
    VERIFIER,
    '--markdown', markdownPath,
    '--report', reportPath,
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(report.contract.status, 'VERIFIED');
  assert.equal(report.results[0].verification.status, 'passed');
  assert.match(report.results[0].verification.result.command, /-fsyntax-only/);
});

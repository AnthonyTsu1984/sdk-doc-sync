'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

test('doc-code-verify emits the shared deterministic result contract', () => {
  const reportPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'doc-code-verify-')), 'report.json');
  const script = path.join(REPO_ROOT, '.claude', 'skills', 'doc-code-verify', 'scripts', 'verify-feishu-doc-code.js');
  const result = spawnSync(process.execPath, [script, '--self-test', '--report', reportPath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal([0, 2].includes(result.status), true, result.stderr || result.stdout);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(report.contract.schemaVersion, 1);
  assert.equal(report.contract.skill, 'doc-code-verify');
  assert.equal(report.contract.operation, 'verify');
  assert.match(report.contract.semanticDigest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual([...report.contract.diagnostics].sort((a, b) => a.code.localeCompare(b.code) || String(a.target).localeCompare(String(b.target))), report.contract.diagnostics);
  assert.equal(report.contract.exitCode, result.status);
  assert.equal(report.summary.generatedAt, report.contract.runtime.generatedAt);
});

test('doc-code-verify normalizes --languages aliases through the shared parser', () => {
  const reportPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'doc-code-verify-language-')), 'report.json');
  const script = path.join(REPO_ROOT, '.claude', 'skills', 'doc-code-verify', 'scripts', 'verify-feishu-doc-code.js');
  const result = spawnSync(process.execPath, [
    script,
    '--self-test',
    '--languages', 'py',
    '--report', reportPath,
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(report.summary.filteredSnippets, 1);
  assert.equal(report.results[0].language, 'python');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'verify-feishu-doc-code.js');

test('mutating live CLI writes an exact manifest and stops before runtime without digest approval', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'verifier-live-gate-'));
  const markdownPath = path.join(directory, 'live.md');
  const manifestPath = path.join(directory, 'runtime-manifest.json');
  const reportPath = path.join(directory, 'report.json');
  fs.writeFileSync(markdownPath, [
    '```python',
    '# doc-verify: run',
    '# doc-verify-name: create docs collection',
    'client.create_collection("docs_test_alpha")',
    '```',
  ].join('\n'));
  const result = spawnSync(process.execPath, [
    SCRIPT, '--markdown', markdownPath, '--live', '--allow-run', '--resource-suffix', 'alpha',
    '--runtime-manifest', manifestPath, '--runtime-journal', path.join(directory, 'runtime.jsonl'),
    '--report', reportPath,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Runtime approval is required/);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.mutating, true);
  assert.match(manifest.runtimeManifestDigest, /^sha256:/);
  assert.equal(fs.existsSync(path.join(directory, 'runtime.jsonl')), false);
});

test('static verifier can emit a read-only remediation handoff for an owning write skill', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'verifier-remediation-'));
  const markdownPath = path.join(directory, 'bad.md');
  const reportPath = path.join(directory, 'report.json');
  const handoffPath = path.join(directory, 'handoff.json');
  fs.writeFileSync(markdownPath, '```javascript\nconst broken = ;\n```\n');
  const result = spawnSync(process.execPath, [
    SCRIPT, '--markdown', markdownPath, '--report', reportPath, '--remediation-handoff', handoffPath,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const handoff = JSON.parse(fs.readFileSync(handoffPath, 'utf8'));
  assert.equal(handoff.writeAuthorized, false);
  assert.equal(handoff.requiresNewActionBatch, true);
  assert.equal(handoff.items[0].recommendedSkill, 'procedure-code-sync');
  assert.match(handoff.verificationResultDigest, /^sha256:/);
});

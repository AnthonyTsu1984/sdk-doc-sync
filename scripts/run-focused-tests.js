#!/usr/bin/env node
'use strict';

// Admission gate: actually EXECUTE the focused tests each canonical skill
// advertises in capabilities.json. Before the phase-6 6.5 review, focusedTest
// entries were metadata only — the admission recorded them without running
// them, so a three-file syntax break in production executors passed all nine
// stages. This runner collects every advertised path, dedupes, and runs them
// under node --test; a missing or failing advertised file fails admission.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const CANONICAL_SKILLS = Object.freeze([
  'api-reference-sync',
  'localized-doc-sync',
  'procedure-code-sync',
  'verified-doc-authoring',
  'doc-code-verify',
]);

function collectFocusedTests() {
  const byFile = new Map();
  for (const skill of CANONICAL_SKILLS) {
    const manifestPath = path.join(REPO_ROOT, '.claude', 'skills', skill, 'capabilities.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const operation of manifest?.adapterPolicy?.operations || []) {
      if (!operation.focusedTest) continue;
      const resolved = path.resolve(REPO_ROOT, operation.focusedTest);
      if (!fs.existsSync(resolved)) {
        throw new Error(`FOCUSED_TEST_MISSING: ${skill}:${operation.operation} advertises ${operation.focusedTest}`);
      }
      const files = byFile.get(resolved) || [];
      files.push(`${skill}:${operation.operation}`);
      byFile.set(resolved, files);
    }
  }
  return [...byFile.entries()].map(([file, operations]) => ({ file, operations: operations.sort() }));
}

function main() {
  const focused = collectFocusedTests();
  process.stdout.write(`${JSON.stringify({
    advertised: focused.reduce((total, entry) => total + entry.operations.length, 0),
    files: focused.length,
  }, null, 2)}\n`);
  const execution = spawnSync(process.execPath, ['--test', ...focused.map(entry => entry.file)], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  if (execution.status !== 0) {
    process.stderr.write('FOCUSED_TESTS_FAILED: an advertised focused suite failed; admission is blocked\n');
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { CANONICAL_SKILLS, collectFocusedTests };

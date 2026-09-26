#!/usr/bin/env node
'use strict';

// Admission gate: parse-check every first-party JavaScript file. A module
// that cannot load silently drops every guard inside it — the phase-6 6.5
// review caught three production files whose manifest-binding edit produced
// unmatched braces while all nine existing admission stages stayed green
// (focused tests were advertised metadata, never executed). This gate runs
// `node --check` over the first-party tree so a non-parsing file fails the
// deterministic admission before any behavioral suite runs.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCAN_ROOTS = ['.claude', 'scripts', 'tests'];
const SKIP_DIRS = new Set(['node_modules', 'tmp', '.git', 'sandbox']);

function walk(dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) walk(full, acc);
    else if (name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

function collectJsFiles(repoRoot, scanRoots = SCAN_ROOTS) {
  const files = [];
  for (const root of scanRoots) {
    const absolute = path.join(repoRoot, root);
    if (fs.existsSync(absolute)) walk(absolute, files);
  }
  return files;
}

function checkFiles(files, { repoRoot = REPO_ROOT } = {}) {
  const failures = [];
  for (const file of files) {
    const execution = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (execution.status !== 0) {
      failures.push({ file: path.relative(repoRoot, file), detail: String(execution.stderr || execution.stdout || 'node --check failed').trim().split('\n').slice(0, 4).join(' | ') });
    }
  }
  return failures;
}

function main() {
  const files = collectJsFiles(REPO_ROOT);
  const failures = checkFiles(files);
  process.stdout.write(`${JSON.stringify({ checked: files.length, failed: failures.length }, null, 2)}\n`);
  if (failures.length > 0) {
    for (const failure of failures) {
      process.stderr.write(`JS_SYNTAX_INVALID: ${failure.file}\n  ${failure.detail}\n`);
    }
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { SCAN_ROOTS, SKIP_DIRS, collectJsFiles, checkFiles };

#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function listTestFiles() {
  const dir = __dirname;
  const files = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.test.js'))
    .map((name) => path.join(dir, name))
    .sort();
  return files;
}

function main() {
  const files = listTestFiles();
  if (files.length === 0) {
    console.log('No sdk-doc-sync test files found.');
    process.exit(0);
  }

  const args = ['--test', ...files];
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

main();

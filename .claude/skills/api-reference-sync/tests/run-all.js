#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const INTEGRATION_TESTS = new Set([
  'agent-harness.test.js',
  'bitable-repository.test.js',
  'feishu-client.test.js',
  'lark-cli-ops.test.js',
  'lark-doc-writer.test.js',
  'operational-harness.test.js',
  'read-consumers.test.js',
  'release-scout-cli.test.js',
  'sdk-doc-sync-cli.test.js',
]);

function listTestFiles() {
  const dir = __dirname;
  const files = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.test.js'))
    .map((name) => path.join(dir, name))
    .sort();
  return files;
}

function tierFor(file) {
  const name = path.basename(file);
  if (name.endsWith('.live.test.js')) return 'live';
  if (INTEGRATION_TESTS.has(name)) return 'integration';
  return 'unit';
}

function parseMode(argv) {
  const knownModes = new Set(['--unit', '--offline', '--integration', '--all']);
  const modes = argv.filter(arg => knownModes.has(arg));
  const unknown = argv.filter(arg => arg.startsWith('--') && arg !== '--list' && !knownModes.has(arg));
  if (unknown.length > 0) throw new Error(`Unknown test tier: ${unknown.join(', ')}`);
  if (modes.length > 1) throw new Error(`Choose exactly one test tier, received: ${modes.join(', ')}`);
  return modes[0] || '--all';
}

function selectTestFiles(files, mode) {
  if (mode === '--unit') return files.filter(file => tierFor(file) === 'unit');
  if (mode === '--integration') return files.filter(file => tierFor(file) === 'integration');
  if (mode === '--offline') return files.filter(file => tierFor(file) !== 'live');
  return files;
}

function main() {
  let mode;
  try {
    mode = parseMode(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(64);
  }
  const files = selectTestFiles(listTestFiles(), mode);
  if (files.length === 0) {
    console.log('No sdk-doc-sync test files found.');
    process.exit(0);
  }

  if (process.argv.includes('--list')) {
    files.forEach((file) => console.log(path.relative(process.cwd(), file)));
    return;
  }

  const args = ['--test', ...files];
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

main();

module.exports = { INTEGRATION_TESTS, listTestFiles, parseMode, selectTestFiles, tierFor };

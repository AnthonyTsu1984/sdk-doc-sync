#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { verifyOperationalManifest } = require('../src/sdk-doc-sync/operational-harness');

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--help' || item === '-h') return { help: true };
    if (item !== '--manifest') throw new Error(`Unknown argument: ${item}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error('Missing value for --manifest');
    args.manifest = value;
    index += 1;
  }
  if (!args.manifest) throw new Error('Missing --manifest <path>');
  return args;
}

function usage() {
  return [
    'Usage: node scripts/verify-operational-harness.js --manifest <path>',
    '',
    'Validates durable execution receipts, publication access evidence, Java example layout,',
    'and embedded-helper cleanup from one JSON manifest.',
  ].join('\n');
}

function main(argv = process.argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    return 2;
  }
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  const manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
  const verification = verifyOperationalManifest(manifest);
  process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
  return verification.valid ? 0 : 1;
}

if (require.main === module) process.exitCode = main();

module.exports = { main, parseArgs, usage };

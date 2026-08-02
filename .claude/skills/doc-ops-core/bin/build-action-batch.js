#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createActionBatch } = require('../src/action-batch');
const { canonicalStringify } = require('../src/canonical-json');

function parseArgs(argv) {
  const options = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (['--skill', '--operation', '--input', '--output'].includes(key)) options[key.slice(2)] = argv[++index];
    else throw new Error(`Unknown argument: ${key}`);
  }
  for (const key of ['skill', 'operation', 'input', 'output']) if (!options[key]) throw new Error(`--${key} is required`);
  return options;
}

function main() {
  const options = parseArgs(process.argv);
  const input = JSON.parse(fs.readFileSync(path.resolve(options.input), 'utf8'));
  const batch = createActionBatch({
    skill: options.skill,
    operation: options.operation,
    actions: Array.isArray(input) ? input : input.actions,
  });
  const output = path.resolve(options.output);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, canonicalStringify(batch));
  process.stdout.write(canonicalStringify({ batchDigest: batch.batchDigest, actionCount: batch.actions.length, output }));
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(64);
}

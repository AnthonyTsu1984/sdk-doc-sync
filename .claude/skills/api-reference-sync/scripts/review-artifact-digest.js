#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { digestSemantic } = require('../../doc-ops-core/src/digest');

function main(argv = process.argv) {
  const input = argv[2];
  if (!input || argv.length !== 3) {
    throw new Error('Usage: node .claude/skills/api-reference-sync/scripts/review-artifact-digest.js <artifact.json>');
  }

  const file = path.resolve(input);
  const artifact = JSON.parse(fs.readFileSync(file, 'utf8'));
  process.stdout.write(`${digestSemantic(artifact)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main };

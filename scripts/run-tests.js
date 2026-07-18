#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

const suites = [
  {
    name: 'sdk-doc-sync',
    command: process.execPath,
    args: ['.claude/skills/sdk-doc-sync/tests/run-all.js'],
  },
  { name: 'test:skills', command: 'npm', args: ['run', 'test:skills'] },
  { name: 'test:patch-code-blocks', command: 'npm', args: ['run', 'test:patch-code-blocks'] },
  { name: 'test:verifier', command: 'npm', args: ['run', 'test:verifier'] },
  { name: 'test:agent-team', command: 'npm', args: ['run', 'test:agent-team'] },
];

for (const suite of suites) {
  console.log(`\n=== ${suite.name} ===`);
  const result = spawnSync(suite.command, suite.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`${suite.name} failed to start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('\nAll repository test suites passed.');

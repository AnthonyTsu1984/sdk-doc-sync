'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CANONICAL = [
  'api-reference-sync',
  'doc-code-verify',
  'localized-doc-sync',
  'procedure-code-sync',
  'verified-doc-authoring',
];
const ALIASES = ['draft-verified-docs', 'feishu-code-verify', 'localization-docs', 'patch-feishu-code', 'sdk-doc-sync'];

function filesUnder(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const resolved = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'plans') continue;
      files.push(...filesUnder(resolved));
    } else if (/\.(md|yaml)$/.test(entry.name)) files.push(resolved);
  }
  return files;
}

function allowedInternalAliasPath(line) {
  return /(?:src\/sdk-doc-sync|bin\/sdk-doc-sync\.js|tmp\/sdk-doc-sync|tests\/sdk-doc-sync|sdk-doc-sync\/|\/tmp\/feishu-code-verify-)/.test(line);
}

test('canonical skill prose and prompts teach canonical names while retaining internal implementation paths', () => {
  const violations = [];
  for (const skill of CANONICAL) {
    const root = path.join(REPO_ROOT, '.claude', 'skills', skill);
    for (const filePath of filesUnder(root)) {
      const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        for (const alias of ALIASES) {
          if (!line.includes(alias)) continue;
          if (allowedInternalAliasPath(line)) continue;
          violations.push(`${path.relative(REPO_ROOT, filePath)}:${index + 1}:${alias}`);
        }
      });
    }
  }
  assert.deepEqual(violations, []);
});

test('mutating live verifier examples include the exact runtime-manifest approval flow', () => {
  const workflow = fs.readFileSync(path.join(REPO_ROOT, '.claude', 'skills', 'doc-code-verify', 'references', 'scenario-workflow.md'), 'utf8');
  assert.match(workflow, /--runtime-manifest/);
  assert.match(workflow, /--approve-runtime-digest/);
  assert.match(workflow, /--runtime-journal/);
});

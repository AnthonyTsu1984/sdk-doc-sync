'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validateReleaseScope } = require('../src/sdk-doc-sync/release-scope/schema');

const fixtureDir = path.join(__dirname, 'fixtures', 'release-scope');

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
}

function validateAgentArtifact({ caseFixture, releaseScope, commandLog }) {
  const errors = [];
  const scopeValidation = validateReleaseScope(releaseScope);
  if (!scopeValidation.valid) errors.push(...scopeValidation.errors.map((error) => error.message));
  const normalizedCommandLog = commandLog.map((command) => command
    .replace(/(?:node\s+)?(?:\S+\/)?sdk-release-scout\.js/g, 'sdk-release-scout')
    .replace(/(?:node\s+)?(?:\S+\/)?sdk-doc-sync\.js/g, 'sdk-doc-sync'));
  for (const required of caseFixture.requiredCommands) {
    if (!normalizedCommandLog.some((command) => command.includes(required))) {
      errors.push(`missing command: ${required}`);
    }
  }
  if (releaseScope.baselineTag !== caseFixture.expected.baselineTag) errors.push('baselineTag mismatch');
  if (releaseScope.targetTag !== caseFixture.expected.targetTag) errors.push('targetTag mismatch');
  if (releaseScope.approvalGrade !== caseFixture.expected.approvalGrade) errors.push('approvalGrade mismatch');
  if (releaseScope.writesPerformed !== false) errors.push('writesPerformed must be false');
  if (releaseScope.scanStateUpdated !== false) errors.push('scanStateUpdated must be false');
  const stableIds = (releaseScope.actions || []).map((action) => action.stableId);
  try {
    assert.deepEqual(stableIds, caseFixture.expected.stableIds);
  } catch {
    errors.push('stableIds mismatch');
  }
  return { valid: errors.length === 0, errors };
}

test('agent harness accepts bounded release-scout artifact and command trace', () => {
  const caseFixture = readJson('python-v26-agent-case.json');
  const releaseScope = readJson('python-v26-expected.json');
  const validation = validateAgentArtifact({
    caseFixture,
    releaseScope,
    commandLog: [
      'node .claude/skills/sdk-doc-sync/bin/sdk-release-scout.js --language python --sdk-name pymilvus --track v2.6.x --json --output tmp/python-v26.json',
      'node .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js --release-scope tmp/python-v26.json --dry-run --json',
    ],
  });
  assert.deepEqual(validation, { valid: true, errors: [] });
});

test('agent harness rejects full scanner dumps as final artifacts', () => {
  const caseFixture = readJson('python-v26-agent-case.json');
  const releaseScope = {
    scanned: [{ name: 'compact' }],
    diff: [],
    plans: [],
  };
  const validation = validateAgentArtifact({
    caseFixture,
    releaseScope,
    commandLog: ['node .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js --dry-run --json'],
  });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes('missing command: sdk-release-scout')));
});

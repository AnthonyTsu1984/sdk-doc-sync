'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { MAX_BYTES, lintSkillMd } = require('../../scripts/skill-md-lint');

const repoRoot = path.join(__dirname, '..', '..');
const skillDir = path.join(repoRoot, '.claude', 'skills', 'api-reference-sync');

test('real api-reference-sync SKILL.md passes the meta-lint within the size budget', () => {
  const result = lintSkillMd({ skillDir, repoRoot });
  assert.deepEqual(result.errors, [], `lint errors: ${JSON.stringify(result.errors)}`);
  assert.ok(result.findings.byteLength <= MAX_BYTES, `SKILL.md ${result.findings.byteLength} exceeds ${MAX_BYTES}`);
  assert.equal(result.findings.markers, 33, 'all 33 invariant markers must be present');
  assert.ok(result.findings.links > 20, 'required-references pointers must be present');
});

test('oversize SKILL.md fails with SKILL_LINT_SIZE_BUDGET_EXCEEDED', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-md-lint-'));
  try {
    fs.writeFileSync(path.join(tmp, 'SKILL.md'), 'x'.repeat(20000));
    const result = lintSkillMd({ skillDir: tmp, repoRoot, maxBytes: MAX_BYTES });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.code === 'SKILL_LINT_SIZE_BUDGET_EXCEEDED'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('dangling pointer fails with SKILL_LINT_POINTER_MISSING', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-md-lint-'));
  try {
    fs.writeFileSync(path.join(tmp, 'SKILL.md'), 'See [missing](references/does-not-exist.md).\n');
    const result = lintSkillMd({ skillDir: tmp, repoRoot, maxBytes: MAX_BYTES });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.code === 'SKILL_LINT_POINTER_MISSING'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

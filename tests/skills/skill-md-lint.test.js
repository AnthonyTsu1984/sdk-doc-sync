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

test('fabricated refusal code fails even when operator judgment appears elsewhere (batch15 review P1)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-md-lint-'));
  try {
    // An incidental operator-judgment phrase on one line must NOT exempt a
    // fabricated code cited on another line — the pre-fix file-level
    // short-circuit was fail-open exactly this way.
    fs.writeFileSync(
      path.join(tmp, 'SKILL.md'),
      '# Skill\n\nEvery gate requires an explicit operator decision before writes.\n\nA failure emits TOTALLY_FAKE_BLOCKER_CODE.\n',
    );
    const result = lintSkillMd({ skillDir: tmp, repoRoot, maxBytes: MAX_BYTES });
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((error) => error.code === 'SKILL_LINT_CODE_UNVERIFIED' && /TOTALLY_FAKE/.test(error.detail)),
      `expected TOTALLY_FAKE_BLOCKER_CODE rejection, got: ${JSON.stringify(result.errors)}`,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('per-line operator-judgment marking exempts only that line code (batch15 review P1)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-md-lint-'));
  try {
    fs.writeFileSync(
      path.join(tmp, 'SKILL.md'),
      '# Skill\n\nA failure emits SOME_UNBACKED_CODE (operator judgment decides the exception path).\n',
    );
    const result = lintSkillMd({ skillDir: tmp, repoRoot, maxBytes: MAX_BYTES });
    assert.deepEqual(result.errors, [], `same-line marking must exempt: ${JSON.stringify(result.errors)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('codes that live in doc-ops-core source verify (batch15 review P1 sourceRoots)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-md-lint-'));
  try {
    // PROCESS_LEARNING_CAPTURE_REQUIRED lives in doc-ops-core/src, not in this
    // skill's tree — the walk must cover the cross-skill home.
    fs.writeFileSync(
      path.join(tmp, 'SKILL.md'),
      '# Skill\n\nClose runs PROCESS_LEARNING_CAPTURE_REQUIRED before the session may close.\n',
    );
    const result = lintSkillMd({ skillDir: tmp, repoRoot, maxBytes: MAX_BYTES });
    assert.deepEqual(result.errors, [], `cross-skill code must verify: ${JSON.stringify(result.errors)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

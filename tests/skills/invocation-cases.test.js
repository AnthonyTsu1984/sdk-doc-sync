const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseFrontmatter } = require('../../scripts/validate-skills');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CANONICAL_SKILLS = [
  'api-reference-sync',
  'doc-code-verify',
  'localized-doc-sync',
  'procedure-code-sync',
  'verified-doc-authoring',
];
const COMPATIBILITY_SKILLS = {
  'draft-verified-docs': 'verified-doc-authoring',
  'feishu-code-verify': 'doc-code-verify',
  'localization-docs': 'localized-doc-sync',
  'patch-feishu-code': 'procedure-code-sync',
  'sdk-doc-sync': 'api-reference-sync',
};
const SKILLS = [...CANONICAL_SKILLS, ...Object.keys(COMPATIBILITY_SKILLS)];

test('all repository skills use trigger-oriented descriptions and agent metadata', () => {
  for (const name of SKILLS) {
    const skillRoot = path.join(REPO_ROOT, '.claude', 'skills', name);
    const content = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const { attributes } = parseFrontmatter(content);
    assert.match(attributes.description, /^Use when\b/, `${name} description must start with "Use when"`);
    assert.equal(Object.hasOwn(attributes, 'argument-hint'), false, `${name} has nonstandard argument-hint`);

    const agentPath = path.join(skillRoot, 'agents', 'openai.yaml');
    assert.equal(fs.existsSync(agentPath), true, `${name} is missing agents/openai.yaml`);
    const agent = fs.readFileSync(agentPath, 'utf8');
    assert.match(agent, /^interface:/m);
    assert.match(agent, /default_prompt:\s+"Use \$/);
  }
});

test('routing eval corpus covers explicit, implicit, contextual, and negative cases for every skill', () => {
  const evalPath = path.join(REPO_ROOT, 'evals', 'skills', 'invocation-cases.jsonl');
  const cases = fs.readFileSync(evalPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));

  for (const entry of cases) {
    assert.equal(typeof entry.id, 'string');
    assert.equal(typeof entry.prompt, 'string');
    assert.equal(CANONICAL_SKILLS.includes(entry.expectedSkill), true);
    assert.equal(Array.isArray(entry.mustNotSelect), true);
    assert.equal(entry.mustNotSelect.includes(entry.expectedSkill), false);
    for (const forbidden of entry.mustNotSelect) {
      assert.equal(CANONICAL_SKILLS.includes(forbidden), true, `${entry.id} has unknown mustNotSelect skill ${forbidden}`);
    }
  }

  for (const name of CANONICAL_SKILLS) {
    const matching = cases.filter(entry => entry.expectedSkill === name);
    assert.deepEqual(
      [...new Set(matching.map(entry => entry.class))].sort(),
      ['contextual', 'explicit', 'implicit', 'negative'],
      `${name} must cover all routing classes`,
    );
    for (const routingClass of ['explicit', 'implicit', 'contextual', 'negative']) {
      assert.equal(
        matching.filter(entry => entry.class === routingClass).length,
        3,
        `${name} must provide exactly three ${routingClass} cases`,
      );
    }
  }
});

test('deprecated skill names are thin compatibility entries for canonical skills', () => {
  for (const [alias, canonical] of Object.entries(COMPATIBILITY_SKILLS)) {
    const content = fs.readFileSync(path.join(REPO_ROOT, '.claude', 'skills', alias, 'SKILL.md'), 'utf8');
    assert.match(content, new RegExp(`\\.\\./${canonical}/SKILL\\.md`));
    assert.match(content, /deprecated name/i);
    assert.match(content, /Do not define or execute an independent workflow here\./);
    assert.ok(content.split(/\r?\n/).length < 20, `${alias} compatibility entry must stay thin`);
  }
});

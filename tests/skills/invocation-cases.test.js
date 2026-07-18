const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseFrontmatter } = require('../../scripts/validate-skills');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SKILLS = [
  'draft-verified-docs',
  'feishu-code-verify',
  'localization-docs',
  'patch-feishu-code',
  'sdk-doc-sync',
];

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
    assert.equal(SKILLS.includes(entry.expectedSkill), true);
    assert.equal(Array.isArray(entry.mustNotSelect), true);
  }

  for (const name of SKILLS) {
    const matching = cases.filter(entry => entry.expectedSkill === name);
    assert.deepEqual(
      [...new Set(matching.map(entry => entry.class))].sort(),
      ['contextual', 'explicit', 'implicit', 'negative'],
      `${name} must cover all routing classes`,
    );
  }
});

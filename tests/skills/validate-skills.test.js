const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseFrontmatter,
  validateRepository,
  validateSkill,
} = require('../../scripts/validate-skills');

function makeSkill(root, name, options = {}) {
  const skillDir = path.join(root, '.claude', 'skills', name);
  fs.mkdirSync(skillDir, { recursive: true });
  const frontmatter = [
    '---',
    `name: ${options.frontmatterName || name}`,
    `description: ${options.description || `Use when testing ${name}.`}`,
    ...(options.extraFrontmatter || []),
    '---',
    '',
    `# ${name}`,
    '',
    options.body || 'Follow the workflow.',
  ].join('\n');
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), frontmatter);
  if (options.agent !== false) {
    const agentDir = path.join(skillDir, 'agents');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'openai.yaml'), [
      'interface:',
      `  display_name: "${name}"`,
      '  short_description: "Test skill"',
      `  default_prompt: "Use $${name} for this task."`,
      '',
    ].join('\n'));
  }
  return skillDir;
}

test('parseFrontmatter reads supported scalar fields', () => {
  const parsed = parseFrontmatter([
    '---',
    'name: sample-skill',
    'description: Use when a sample is needed.',
    'license: Apache-2.0',
    'compatibility: Requires network access.',
    'allowed-tools: shell http',
    '---',
    '# Sample',
  ].join('\n'));

  assert.equal(parsed.attributes.name, 'sample-skill');
  assert.equal(parsed.attributes.compatibility, 'Requires network access.');
  assert.match(parsed.body, /^# Sample/);
});

test('validateSkill rejects nonstandard argument-hint frontmatter', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-validator-'));
  const skillDir = makeSkill(root, 'sample-skill', {
    extraFrontmatter: ['argument-hint: "<doc>"'],
  });

  const result = validateSkill(skillDir);
  assert.equal(result.errors.some(error => error.includes('argument-hint')), true);
});

test('validateSkill checks directory name, relative links, and agent metadata', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-validator-'));
  const skillDir = makeSkill(root, 'directory-name', {
    frontmatterName: 'different-name',
    agent: false,
    body: 'Read [missing](references/missing.md).',
  });

  const result = validateSkill(skillDir);
  assert.equal(result.errors.some(error => error.includes('must match directory')), true);
  assert.equal(result.errors.some(error => error.includes('missing reference')), true);
  assert.equal(result.errors.some(error => error.includes('agents/openai.yaml')), true);
});

test('validateRepository discovers skills and ignores internal tool packages without SKILL.md', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-validator-'));
  makeSkill(root, 'first-skill');
  makeSkill(root, 'second-skill');
  fs.mkdirSync(path.join(root, '.claude', 'skills', 'internal-tool', 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'internal-tool', 'src', 'index.js'), 'module.exports = {};\n');

  const result = validateRepository(root);
  assert.deepEqual(result.skills.map(skill => path.basename(skill.skillDir)), ['first-skill', 'second-skill']);
  assert.equal(result.internalTools.some(tool => tool.endsWith('internal-tool')), true);
  assert.deepEqual(result.errors, []);
});

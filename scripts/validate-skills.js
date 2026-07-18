#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const ALLOWED_FRONTMATTER = new Set([
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
]);

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(content) {
  const match = String(content).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) throw new Error('SKILL.md must start with YAML frontmatter');

  const attributes = {};
  let nestedKey = null;
  for (const rawLine of match[1].split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
    const nested = rawLine.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
    if (nested && nestedKey) {
      attributes[nestedKey][nested[1]] = unquote(nested[2]);
      continue;
    }
    const top = rawLine.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!top) throw new Error(`Unsupported YAML line: ${rawLine}`);
    const [, key, value] = top;
    if (!value.trim()) {
      attributes[key] = {};
      nestedKey = key;
    } else {
      attributes[key] = unquote(value);
      nestedKey = null;
    }
  }

  return {
    attributes,
    body: content.slice(match[0].length),
  };
}

function markdownLinks(content) {
  return [...String(content).matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map(match => match[1].trim())
    .filter(target => target && !target.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(target));
}

function validateSkill(skillDir) {
  const errors = [];
  const warnings = [];
  const skillPath = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    return { skillDir, skillPath, errors: ['SKILL.md is missing'], warnings };
  }

  const content = fs.readFileSync(skillPath, 'utf8');
  let attributes = {};
  try {
    ({ attributes } = parseFrontmatter(content));
  } catch (error) {
    errors.push(error.message);
    return { skillDir, skillPath, attributes, errors, warnings };
  }

  for (const key of Object.keys(attributes)) {
    if (!ALLOWED_FRONTMATTER.has(key)) errors.push(`unsupported frontmatter field: ${key}`);
  }

  const name = typeof attributes.name === 'string' ? attributes.name.trim() : '';
  const description = typeof attributes.description === 'string' ? attributes.description.trim() : '';
  const directoryName = path.basename(skillDir);

  if (!name) errors.push('frontmatter name is required');
  if (name && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    errors.push(`invalid skill name: ${name}`);
  }
  if (name.length > 64) errors.push(`skill name exceeds 64 characters: ${name.length}`);
  if (name && name !== directoryName) {
    errors.push(`frontmatter name ${name} must match directory ${directoryName}`);
  }
  if (!description) errors.push('frontmatter description is required');
  if (description.length > 1024) errors.push(`description exceeds 1024 characters: ${description.length}`);

  const lineCount = content.split(/\r?\n/).length;
  if (lineCount > 500) errors.push(`SKILL.md exceeds 500 lines: ${lineCount}`);
  else if (lineCount > 300) warnings.push(`SKILL.md is large (${lineCount} lines); consider progressive disclosure`);

  for (const target of markdownLinks(content)) {
    const relativeTarget = target.split('#', 1)[0];
    const resolved = path.resolve(skillDir, relativeTarget);
    if (!fs.existsSync(resolved)) errors.push(`missing reference: ${target}`);
  }

  const agentPath = path.join(skillDir, 'agents', 'openai.yaml');
  if (!fs.existsSync(agentPath)) errors.push('missing agents/openai.yaml');

  return { skillDir, skillPath, attributes, errors, warnings };
}

function validateRepository(repoRoot = process.cwd()) {
  const skillsRoot = path.join(repoRoot, '.claude', 'skills');
  const skills = [];
  const internalTools = [];
  if (!fs.existsSync(skillsRoot)) {
    return { skills, internalTools, errors: [`skills directory is missing: ${skillsRoot}`], warnings: [] };
  }

  const entries = fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const skillDir = path.join(skillsRoot, entry.name);
    if (fs.existsSync(path.join(skillDir, 'SKILL.md'))) skills.push(validateSkill(skillDir));
    else internalTools.push(skillDir);
  }

  return {
    skills,
    internalTools,
    errors: skills.flatMap(skill => skill.errors.map(error => `${path.basename(skill.skillDir)}: ${error}`)),
    warnings: skills.flatMap(skill => skill.warnings.map(warning => `${path.basename(skill.skillDir)}: ${warning}`)),
  };
}

function main() {
  const result = validateRepository(process.cwd());
  for (const warning of result.warnings) console.warn(`WARN ${warning}`);
  for (const error of result.errors) console.error(`ERROR ${error}`);
  for (const toolDir of result.internalTools) {
    console.log(`INFO ${path.relative(process.cwd(), toolDir)} is an internal tool package (no SKILL.md)`);
  }
  if (result.errors.length) process.exit(1);
  console.log(`Validated ${result.skills.length} skills.`);
}

if (require.main === module) main();

module.exports = {
  markdownLinks,
  parseFrontmatter,
  validateRepository,
  validateSkill,
};

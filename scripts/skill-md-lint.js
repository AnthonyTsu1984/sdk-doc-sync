#!/usr/bin/env node
'use strict';

// SKILL.md meta-lint (slice 3-2, audit tmp/skill-thin-refactor-audit.md §6.5):
// keeps the thin skill from growing back. Offline, read-only checks over one
// skill directory:
//   1. size budget  — SKILL.md stays under MAX_BYTES (16KB);
//   2. marker set   — every [api.*] marker in the Domain Invariants section
//                     exists in contracts/invariants.json, every registry id
//                     has a marked bullet, and every statementDigest matches
//                     the bullet statement (delegates to the doc-ops-core
//                     shared contract);
//   3. pointers     — every relative markdown link target and every
//                     references/*.md path mentioned in prose exists on disk;
//   4. refusal codes— every ALL_CAPS refusal-looking token cited in prose
//                     (excluding the registry/markers) appears in the skill's
//                     source tree or is explicitly marked operator judgment.
// Exit 1 with typed SKILL_LINT_* errors on any failure.

const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 16 * 1024;
const MARKER_PATTERN = /\[([a-z0-9]+(?:[.-][a-z0-9]+)*)\]/g;
const CODE_PATTERN = /\b([A-Z][A-Z0-9]{4,}(?:_[A-Z0-9]+)+)\b/g;
const LINK_PATTERN = /\]\(([^)\s]+)\)/g;
const PROSE_PATH_PATTERN = /(?:references|scripts|bin|contracts|config)\/[A-Za-z0-9_./-]+\.(?:md|json|js)/g;
const OPERATOR_JUDGMENT_PATTERN = /operator (?:judgment|adjudication|decision)|explicitly marked/i;

function readIfExists(p) { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; }

function lintSkillMd({ skillDir, repoRoot, maxBytes = MAX_BYTES } = {}) {
  const errors = [];
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  const markdown = readIfExists(skillMdPath);
  if (markdown === null) {
    return { valid: false, errors: [{ code: 'SKILL_LINT_SKILL_MD_MISSING', path: skillMdPath }], findings: {} };
  }
  const byteLength = Buffer.byteLength(markdown);
  const findings = { byteLength, maxBytes, markers: 0, links: 0, codes: [] };

  // 1. Size budget.
  if (byteLength > maxBytes) {
    errors.push({
      code: 'SKILL_LINT_SIZE_BUDGET_EXCEEDED',
      detail: `SKILL.md is ${byteLength} bytes, over the ${maxBytes}-byte budget`,
      byteLength,
      maxBytes,
    });
  }

  // 2. Marker/registry consistency (shared doc-ops-core contract).
  const registryRaw = readIfExists(path.join(skillDir, 'contracts', 'invariants.json'));
  if (registryRaw !== null) {
    let registry = null;
    try {
      registry = JSON.parse(registryRaw);
    } catch (error) {
      errors.push({ code: 'SKILL_LINT_REGISTRY_UNREADABLE', detail: error.message });
    }
    if (registry) {
      const {
        extractDomainInvariantBullets,
        checkSkillInvariantCoverage,
      } = require(path.join(repoRoot, '.claude', 'skills', 'doc-ops-core', 'src', 'invariant-registry'));
      const bullets = extractDomainInvariantBullets(markdown);
      findings.markers = bullets.filter((bullet) => bullet.marker).length;
      const fixtureIds = [];
      const casesPath = path.join(skillDir, 'tests', 'conformance-fixtures', 'cases.json');
      const casesRaw = readIfExists(casesPath);
      if (casesRaw) {
        try {
          const cases = JSON.parse(casesRaw);
          fixtureIds.push(...(Array.isArray(cases) ? cases : cases.cases || []).map((item) => item.id));
        } catch { /* fixture presence is validate-skills' job */ }
      }
      const coverage = checkSkillInvariantCoverage({ skillDir, repoRoot, fixtureIds });
      for (const error of coverage.errors) {
        errors.push({ code: `SKILL_LINT_${error.code}`, id: error.id, detail: error.detail || error.path });
      }
    }
  }

  // 3. Pointer integrity: relative markdown links + prose path mentions.
  const linkTargets = new Set();
  for (const match of markdown.matchAll(LINK_PATTERN)) {
    const target = match[1];
    if (/^[a-z]+:/i.test(target) || target.startsWith('#')) continue;
    linkTargets.add(target.split('#', 1)[0]);
  }
  for (const match of markdown.matchAll(PROSE_PATH_PATTERN)) {
    linkTargets.add(match[0]);
  }
  findings.links = linkTargets.size;
  for (const relative of [...linkTargets].sort()) {
    const resolved = path.resolve(skillDir, relative);
    if (!fs.existsSync(resolved)) {
      // Repo-root-relative fallback (e.g. scripts/... cited from prose).
      const repoResolved = path.resolve(repoRoot, relative);
      if (!fs.existsSync(repoResolved)) {
        errors.push({ code: 'SKILL_LINT_POINTER_MISSING', path: relative });
      }
    }
  }

  // 4. Refusal codes must be real (or operator judgment must be marked).
  const sourceRoots = ['src', 'bin', 'scripts'].map((dir) => path.join(skillDir, dir));
  const sourceText = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.js')) sourceText.push(fs.readFileSync(child, 'utf8'));
    }
  };
  for (const dir of sourceRoots) walk(dir);
  const sourceBlob = sourceText.join('\n');
  const inline = /`[^`]*`|```[\s\S]*?```/g;
  const proseOnly = markdown.replace(inline, (match) => match.replace(CODE_PATTERN, ''));
  const operatorJudgment = OPERATOR_JUDGMENT_PATTERN.test(markdown);
  for (const match of proseOnly.matchAll(CODE_PATTERN)) {
    const code = match[1];
    findings.codes.push(code);
    if (sourceBlob.includes(code)) continue;
    if (operatorJudgment) continue; // section-level operator-judgment marking
    errors.push({ code: 'SKILL_LINT_CODE_UNVERIFIED', detail: `${code} not found in skill source` });
  }

  return { valid: errors.length === 0, errors, findings };
}

function parseArgs(argv) {
  const options = { skill: 'api-reference-sync', repoRoot: process.cwd() };
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === '--skill') options.skill = argv[++index];
    else if (argv[index] === '--repo') options.repoRoot = path.resolve(argv[++index]);
    else if (argv[index] === '--max-bytes') options.maxBytes = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return options;
}

function main(argv = process.argv) {
  const options = parseArgs(argv);
  const skillDir = path.join(options.repoRoot, '.claude', 'skills', options.skill);
  const result = lintSkillMd({ skillDir, repoRoot: options.repoRoot, maxBytes: options.maxBytes });
  for (const error of result.errors) {
    console.error(`ERROR ${error.code}${error.id ? ` ${error.id}` : ''}${error.detail ? ` ${error.detail}` : ''}${error.path ? ` ${error.path}` : ''}`);
  }
  if (result.findings && result.findings.byteLength !== undefined) {
    console.log(`INFO SKILL.md ${result.findings.byteLength}/${result.findings.maxBytes} bytes, ${result.findings.markers} markers, ${result.findings.links} pointers, ${result.findings.codes.length} refusal-code citations`);
  }
  if (!result.valid) process.exit(1);
  console.log('skill-md-lint passed.');
}

if (require.main === module) main();

module.exports = { MAX_BYTES, lintSkillMd, parseArgs };

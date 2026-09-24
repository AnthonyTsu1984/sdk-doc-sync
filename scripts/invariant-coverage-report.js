#!/usr/bin/env node
'use strict';

// Read-only invariant coverage report across all canonical skills. For every
// skill it prints each registry invariant with its enforcement stages, enforcer
// modules, and fixtures, plus the typed coverage errors from
// checkSkillInvariantCoverage. This artifact is the phase 5 acceptance
// evidence: every canonical skill with a complete invariant-coverage report,
// and no runtime-enforced rule backed only by prose or a model eval.
//
// Usage:
//   node scripts/invariant-coverage-report.js [--json] [--strict] [--skill <name>]
//
// --json   machine-readable report on stdout
// --strict exit 1 when any skill has coverage errors (default: exit 0 report)

const fs = require('node:fs');
const path = require('node:path');

const { checkSkillInvariantCoverage } = require('../.claude/skills/doc-ops-core/src/invariant-registry');

function parseArgs(argv) {
  const options = { json: false, strict: false, skill: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '--skill') options.skill = argv[(index += 1)] || null;
    else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function fixtureIdsForSkill(skillDir) {
  const casesPath = path.join(skillDir, 'tests', 'conformance-fixtures', 'cases.json');
  if (!fs.existsSync(casesPath)) return [];
  try {
    const fixtures = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
    return (Array.isArray(fixtures) ? fixtures : fixtures.cases || []).map((item) => item.id);
  } catch {
    return [];
  }
}

function adoptedSkills(repoRoot) {
  const skillsRoot = path.join(repoRoot, '.claude', 'skills');
  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => fs.existsSync(path.join(skillsRoot, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(skillsRoot, name, 'contracts', 'invariants.json')))
    .sort();
}

function buildReport({ repoRoot, skillFilter = null }) {
  const skills = adoptedSkills(repoRoot).filter((name) => !skillFilter || name === skillFilter);
  const report = { generatedWith: 'scripts/invariant-coverage-report.js', skills: [] };
  for (const skill of skills) {
    const skillDir = path.join(repoRoot, '.claude', 'skills', skill);
    const coverage = checkSkillInvariantCoverage({
      skillDir,
      repoRoot,
      fixtureIds: fixtureIdsForSkill(skillDir),
    });
    report.skills.push({
      skill,
      adopted: true,
      valid: coverage.valid,
      errors: coverage.errors,
      invariants: (coverage.registry?.invariants || []).map((invariant) => ({
        id: invariant.id,
        version: invariant.version,
        status: invariant.status,
        risk: invariant.risk,
        scope: invariant.scope,
        enforcement: invariant.enforcement,
        statementDigest: invariant.statementDigest,
        enforcers: (invariant.enforcers || []).map((enforcer) => ({
          stage: enforcer.stage,
          module: enforcer.module,
          codes: enforcer.codes,
        })),
        fixtureIds: invariant.fixtureIds || [],
      })),
    });
  }
  return report;
}

function renderText(report) {
  const lines = [];
  for (const entry of report.skills) {
    lines.push(`# ${entry.skill} — ${entry.valid ? 'coverage OK' : 'COVERAGE ERRORS'}`);
    for (const error of entry.errors) {
      lines.push(`  ! ${error.code}${error.id ? ` ${error.id}` : ''}${error.path ? ` (${error.path})` : ''}`);
    }
    for (const invariant of entry.invariants) {
      lines.push(`  ${invariant.id} v${invariant.version} [${invariant.status}] stages=${invariant.enforcement.join(',')}`);
      for (const enforcer of invariant.enforcers) {
        lines.push(`    ${enforcer.stage}: ${enforcer.module} (${enforcer.codes.join(', ')})`);
      }
      lines.push(`    fixtures: ${invariant.fixtureIds.join(', ') || '(none)'}`);
    }
    lines.push('');
  }
  const total = report.skills.reduce((sum, entry) => sum + entry.invariants.length, 0);
  lines.push(`${report.skills.length} adopted skill(s), ${total} invariant(s) in total.`);
  return lines.join('\n');
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const repoRoot = path.resolve(__dirname, '..');
  const report = buildReport({ repoRoot, skillFilter: options.skill });
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderText(report));
  }
  const anyInvalid = report.skills.some((entry) => !entry.valid);
  if (options.strict && anyInvalid) {
    console.error('invariant coverage errors present (--strict)');
    return 1;
  }
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { buildReport, renderText, parseArgs };

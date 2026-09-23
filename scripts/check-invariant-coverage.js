#!/usr/bin/env node
'use strict';

// Deterministic admission gate: a Domain Invariants prose change must land
// together with an invariant-coverage update (the skill's
// contracts/invariants.json in the same diff), and every newly added bullet of
// a registry-adopted skill must carry a registered [invariant.id] marker.
// Replaying PR #19's one-line-only SKILL.md edit fails here with
// INVARIANT_COVERAGE_REQUIRED until the registry and executable coverage are
// part of the change.

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  detectEnforcementTransitions,
  extractDomainInvariantBullets,
  validateInvariantWaivers,
  waiverCoversTransition,
} = require('../.claude/skills/doc-ops-core/src/invariant-registry');

function git(args, { cwd, allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    if (allowFailure) return null;
    throw error;
  }
}

function resolveBase({ base = null, env = process.env } = {}) {
  if (base) return base;
  if (env.GITHUB_BASE_REF) return `origin/${env.GITHUB_BASE_REF}`;
  return 'origin/master';
}

// Pure comparison so tests can exercise the semantics without git.
function compareInvariantBullets(oldMarkdown, newMarkdown) {
  const oldBullets = extractDomainInvariantBullets(oldMarkdown);
  const newBullets = extractDomainInvariantBullets(newMarkdown);
  const oldStatements = new Set(oldBullets.map((bullet) => bullet.statement));
  const newStatements = new Set(newBullets.map((bullet) => bullet.statement));
  return {
    added: newBullets.filter((bullet) => !oldStatements.has(bullet.statement)),
    removed: oldBullets.filter((bullet) => !newStatements.has(bullet.statement)),
    newBullets,
    oldBullets,
  };
}

function checkInvariantCoverage({
  repoRoot = process.cwd(),
  base = null,
  head = 'HEAD',
  env = process.env,
  now = new Date(),
} = {}) {
  const errors = [];
  const findings = [];
  const resolvedBase = resolveBase({ base, env });
  const mergeBase = git(['merge-base', resolvedBase, head], { cwd: repoRoot, allowFailure: true });
  if (mergeBase === null) {
    return {
      valid: false,
      base: resolvedBase,
      mergeBase: null,
      errors: [{ code: 'INVARIANT_BASE_UNRESOLVED', base: resolvedBase }],
      findings,
    };
  }
  const baseSha = mergeBase.trim();
  const changed = new Set(
    git(['diff', '--name-only', `${baseSha}..${head}`], { cwd: repoRoot })
      .split(/\r?\n/)
      .filter(Boolean),
  );

  const touchedSkills = new Set();
  const registrySkills = new Set();
  for (const file of changed) {
    const skillMatch = file.match(/^\.claude\/skills\/([^/]+)\/(.+)$/);
    if (!skillMatch) continue;
    const [, skill, skillRelative] = skillMatch;
    if (skillRelative === 'SKILL.md') touchedSkills.add(skill);
    if (skillRelative === 'contracts/invariants.json') registrySkills.add(skill);
  }

  for (const skill of [...touchedSkills].sort()) {
    const skillMdRel = `.claude/skills/${skill}/SKILL.md`;
    const registryRel = `.claude/skills/${skill}/contracts/invariants.json`;
    const oldMarkdown = git(['show', `${baseSha}:${skillMdRel}`], { cwd: repoRoot, allowFailure: true }) || '';
    const newMarkdown = git(['show', `${head}:${skillMdRel}`], { cwd: repoRoot, allowFailure: true }) || '';
    const comparison = compareInvariantBullets(oldMarkdown, newMarkdown);
    const statementChanged = comparison.added.length > 0 || comparison.removed.length > 0;
    if (!statementChanged) continue;

    findings.push({
      skill,
      added: comparison.added.map((bullet) => bullet.statement),
      removed: comparison.removed.map((bullet) => bullet.statement),
      registryUpdated: changed.has(registryRel),
    });

    if (!changed.has(registryRel)) {
      errors.push({
        code: 'INVARIANT_COVERAGE_REQUIRED',
        skill,
        detail: 'Domain Invariants statements changed without a contracts/invariants.json update in the same diff',
        added: comparison.added.map((bullet) => bullet.statement),
        removed: comparison.removed.map((bullet) => bullet.statement),
      });
    }

    // New bullets of a registry-adopted skill must be registered and marked;
    // legacy unmarked bullets stay grandfathered until a later phase promotes
    // them.
    const registryAtHead = git(['show', `${head}:${registryRel}`], { cwd: repoRoot, allowFailure: true });
    if (registryAtHead !== null) {
      for (const bullet of comparison.added) {
        if (!bullet.marker) {
          errors.push({
            code: 'INVARIANT_MARKER_REQUIRED',
            skill,
            detail: 'New Domain Invariants bullets must carry a registered [invariant.id] marker',
            statement: bullet.statement,
          });
        }
      }
    }
  }

  // Registry transition gate: a registry-only edit (no SKILL.md change) must
  // not silently remove, downgrade, or weaken a runtime-enforced invariant.
  // Any weakening transition requires a valid, unexpired waiver in the
  // skill's contracts/invariant-waivers.json.
  for (const skill of [...registrySkills].sort()) {
    const registryRel = `.claude/skills/${skill}/contracts/invariants.json`;
    const waiversRel = `.claude/skills/${skill}/contracts/invariant-waivers.json`;
    const baseRaw = git(['show', `${baseSha}:${registryRel}`], { cwd: repoRoot, allowFailure: true });
    const headRaw = git(['show', `${head}:${registryRel}`], { cwd: repoRoot, allowFailure: true });
    const baseRegistry = parseRegistryArtifact(baseRaw, { skill, errors });
    const headRegistry = parseRegistryArtifact(headRaw, { skill, errors }) || { invariants: [] };
    const transitions = detectEnforcementTransitions({ baseRegistry, headRegistry });
    if (transitions.length === 0) continue;

    const waiversRaw = git(['show', `${head}:${waiversRel}`], { cwd: repoRoot, allowFailure: true });
    let waivers = [];
    if (waiversRaw !== null) {
      let waiverDoc = null;
      try {
        waiverDoc = JSON.parse(waiversRaw);
      } catch {
        errors.push({
          code: 'INVARIANT_WAIVER_UNREADABLE',
          skill,
          detail: `${waiversRel} is not valid JSON`,
        });
      }
      if (waiverDoc !== null) {
        const waiverValidation = validateInvariantWaivers(waiverDoc, { now });
        for (const error of waiverValidation.errors) {
          errors.push({ code: error.code, skill, detail: `invalid waiver artifact at ${error.path}` });
        }
        waivers = waiverDoc.waivers || [];
      }
    }

    for (const transition of transitions) {
      const waiver = waiverCoversTransition(waivers, transition, { now });
      findings.push({
        skill,
        invariantId: transition.invariantId,
        transition: transition.transition,
        waived: Boolean(waiver),
      });
      if (!waiver) {
        errors.push({
          code: 'INVARIANT_DOWNGRADE_UNWAIVED',
          skill,
          detail: `runtime-enforced invariant ${transition.invariantId} was ${transition.transition} without a valid unexpired waiver in contracts/invariant-waivers.json`,
          invariantId: transition.invariantId,
          transition: transition.transition,
          change: transition.detail,
        });
      }
    }
  }

  return { valid: errors.length === 0, base: resolvedBase, mergeBase: baseSha, errors, findings };
}

function parseRegistryArtifact(raw, { skill, errors }) {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    errors.push({
      code: 'INVARIANT_REGISTRY_UNREADABLE',
      skill,
      detail: 'contracts/invariants.json is not valid JSON at this revision',
    });
    return null;
  }
}

function parseArgs(argv) {
  const options = { base: null, repoRoot: process.cwd(), json: false };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base') options.base = argv[++index];
    else if (arg === '--repo') options.repoRoot = path.resolve(argv[++index]);
    else if (arg === '--json') options.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function main(argv = process.argv) {
  const options = parseArgs(argv);
  const result = checkInvariantCoverage(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    for (const finding of result.findings) {
      if (finding.transition) {
        console.log(`INFO ${finding.skill}: invariant ${finding.invariantId} ${finding.transition} (waived ${finding.waived})`);
      } else {
        console.log(`INFO ${finding.skill}: Domain Invariants changed (added ${finding.added.length}, removed ${finding.removed.length}, registryUpdated ${finding.registryUpdated})`);
      }
    }
    for (const error of result.errors) {
      console.error(`ERROR ${error.code} ${error.skill || ''} ${error.detail || ''}`.trim());
    }
    if (result.valid) {
      console.log(`Invariant coverage check passed (base ${result.base}).`);
    }
  }
  if (!result.valid) process.exit(1);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  checkInvariantCoverage,
  compareInvariantBullets,
  parseArgs,
  resolveBase,
};

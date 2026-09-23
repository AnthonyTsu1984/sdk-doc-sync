'use strict';

// Shared invariant registry contract: a per-skill `contracts/invariants.json`
// maps every machine-enforced domain rule to a stable ID, the exact SKILL.md
// statement it codifies (digest-bound), its enforcement stages, and executable
// fixtures that invoke production policy code. Prose-only rule edits break the
// statement digest, so a semantic change cannot land without updating the
// registry and its coverage.

const fs = require('node:fs');
const path = require('node:path');
const { sha256Digest } = require('./digest');

const INVARIANT_STATUSES = new Set(['runtime-enforced', 'declared']);
const ENFORCEMENT_STAGES = new Set(['evidence', 'plan', 'pre-write', 'post-write', 'reconcile', 'admission']);
const INVARIANT_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MARKER_PATTERN = /\[([a-z0-9]+(?:[.-][a-z0-9]+)*)\]\s*$/;
const DOMAIN_INVARIANTS_HEADING = /^##\s+Domain Invariants\s*$/;
const NEXT_HEADING = /^##\s+/;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeInvariantStatement(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function invariantStatementDigest(statement) {
  return sha256Digest(Buffer.from(normalizeInvariantStatement(statement), 'utf8'));
}

// Extracts the Domain Invariants bullets from SKILL.md content. Each bullet is
// returned with its trailing `[invariant.id]` marker (when present) separated
// from the normalized statement text so digests bind the prose, not the marker.
function extractDomainInvariantBullets(skillMarkdown) {
  const lines = String(skillMarkdown || '').split(/\r?\n/);
  const bullets = [];
  let inSection = false;
  for (const line of lines) {
    if (DOMAIN_INVARIANTS_HEADING.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && NEXT_HEADING.test(line)) break;
    if (!inSection) continue;
    const bulletMatch = line.match(/^\s*-\s+(.*)$/);
    if (!bulletMatch) continue;
    const raw = bulletMatch[1].trim();
    const markerMatch = raw.match(MARKER_PATTERN);
    const statement = normalizeInvariantStatement(
      markerMatch ? raw.slice(0, markerMatch.index) : raw,
    );
    bullets.push({
      marker: markerMatch ? markerMatch[1] : null,
      statement,
      statementDigest: invariantStatementDigest(statement),
    });
  }
  return bullets;
}

function validateInvariantRegistry(registry, { fixtureIds = [], repoRoot = null } = {}) {
  const errors = [];
  if (!isObject(registry) || registry.schemaVersion !== 1) {
    return { valid: false, errors: [{ code: 'INVARIANT_REGISTRY_SCHEMA_INVALID', path: '$.schemaVersion' }] };
  }
  if (typeof registry.skill !== 'string' || !registry.skill) {
    errors.push({ code: 'INVARIANT_REGISTRY_SKILL_REQUIRED', path: '$.skill' });
  }
  if (!Array.isArray(registry.invariants) || registry.invariants.length === 0) {
    errors.push({ code: 'INVARIANT_REGISTRY_ENTRIES_REQUIRED', path: '$.invariants' });
    return { valid: false, errors };
  }
  const knownFixtures = new Set(fixtureIds);
  const seenIds = new Set();
  registry.invariants.forEach((invariant, index) => {
    const invariantPath = `$.invariants[${index}]`;
    if (typeof invariant?.id !== 'string' || !INVARIANT_ID_PATTERN.test(invariant.id)) {
      errors.push({ code: 'INVARIANT_ID_INVALID', path: `${invariantPath}.id` });
    } else if (seenIds.has(invariant.id)) {
      errors.push({ code: 'INVARIANT_ID_DUPLICATE', path: `${invariantPath}.id`, id: invariant.id });
    } else {
      seenIds.add(invariant.id);
    }
    if (!Number.isInteger(invariant?.version) || invariant.version < 1) {
      errors.push({ code: 'INVARIANT_VERSION_INVALID', path: `${invariantPath}.version` });
    }
    if (typeof invariant?.risk !== 'string' || !invariant.risk) {
      errors.push({ code: 'INVARIANT_RISK_REQUIRED', path: `${invariantPath}.risk` });
    }
    if (typeof invariant?.scope !== 'string' || !invariant.scope) {
      errors.push({ code: 'INVARIANT_SCOPE_REQUIRED', path: `${invariantPath}.scope` });
    }
    if (!INVARIANT_STATUSES.has(invariant?.status)) {
      errors.push({ code: 'INVARIANT_STATUS_INVALID', path: `${invariantPath}.status` });
    }
    if (!Array.isArray(invariant?.enforcement) || invariant.enforcement.length === 0
      || invariant.enforcement.some((stage) => !ENFORCEMENT_STAGES.has(stage))) {
      errors.push({ code: 'INVARIANT_ENFORCEMENT_STAGES_INVALID', path: `${invariantPath}.enforcement` });
    }
    if (typeof invariant?.statementDigest !== 'string' || !DIGEST_PATTERN.test(invariant.statementDigest)) {
      errors.push({ code: 'INVARIANT_STATEMENT_DIGEST_INVALID', path: `${invariantPath}.statementDigest` });
    }
    if (invariant?.status === 'runtime-enforced') {
      if (!Array.isArray(invariant.fixtureIds) || invariant.fixtureIds.length === 0) {
        errors.push({ code: 'INVARIANT_FIXTURE_REQUIRED', path: `${invariantPath}.fixtureIds` });
      } else {
        for (const fixtureId of invariant.fixtureIds) {
          if (!knownFixtures.has(fixtureId)) {
            errors.push({ code: 'INVARIANT_FIXTURE_MISSING', path: `${invariantPath}.fixtureIds`, fixtureId });
          }
        }
      }
      if (!Array.isArray(invariant.enforcers) || invariant.enforcers.length === 0) {
        errors.push({ code: 'INVARIANT_ENFORCER_REQUIRED', path: `${invariantPath}.enforcers` });
      }
    }
    if (invariant?.enforcers !== undefined) {
      if (!Array.isArray(invariant.enforcers)) {
        errors.push({ code: 'INVARIANT_ENFORCER_REQUIRED', path: `${invariantPath}.enforcers` });
      } else {
        invariant.enforcers.forEach((enforcer, enforcerIndex) => {
          const enforcerPath = `${invariantPath}.enforcers[${enforcerIndex}]`;
          if (!ENFORCEMENT_STAGES.has(enforcer?.stage)) {
            errors.push({ code: 'INVARIANT_ENFORCER_STAGE_INVALID', path: `${enforcerPath}.stage` });
          }
          if (typeof enforcer?.module !== 'string' || !enforcer.module) {
            errors.push({ code: 'INVARIANT_ENFORCER_MODULE_REQUIRED', path: `${enforcerPath}.module` });
          } else if (repoRoot) {
            const resolved = path.resolve(repoRoot, enforcer.module);
            const inside = resolved.startsWith(`${path.resolve(repoRoot)}${path.sep}`);
            if (!inside || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
              errors.push({ code: 'INVARIANT_ENFORCER_MODULE_MISSING', path: `${enforcerPath}.module` });
            }
          }
          if (!Array.isArray(enforcer?.codes) || enforcer.codes.length === 0
            || enforcer.codes.some((code) => typeof code !== 'string' || !code)) {
            errors.push({ code: 'INVARIANT_ENFORCER_CODES_REQUIRED', path: `${enforcerPath}.codes` });
          }
        });
      }
    }
    if (invariant?.reference !== undefined && invariant.reference !== null) {
      if (typeof invariant.reference !== 'string' || !invariant.reference) {
        errors.push({ code: 'INVARIANT_REFERENCE_INVALID', path: `${invariantPath}.reference` });
      } else if (repoRoot) {
        const skillRelative = path.resolve(repoRoot, '.claude', 'skills', String(registry.skill || ''), invariant.reference);
        if (!fs.existsSync(skillRelative)) {
          errors.push({ code: 'INVARIANT_REFERENCE_MISSING', path: `${invariantPath}.reference` });
        }
      }
    }
  });
  errors.sort((left, right) => left.code.localeCompare(right.code) || left.path.localeCompare(right.path));
  return { valid: errors.length === 0, errors };
}

// Cross-checks a skill's SKILL.md markers against its registry. Called by
// validate:skills (fixture existence) and by the conformance runner (fixture
// execution). Skills without a registry and without markers are out of scope
// until a later phase promotes their prose rules.
function checkSkillInvariantCoverage({
  skillDir,
  repoRoot,
  fixtureIds = [],
  executedFixtureIds = null,
}) {
  const errors = [];
  const registryPath = path.join(skillDir, 'contracts', 'invariants.json');
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  const hasRegistry = fs.existsSync(registryPath);
  const skillMarkdown = fs.existsSync(skillMdPath) ? fs.readFileSync(skillMdPath, 'utf8') : '';
  const bullets = extractDomainInvariantBullets(skillMarkdown);
  const markedBullets = bullets.filter((bullet) => bullet.marker);

  if (!hasRegistry && markedBullets.length === 0) {
    return { valid: true, errors: [], bullets, registry: null, markedIds: [] };
  }
  if (!hasRegistry) {
    for (const bullet of markedBullets) {
      errors.push({ code: 'INVARIANT_REGISTRY_REQUIRED', path: '$', id: bullet.marker });
    }
    return { valid: false, errors, bullets, registry: null, markedIds: markedBullets.map((b) => b.marker) };
  }

  let registry = null;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch (error) {
    errors.push({ code: 'INVARIANT_REGISTRY_UNREADABLE', path: '$', message: error.message });
    return { valid: false, errors, bullets, registry: null, markedIds: [] };
  }
  const validation = validateInvariantRegistry(registry, { fixtureIds, repoRoot });
  errors.push(...validation.errors);

  const byId = new Map((registry.invariants || []).map((invariant) => [invariant.id, invariant]));
  const bulletsByMarker = new Map();
  for (const bullet of markedBullets) {
    if (bulletsByMarker.has(bullet.marker)) {
      errors.push({ code: 'INVARIANT_MARKER_DUPLICATE', path: '$', id: bullet.marker });
    }
    bulletsByMarker.set(bullet.marker, bullet);
  }
  for (const bullet of markedBullets) {
    const invariant = byId.get(bullet.marker);
    if (!invariant) {
      errors.push({ code: 'INVARIANT_REGISTRY_ENTRY_MISSING', path: '$', id: bullet.marker });
      continue;
    }
    if (invariant.statementDigest !== bullet.statementDigest) {
      errors.push({
        code: 'INVARIANT_STATEMENT_DIGEST_MISMATCH',
        path: '$',
        id: bullet.marker,
        expected: invariant.statementDigest,
        actual: bullet.statementDigest,
      });
    }
  }
  for (const invariant of registry.invariants || []) {
    if (!bulletsByMarker.has(invariant.id)) {
      errors.push({ code: 'INVARIANT_STATEMENT_MISSING', path: '$', id: invariant.id });
      continue;
    }
    if (invariant.status === 'runtime-enforced' && Array.isArray(executedFixtureIds)) {
      const executed = new Set(executedFixtureIds);
      for (const fixtureId of invariant.fixtureIds || []) {
        if (!executed.has(fixtureId)) {
          errors.push({ code: 'INVARIANT_FIXTURE_NOT_EXECUTED', path: '$', id: invariant.id, fixtureId });
        }
      }
    }
  }
  errors.sort((left, right) => left.code.localeCompare(right.code) || String(left.id || '').localeCompare(String(right.id || '')));
  return {
    valid: errors.length === 0,
    errors,
    bullets,
    registry,
    markedIds: markedBullets.map((bullet) => bullet.marker),
  };
}

module.exports = {
  DIGEST_PATTERN,
  ENFORCEMENT_STAGES,
  INVARIANT_STATUSES,
  checkSkillInvariantCoverage,
  extractDomainInvariantBullets,
  invariantStatementDigest,
  normalizeInvariantStatement,
  validateInvariantRegistry,
};

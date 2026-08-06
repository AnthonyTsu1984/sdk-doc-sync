'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { canonicalStringify, canonicalize } = require('./canonical-json');
const { digestSemantic } = require('./digest');

const DECISION_OUTCOMES = Object.freeze([
  'approved',
  'rejected',
  'changes_requested',
  'accepted',
  'rollback_requested',
  'rolled_back',
  'finalized',
]);

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SECRET_FIELD_PATTERN = /^(?:access[_-]?token|refresh[_-]?token|api[_-]?key|app[_-]?secret|client[_-]?secret|password|authorization|credential|secret)$/i;
const TOKEN_VALUE_PATTERN = /\b(?:sk-(?:live|proj)-|ghp_|github_pat_|xox[baprs]-|AKIA)[A-Za-z0-9_-]{12,}\b/g;

class DecisionLedgerError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = 'DecisionLedgerError';
    this.code = code;
    this.details = Object.freeze(structuredClone(details));
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function assertDigest(value, field, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (!DIGEST_PATTERN.test(value || '')) {
    throw new DecisionLedgerError('DECISION_DIGEST_INVALID', `${field} must be a sha256 digest`);
  }
}

function redactSecrets(value, key = null) {
  if (key && SECRET_FIELD_PATTERN.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return value.replace(TOKEN_VALUE_PATTERN, '[REDACTED]');
  if (Array.isArray(value)) return value.map((entry) => redactSecrets(entry));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [
    childKey,
    redactSecrets(child, childKey),
  ]));
}

function semanticProjection(event) {
  const {
    runtime: _runtime,
    decisionDigest: _decisionDigest,
    ...semantic
  } = event || {};
  return canonicalize(semantic, {
    arraySortKeys: { '$.evidence': ['type', 'digest'] },
  });
}

function semanticDecisionDigest(event) {
  return digestSemantic(semanticProjection(event), {
    arraySortKeys: { '$.evidence': ['type', 'digest'] },
  });
}

function normalizeDecisionEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DecisionLedgerError('DECISION_EVENT_INVALID', 'decision event must be an object');
  }
  for (const field of ['reviewerId', 'messageId']) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      throw new DecisionLedgerError(
        'DECISION_RUNTIME_FIELD_MISPLACED',
        `${field} belongs under the runtime envelope`,
      );
    }
  }
  const redacted = redactSecrets(structuredClone(input));
  if (redacted.schemaVersion !== 1) {
    throw new DecisionLedgerError('DECISION_SCHEMA_UNSUPPORTED', 'schemaVersion must be 1');
  }
  for (const field of ['decisionId', 'skill', 'gate']) {
    if (!nonEmptyString(redacted[field])) {
      throw new DecisionLedgerError('DECISION_FIELD_REQUIRED', `${field} is required`);
    }
  }
  if (!DECISION_OUTCOMES.includes(redacted.outcome)) {
    throw new DecisionLedgerError('DECISION_OUTCOME_INVALID', `unsupported outcome: ${redacted.outcome || '(missing)'}`);
  }
  assertDigest(redacted.proposalDigest, 'proposalDigest');
  assertDigest(redacted.resultDigest ?? null, 'resultDigest', { nullable: true });
  if (redacted.durableRuleRequested === true
      && (!redacted.scopeHint || !nonEmptyString(redacted.scopeHint.level))) {
    throw new DecisionLedgerError('DECISION_SCOPE_REQUIRED', 'durable rule requests require scopeHint.level');
  }

  const evidence = [...(redacted.evidence || [])].map((item, index) => {
    if (!item || typeof item !== 'object' || !nonEmptyString(item.type)) {
      throw new DecisionLedgerError('DECISION_EVIDENCE_INVALID', `evidence[${index}].type is required`);
    }
    assertDigest(item.digest, `evidence[${index}].digest`);
    return canonicalize(item);
  }).sort((left, right) => (
    left.type.localeCompare(right.type) || left.digest.localeCompare(right.digest)
  ));

  const normalized = canonicalize({
    schemaVersion: 1,
    decisionId: redacted.decisionId,
    skill: redacted.skill,
    gate: redacted.gate,
    outcome: redacted.outcome,
    taskId: redacted.taskId ?? null,
    sessionId: redacted.sessionId ?? null,
    reviewUnitId: redacted.reviewUnitId ?? null,
    proposalDigest: redacted.proposalDigest,
    resultDigest: redacted.resultDigest ?? null,
    instruction: redacted.instruction ?? null,
    rationale: redacted.rationale ?? null,
    durableRuleRequested: redacted.durableRuleRequested === true,
    scopeHint: redacted.scopeHint ?? null,
    evidence,
    runtime: redacted.runtime || {},
  }, {
    arraySortKeys: { '$.evidence': ['type', 'digest'] },
  });
  return Object.freeze({
    ...normalized,
    decisionDigest: semanticDecisionDigest(normalized),
  });
}

class DecisionLedger {
  constructor({ filePath }) {
    if (!nonEmptyString(filePath)) {
      throw new DecisionLedgerError('DECISION_LEDGER_PATH_REQUIRED', 'filePath is required');
    }
    this.filePath = path.resolve(filePath);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.entries = this.read();
    this.decisionIds = new Set();
    for (const entry of this.entries) {
      if (this.decisionIds.has(entry.decisionId)) {
        throw new DecisionLedgerError('DUPLICATE_DECISION_ID', `decisionId already exists: ${entry.decisionId}`);
      }
      this.decisionIds.add(entry.decisionId);
    }
  }

  read() {
    if (!fs.existsSync(this.filePath)) return [];
    const content = fs.readFileSync(this.filePath, 'utf8');
    if (content === '') return [];
    if (!content.endsWith('\n')) {
      throw new DecisionLedgerError('DECISION_LEDGER_NON_CANONICAL', 'ledger must end with one newline');
    }
    const lines = content.slice(0, -1).split('\n');
    return lines.map((line, index) => {
      if (!line) {
        throw new DecisionLedgerError('DECISION_LEDGER_NON_CANONICAL', `line ${index + 1} is blank`);
      }
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        throw new DecisionLedgerError('DECISION_LEDGER_INVALID_JSON', `line ${index + 1} is invalid JSON`, {
          cause: error.message,
        });
      }
      const normalized = normalizeDecisionEvent(parsed);
      if (canonicalStringify(normalized) !== `${line}\n`) {
        throw new DecisionLedgerError('DECISION_LEDGER_NON_CANONICAL', `line ${index + 1} is not canonical JSON`);
      }
      return normalized;
    });
  }

  append(event) {
    const normalized = normalizeDecisionEvent(event);
    if (this.decisionIds.has(normalized.decisionId)) {
      throw new DecisionLedgerError('DUPLICATE_DECISION_ID', `decisionId already exists: ${normalized.decisionId}`);
    }
    const fd = fs.openSync(this.filePath, 'a');
    try {
      fs.writeSync(fd, canonicalStringify(normalized));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    this.entries.push(normalized);
    this.decisionIds.add(normalized.decisionId);
    return normalized;
  }
}

module.exports = {
  DecisionLedger,
  DecisionLedgerError,
  normalizeDecisionEvent,
  semanticDecisionDigest,
};

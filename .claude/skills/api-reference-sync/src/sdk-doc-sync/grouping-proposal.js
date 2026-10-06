'use strict';

// Grouping-proposal governance (campaign-control hardening, 2026-10-06): the
// candidate proposal an APPROVE_GROUPING gate approves is a governed artifact,
// not a hand-assembled one. This module gives it a schema, a deterministic
// identity-coverage accounting, and digest-bound lineage to the artifacts it
// was built from (release scope, identity map, and — when record resolution
// needs it — the Bitable snapshot). The partition rule is the teeth: every
// release-scope action appears exactly once across units and exclusions, so
// the "144 PR-structure + 19 schema-first = 163" accounting becomes a machine
// check instead of a summary sentence a session types by hand. A proposal
// without lineage fields cannot be validated against its sources, and a
// tampered or stale upstream artifact breaks the digest chain.

const { digestSemantic } = require('../../../doc-ops-core/src/digest');
const { validateReleaseScope } = require('./release-scope/schema');
const fs = require('node:fs');
const path = require('node:path');

const GROUPING_PROPOSAL_SCHEMA_VERSION = 1;
const UNIT_INTENTS = new Set(['CREATE', 'UPDATE', 'DEPRECATE', 'BACKFILL', 'REBUILD', 'NO_ACTION']);
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

const GROUPING_PROPOSAL_INVALID = 'GROUPING_PROPOSAL_INVALID';
const GROUPING_PARTITION_INCOMPLETE = 'GROUPING_PARTITION_INCOMPLETE';
const GROUPING_PARTITION_FOREIGN = 'GROUPING_PARTITION_FOREIGN';
const GROUPING_PARTITION_DUPLICATE = 'GROUPING_PARTITION_DUPLICATE';
const GROUPING_LINEAGE_UNBOUND = 'GROUPING_LINEAGE_UNBOUND';
const GROUPING_SCOPE_NOT_APPROVAL_GRADE = 'GROUPING_SCOPE_NOT_APPROVAL_GRADE';
const GROUPING_AMBIGUOUS_OWNERSHIP = 'GROUPING_AMBIGUOUS_OWNERSHIP';
const GROUPING_STALE = 'GROUPING_STALE';
const GROUPING_APPROVAL_CHAIN_INVALID = 'GROUPING_APPROVAL_CHAIN_INVALID';
const GROUPING_APPROVAL_ALREADY_BOUND = 'GROUPING_APPROVAL_ALREADY_BOUND';

class GroupingProposalError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GroupingProposalError';
    this.code = code;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableSortBy(items, keyFn) {
  return [...items].sort((a, b) => keyFn(a).localeCompare(keyFn(b)));
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, stableObject(value[key])]),
  );
}

function stableGroupingProposalJson(proposal) {
  return `${JSON.stringify(stableObject(proposal), null, 2)}\n`;
}

function groupingProposalDigest(proposal) {
  return digestSemantic(proposal);
}

// Deterministic identity accounting over the scope: how many action symbols
// the identity map resolves explicitly (vs. derived fallback identities), and
// the ownership classification split. Ambiguous actions already force
// approvalGrade=false in the scout; the counts here make the blocker readable
// at the grouping gate instead of a bare refusal.
function groupingCoverage({ scope, identityMap } = {}) {
  const symbols = identityMap?.symbols && typeof identityMap.symbols === 'object' ? identityMap.symbols : {};
  const coverage = {
    actions: 0,
    identityMapped: 0,
    identityFallback: 0,
    ownership: { standalone: 0, methodOwned: 0, ambiguous: 0 },
    ambiguousSymbols: [],
  };
  for (const action of (scope?.actions || [])) {
    coverage.actions += 1;
    // Own-property only: a symbol named e.g. "constructor" must not count as
    // mapped through the prototype chain (review finding).
    if (Object.prototype.hasOwnProperty.call(symbols, action.symbol)) coverage.identityMapped += 1;
    else coverage.identityFallback += 1;
    const classification = action.documentationOwnership?.classification || 'standalone';
    if (classification === 'method_owned') coverage.ownership.methodOwned += 1;
    else if (classification === 'ambiguous') {
      coverage.ownership.ambiguous += 1;
      coverage.ambiguousSymbols.push(action.symbol);
    } else coverage.ownership.standalone += 1;
  }
  coverage.ambiguousSymbols.sort();
  return coverage;
}

// Unit/exclusion entry shape. Scope cross-checks (foreign/duplicate/missing)
// are layered on top by checkPartition when the scope is available.
function entryShapeErrors({ units = [], exclusions = [] } = {}) {
  const errors = [];
  const unitIds = new Set();
  for (const [index, unit] of units.entries()) {
    const at = `$.units[${index}]`;
    if (!isObject(unit)) {
      errors.push({ code: GROUPING_PROPOSAL_INVALID, path: at, message: 'must be an object' });
      continue;
    }
    if (typeof unit.id !== 'string' || unit.id.length === 0) {
      errors.push({ code: GROUPING_PROPOSAL_INVALID, path: `${at}.id`, message: 'must be a non-empty string' });
    } else if (unitIds.has(unit.id)) {
      errors.push({ code: GROUPING_PROPOSAL_INVALID, path: `${at}.id`, message: `duplicate unit id: ${unit.id}` });
    } else {
      unitIds.add(unit.id);
    }
    if (typeof unit.sourceStableId !== 'string' || unit.sourceStableId.length === 0) {
      errors.push({ code: GROUPING_PROPOSAL_INVALID, path: `${at}.sourceStableId`, message: 'must be a non-empty string' });
    }
    if (!UNIT_INTENTS.has(unit.actionIntent)) {
      errors.push({ code: GROUPING_PROPOSAL_INVALID, path: `${at}.actionIntent`, message: `must be one of ${[...UNIT_INTENTS].join(', ')}` });
    }
    if (!isObject(unit.decision)) {
      errors.push({ code: GROUPING_PROPOSAL_INVALID, path: `${at}.decision`, message: 'must be an object (the review payload this unit encodes)' });
    }
    if (unit.risks !== undefined && !Array.isArray(unit.risks)) {
      errors.push({ code: GROUPING_PROPOSAL_INVALID, path: `${at}.risks`, message: 'must be an array when provided' });
    }
  }
  for (const [index, exclusion] of exclusions.entries()) {
    const at = `$.exclusions[${index}]`;
    if (!isObject(exclusion)) {
      errors.push({ code: GROUPING_PROPOSAL_INVALID, path: at, message: 'must be an object' });
      continue;
    }
    if (typeof exclusion.sourceStableId !== 'string' || exclusion.sourceStableId.length === 0) {
      errors.push({ code: GROUPING_PROPOSAL_INVALID, path: `${at}.sourceStableId`, message: 'must be a non-empty string' });
    }
    if (typeof exclusion.reason !== 'string' || exclusion.reason.trim().length === 0) {
      errors.push({ code: GROUPING_PROPOSAL_INVALID, path: `${at}.reason`, message: 'must be a non-empty string (an exclusion is an explicit decision, never a silent drop)' });
    }
  }
  return errors;
}

// The partition contract: units + exclusions are exactly the scope's action
// set — nothing missing, nothing foreign, nothing twice.
function checkPartition({ scope, units = [], exclusions = [] } = {}) {
  const errors = entryShapeErrors({ units, exclusions });
  const scopeIds = new Set((scope?.actions || []).map((action) => action.stableId));
  const seen = new Map();
  for (const [kind, list] of [['unit', units], ['exclusion', exclusions]]) {
    for (const entry of list) {
      if (!isObject(entry) || typeof entry.sourceStableId !== 'string' || entry.sourceStableId.length === 0) continue;
      const id = entry.sourceStableId;
      if (!scopeIds.has(id)) {
        errors.push({
          code: GROUPING_PARTITION_FOREIGN,
          path: '$',
          message: `${kind} references stableId ${id} which is not an action of the bound release scope`,
        });
        continue;
      }
      const previous = seen.get(id);
      if (previous) {
        errors.push({
          code: GROUPING_PARTITION_DUPLICATE,
          path: '$',
          message: `stableId ${id} appears as both ${previous} and ${kind}`,
        });
      } else {
        seen.set(id, kind);
      }
    }
  }
  const missing = [...scopeIds].filter((id) => !seen.has(id)).sort();
  if (missing.length > 0) {
    errors.push({
      code: GROUPING_PARTITION_INCOMPLETE,
      path: '$',
      message: `${missing.length} release-scope action(s) are neither grouped nor excluded: ${missing.join(', ')}`,
    });
  }
  return errors;
}

function sortedUnits(units) {
  return stableSortBy(units, (unit) => `${unit.sourceStableId}:${unit.id}`);
}

function sortedExclusions(exclusions) {
  return stableSortBy(exclusions, (exclusion) => exclusion.sourceStableId);
}

// Builds the canonical proposal from governed inputs. Fail-closed: every
// refusal throws GroupingProposalError with a typed code.
function createGroupingProposal({ scope, identityMap, units = [], exclusions = [], snapshot = null } = {}) {
  if (!isObject(scope)) {
    throw new GroupingProposalError(GROUPING_PROPOSAL_INVALID, 'release scope is required');
  }
  const scopeValidation = validateReleaseScope(scope);
  if (!scopeValidation.valid) {
    throw new GroupingProposalError(
      GROUPING_PROPOSAL_INVALID,
      `release scope fails validateReleaseScope: ${JSON.stringify(scopeValidation.errors.slice(0, 5))}`,
    );
  }
  if (!isObject(identityMap) || !identityMap.symbols || typeof identityMap.symbols !== 'object') {
    throw new GroupingProposalError(GROUPING_PROPOSAL_INVALID, 'identity map with a symbols object is required');
  }
  if (scope.approvalGrade !== true) {
    throw new GroupingProposalError(
      GROUPING_SCOPE_NOT_APPROVAL_GRADE,
      `release scope ${scope.releaseRange} is not approvalGrade — resolve the scout blockers (ambiguous ownership, unverified PR surface) before grouping`,
    );
  }
  const coverage = groupingCoverage({ scope, identityMap });
  if (coverage.ownership.ambiguous > 0) {
    throw new GroupingProposalError(
      GROUPING_AMBIGUOUS_OWNERSHIP,
      `${coverage.ownership.ambiguous} action(s) carry ambiguous documentation ownership (e.g. ${coverage.ambiguousSymbols.slice(0, 5).join(', ')}) — extend the identity map before grouping`,
    );
  }
  const partitionErrors = checkPartition({ scope, units, exclusions });
  if (partitionErrors.length > 0) {
    // Partition codes outrank generic shape faults for triage: when both
    // kinds are present the typed code names the partition defect, not
    // GROUPING_PROPOSAL_INVALID (review finding — messages stay joined).
    const partitionFirst = (code) => (code.startsWith('GROUPING_PARTITION_') ? 0 : 1);
    const first = [...partitionErrors].sort((a, b) => partitionFirst(a.code) - partitionFirst(b.code))[0];
    throw new GroupingProposalError(
      first.code,
      partitionErrors.map((error) => error.message).join('; '),
    );
  }

  return {
    schemaVersion: GROUPING_PROPOSAL_SCHEMA_VERSION,
    language: scope.language,
    sdkName: scope.sdkName,
    track: scope.track,
    releaseRange: scope.releaseRange,
    baselineTag: scope.baselineTag,
    targetTag: scope.targetTag,
    targetCommit: scope.targetCommit,
    lineage: {
      scopeDigest: digestSemantic(scope),
      identityMapDigest: digestSemantic(identityMap),
      ...(snapshot ? { snapshotDigest: digestSemantic(snapshot) } : {}),
    },
    coverage: {
      actions: coverage.actions,
      units: units.length,
      excluded: exclusions.length,
      identityMapped: coverage.identityMapped,
      identityFallback: coverage.identityFallback,
      ownership: coverage.ownership,
    },
    units: sortedUnits(units),
    exclusions: sortedExclusions(exclusions),
  };
}

// Non-throwing validation for gate and CI use. Schema checks always run;
// lineage and partition cross-checks run when the upstream artifacts are
// provided — the mode a gate must use before treating a proposal as bound.
function validateGroupingProposal(proposal, { scope = null, identityMap = null, snapshot = null } = {}) {
  const errors = [];
  const report = (code, path, message) => errors.push({ code, path, message });
  if (!isObject(proposal)) {
    return { valid: false, errors: [{ code: GROUPING_PROPOSAL_INVALID, path: '$', message: 'must be an object' }] };
  }
  if (proposal.schemaVersion !== GROUPING_PROPOSAL_SCHEMA_VERSION) {
    report(GROUPING_PROPOSAL_INVALID, '$.schemaVersion', 'must be 1');
  }
  for (const key of ['language', 'sdkName', 'track', 'releaseRange', 'baselineTag', 'targetTag', 'targetCommit']) {
    if (typeof proposal[key] !== 'string' || proposal[key].length === 0) {
      report(GROUPING_PROPOSAL_INVALID, `$.${key}`, 'must be a non-empty string');
    }
  }
  if (!isObject(proposal.lineage)) {
    report(GROUPING_PROPOSAL_INVALID, '$.lineage', 'must be an object');
  } else {
    for (const key of ['scopeDigest', 'identityMapDigest']) {
      const value = proposal.lineage[key];
      if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
        report(GROUPING_PROPOSAL_INVALID, `$.lineage.${key}`, 'must be a sha256:<64-hex> digest');
      }
    }
    if (proposal.lineage.snapshotDigest !== undefined
      && (typeof proposal.lineage.snapshotDigest !== 'string' || !DIGEST_PATTERN.test(proposal.lineage.snapshotDigest))) {
      report(GROUPING_PROPOSAL_INVALID, '$.lineage.snapshotDigest', 'must be a sha256:<64-hex> digest when present');
    }
  }
  if (!isObject(proposal.coverage)) {
    report(GROUPING_PROPOSAL_INVALID, '$.coverage', 'must be an object');
  } else {
    for (const key of ['actions', 'units', 'excluded', 'identityMapped', 'identityFallback']) {
      if (!Number.isInteger(proposal.coverage[key]) || proposal.coverage[key] < 0) {
        report(GROUPING_PROPOSAL_INVALID, `$.coverage.${key}`, 'must be a non-negative integer');
      }
    }
    if (!isObject(proposal.coverage.ownership)) {
      report(GROUPING_PROPOSAL_INVALID, '$.coverage.ownership', 'must be an object');
    }
  }
  if (!Array.isArray(proposal.units)) report(GROUPING_PROPOSAL_INVALID, '$.units', 'must be an array');
  if (!Array.isArray(proposal.exclusions)) report(GROUPING_PROPOSAL_INVALID, '$.exclusions', 'must be an array');
  errors.push(...entryShapeErrors({ units: proposal.units || [], exclusions: proposal.exclusions || [] }));
  if (isObject(proposal.coverage) && Array.isArray(proposal.units) && Array.isArray(proposal.exclusions)) {
    if (proposal.coverage.units !== proposal.units.length
      || proposal.coverage.excluded !== proposal.exclusions.length
      || proposal.coverage.actions !== proposal.units.length + proposal.exclusions.length) {
      report(GROUPING_PROPOSAL_INVALID, '$.coverage', 'accounting must equal units.length + exclusions.length');
    }
  }

  if (scope) {
    if (isObject(proposal.lineage) && typeof proposal.lineage.scopeDigest === 'string') {
      if (proposal.lineage.scopeDigest !== digestSemantic(scope)) {
        report(GROUPING_LINEAGE_UNBOUND, '$.lineage.scopeDigest', 'does not match the provided release scope (stale or foreign scope)');
      }
    }
    errors.push(...checkPartition({ scope, units: proposal.units || [], exclusions: proposal.exclusions || [] }));
    const ambiguous = (scope.actions || []).filter((action) => action.documentationOwnership?.classification === 'ambiguous');
    if (ambiguous.length > 0) {
      report(GROUPING_AMBIGUOUS_OWNERSHIP, '$', `${ambiguous.length} bound-scope action(s) carry ambiguous documentation ownership`);
    }
    // The identity counts are re-derived, never trusted: a hand-edited
    // coverage block that disagrees with the bound scope and identity map is
    // a schema violation (review finding — the counts were write-only).
    if (identityMap && isObject(proposal.coverage)) {
      const recomputed = groupingCoverage({ scope, identityMap });
      if (proposal.coverage.actions !== recomputed.actions
        || proposal.coverage.identityMapped !== recomputed.identityMapped
        || proposal.coverage.identityFallback !== recomputed.identityFallback
        || !isObject(proposal.coverage.ownership)
        || proposal.coverage.ownership.standalone !== recomputed.ownership.standalone
        || proposal.coverage.ownership.methodOwned !== recomputed.ownership.methodOwned
        || proposal.coverage.ownership.ambiguous !== recomputed.ownership.ambiguous) {
        report(GROUPING_PROPOSAL_INVALID, '$.coverage', 'identity accounting does not match the bound scope and identity map');
      }
    }
  }
  if (identityMap && isObject(proposal.lineage) && typeof proposal.lineage.identityMapDigest === 'string'
    && proposal.lineage.identityMapDigest !== digestSemantic(identityMap)) {
    report(GROUPING_LINEAGE_UNBOUND, '$.lineage.identityMapDigest', 'does not match the provided identity map');
  }
  if (snapshot) {
    if (!isObject(proposal.lineage) || typeof proposal.lineage.snapshotDigest !== 'string') {
      report(GROUPING_LINEAGE_UNBOUND, '$.lineage.snapshotDigest', 'missing while a snapshot was provided for cross-check');
    } else if (proposal.lineage.snapshotDigest !== digestSemantic(snapshot)) {
      report(GROUPING_LINEAGE_UNBOUND, '$.lineage.snapshotDigest', 'does not match the provided snapshot');
    }
  }
  return { valid: errors.length === 0, errors };
}

// Durable approval receipt: the on-disk credential an APPROVE_GROUPING reply
// becomes. It embeds the proposal's lineage digests so a write boundary can
// verify the approval→scope chain WITHOUT the proposal file — paths move,
// digests do not. Never append approval fields to the proposal artifact
// itself: that changes its semantic digest and breaks the binding the
// approval expresses.
function buildGroupingApprovalReceipt({ proposal, proposalPath = null, approvedAt = new Date().toISOString() } = {}) {
  const validation = validateGroupingProposal(proposal);
  if (!validation.valid) {
    throw new GroupingProposalError(
      GROUPING_PROPOSAL_INVALID,
      `cannot build an approval receipt for a proposal that fails schema validation: ${JSON.stringify(validation.errors.slice(0, 5))}`,
    );
  }
  const digest = groupingProposalDigest(proposal);
  return {
    schemaVersion: 1,
    gate: 'APPROVE_GROUPING',
    proposalDigest: digest,
    approvalCommand: `APPROVE_GROUPING ${digest}`,
    ...(proposalPath ? { proposalPath } : {}),
    language: proposal.language,
    sdkName: proposal.sdkName,
    track: proposal.track,
    releaseRange: proposal.releaseRange,
    lineage: { ...proposal.lineage },
    approvedAt,
  };
}

function validateGroupingApprovalReceipt(receipt) {
  const errors = [];
  const report = (message) => errors.push({ code: GROUPING_APPROVAL_CHAIN_INVALID, path: '$', message });
  if (!isObject(receipt)) return { valid: false, errors: [{ code: GROUPING_APPROVAL_CHAIN_INVALID, path: '$', message: 'must be an object' }] };
  if (receipt.schemaVersion !== 1) report('$.schemaVersion must be 1');
  if (receipt.gate !== 'APPROVE_GROUPING') report('$.gate must be APPROVE_GROUPING');
  if (typeof receipt.proposalDigest !== 'string' || !DIGEST_PATTERN.test(receipt.proposalDigest)) {
    report('$.proposalDigest must be a sha256:<64-hex> digest');
  }
  if (receipt.approvalCommand !== `APPROVE_GROUPING ${receipt.proposalDigest}`) {
    report('$.approvalCommand must be exactly "APPROVE_GROUPING <proposalDigest>"');
  }
  if (!isObject(receipt.lineage)
    || typeof receipt.lineage.scopeDigest !== 'string'
    || !DIGEST_PATTERN.test(receipt.lineage.scopeDigest || '')) {
    report('$.lineage.scopeDigest must be a sha256:<64-hex> digest (the receipt must bind the approved scope)');
  }
  if (receipt.lineage && typeof receipt.lineage.identityMapDigest === 'string'
    && !DIGEST_PATTERN.test(receipt.lineage.identityMapDigest)) {
    report('$.lineage.identityMapDigest must be a sha256:<64-hex> digest when present');
  }
  for (const key of ['language', 'sdkName', 'track', 'approvedAt']) {
    if (typeof receipt[key] !== 'string' || receipt[key].length === 0) report(`$.${key} must be a non-empty string`);
  }
  return { valid: errors.length === 0, errors };
}

// The write-boundary chain check (api.grouping-proposal-staleness,
// runtime-enforced): a bound campaign executes only the release scope its
// grouping approval covers. The approval side is a receipt (file or session
// block — same shape); the scope side is the parsed --release-scope.
// Fail-closed on shape, GROUPING_STALE on any digest or identity drift.
function checkGroupingScopeChain({ approval, scope } = {}) {
  const validation = validateGroupingApprovalReceipt(approval);
  if (!validation.valid) {
    throw new GroupingProposalError(
      GROUPING_APPROVAL_CHAIN_INVALID,
      `grouping approval is malformed: ${validation.errors.map((error) => error.message).join('; ')}`,
    );
  }
  if (!isObject(scope)) {
    throw new GroupingProposalError(GROUPING_APPROVAL_CHAIN_INVALID, 'a grouping approval is bound but no release scope was presented to chain against');
  }
  const scopeDigest = digestSemantic(scope);
  if (approval.lineage.scopeDigest !== scopeDigest) {
    throw new GroupingProposalError(
      GROUPING_STALE,
      `the presented release scope (${scope.releaseRange || '?'}, digest ${scopeDigest}) is not the scope the grouping approval covers (${approval.lineage.scopeDigest}) — re-run the grouping gate for this scope`,
    );
  }
  if (approval.language !== scope.language || approval.sdkName !== scope.sdkName || approval.track !== scope.track) {
    throw new GroupingProposalError(
      GROUPING_APPROVAL_CHAIN_INVALID,
      `grouping approval identity (${approval.language}/${approval.sdkName}/${approval.track}) does not match the scope (${scope.language}/${scope.sdkName}/${scope.track})`,
    );
  }
  return { proposalDigest: approval.proposalDigest, scopeDigest };
}

// First-write-wins receipt persistence (the first approval time is the
// truth). Returns whether this call created the file.
function writeGroupingApprovalReceipt({ receipt, approvalsDir }) {
  const receiptPath = path.join(approvalsDir, `${receipt.proposalDigest}.json`);
  if (fs.existsSync(receiptPath)) return { receiptPath, created: false };
  fs.mkdirSync(approvalsDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { receiptPath, created: true };
}

module.exports = {
  GROUPING_PROPOSAL_SCHEMA_VERSION,
  GROUPING_PROPOSAL_INVALID,
  GROUPING_PARTITION_INCOMPLETE,
  GROUPING_PARTITION_FOREIGN,
  GROUPING_PARTITION_DUPLICATE,
  GROUPING_LINEAGE_UNBOUND,
  GROUPING_SCOPE_NOT_APPROVAL_GRADE,
  GROUPING_AMBIGUOUS_OWNERSHIP,
  GROUPING_STALE,
  GROUPING_APPROVAL_CHAIN_INVALID,
  GROUPING_APPROVAL_ALREADY_BOUND,
  GroupingProposalError,
  createGroupingProposal,
  validateGroupingProposal,
  groupingCoverage,
  stableGroupingProposalJson,
  groupingProposalDigest,
  buildGroupingApprovalReceipt,
  validateGroupingApprovalReceipt,
  checkGroupingScopeChain,
  writeGroupingApprovalReceipt,
};

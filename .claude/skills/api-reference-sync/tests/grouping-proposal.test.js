'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { createReleaseScope } = require('../src/sdk-doc-sync/release-scope/schema');
const { digestSemantic } = require('../../doc-ops-core/src/digest');
const {
  createGroupingProposal,
  validateGroupingProposal,
  groupingCoverage,
  groupingProposalDigest,
  stableGroupingProposalJson,
  GroupingProposalError,
} = require('../src/sdk-doc-sync/grouping-proposal');
const { ScoutIdentityMapError, loadIdentityMap } = require('../src/sdk-doc-sync/release-scope/identity-normalizer');
const { formatFatal } = require('../bin/sdk-release-scout');

function makeAction(stableId, symbol, overrides = {}) {
  return {
    type: 'UPDATE',
    stableId,
    symbol,
    reason: 'symbol changed in release range',
    source: { file: 'client/example.go', line: 12 },
    ...overrides,
  };
}

function makeScope(actions, { approvalGrade = true } = {}) {
  return createReleaseScope({
    language: 'go',
    sdkName: 'milvus',
    track: 'v3.0.x',
    baselineTag: 'client/v3.0.0',
    targetTag: 'client/v3.0.1',
    targetCommit: '0123456789abcdef0123456789abcdef01234567',
    targetDate: '2026-10-05',
    actions,
    approvalGrade,
  });
}

function makeIdentityMap(symbols = {}) {
  return {
    schemaVersion: 1,
    language: 'go',
    track: 'v3.0.x',
    defaultCategory: 'Client',
    symbols,
  };
}

const scopeActions = [
  makeAction('go:Client:search', 'Client.search'),
  makeAction('go:Client:flush', 'Client.flush'),
];

function happyDecisions() {
  return {
    units: [{
      id: 'go:Client:search',
      sourceStableId: 'go:Client:search',
      actionIntent: 'UPDATE',
      decision: { structure: 'pr-structure', polish: 'verbatim-then-polish' },
    }],
    exclusions: [{
      sourceStableId: 'go:Client:flush',
      reason: 'internal helper, no documentation surface',
    }],
  };
}

function refusalCode(fn) {
  try {
    fn();
  } catch (error) {
    if (error instanceof GroupingProposalError) return error.code;
    throw error;
  }
  return null;
}

test('createGroupingProposal builds a lineage-bound proposal with coverage accounting', () => {
  const scope = makeScope(scopeActions);
  const identityMap = makeIdentityMap({ 'Client.search': { stableId: 'go:Client:search', canonicalSlug: 'Client-search', category: 'Client' } });
  const { units, exclusions } = happyDecisions();

  const proposal = createGroupingProposal({ scope, identityMap, units, exclusions });

  assert.equal(proposal.schemaVersion, 1);
  assert.equal(proposal.lineage.scopeDigest, digestSemantic(scope));
  assert.equal(proposal.lineage.identityMapDigest, digestSemantic(identityMap));
  assert.equal(proposal.lineage.snapshotDigest, undefined);
  assert.deepEqual(proposal.coverage, {
    actions: 2,
    units: 1,
    excluded: 1,
    identityMapped: 1,
    identityFallback: 1,
    ownership: { standalone: 2, methodOwned: 0, ambiguous: 0 },
  });
  assert.equal(proposal.units[0].sourceStableId, 'go:Client:search');
  assert.equal(proposal.exclusions[0].sourceStableId, 'go:Client:flush');
  assert.match(groupingProposalDigest(proposal), /^sha256:[0-9a-f]{64}$/);

  // Stable serialization is order-independent and reproducible.
  const reshuffled = createGroupingProposal({
    scope,
    identityMap,
    units: [...units].reverse(),
    exclusions: [...exclusions].reverse(),
  });
  assert.equal(stableGroupingProposalJson(proposal), stableGroupingProposalJson(reshuffled));
});

test('createGroupingProposal refuses a non-approval-grade scope', () => {
  const scope = makeScope(scopeActions, { approvalGrade: false });
  const identityMap = makeIdentityMap();
  assert.equal(
    refusalCode(() => createGroupingProposal({ scope, identityMap, ...happyDecisions() })),
    'GROUPING_SCOPE_NOT_APPROVAL_GRADE',
  );
});

test('createGroupingProposal refuses ambiguous documentation ownership', () => {
  const scope = makeScope([
    makeAction('go:Client:search', 'Client.search'),
    makeAction('go:NewType', 'NewType', { documentationOwnership: { classification: 'ambiguous' } }),
  ]);
  const identityMap = makeIdentityMap();
  assert.equal(
    refusalCode(() => createGroupingProposal({
      scope,
      identityMap,
      units: [{ id: 'u1', sourceStableId: 'go:Client:search', actionIntent: 'UPDATE', decision: {} }],
      exclusions: [
        { sourceStableId: 'go:NewType', reason: 'not documented' },
      ],
    })),
    'GROUPING_AMBIGUOUS_OWNERSHIP',
  );
});

test('createGroupingProposal refuses an incomplete partition', () => {
  const scope = makeScope(scopeActions);
  const identityMap = makeIdentityMap();
  const decisions = happyDecisions();
  delete decisions.exclusions;
  assert.equal(
    refusalCode(() => createGroupingProposal({ scope, identityMap, ...decisions })),
    'GROUPING_PARTITION_INCOMPLETE',
  );
});

test('createGroupingProposal refuses foreign and duplicate partition entries', () => {
  const scope = makeScope(scopeActions);
  const identityMap = makeIdentityMap();

  const foreign = refusalCode(() => createGroupingProposal({
    scope,
    identityMap,
    units: [
      { id: 'u1', sourceStableId: 'go:Client:search', actionIntent: 'UPDATE', decision: {} },
      { id: 'u2', sourceStableId: 'go:Client:ghost', actionIntent: 'CREATE', decision: {} },
    ],
    exclusions: [{ sourceStableId: 'go:Client:flush', reason: 'internal' }],
  }));
  assert.equal(foreign, 'GROUPING_PARTITION_FOREIGN');

  const duplicate = refusalCode(() => createGroupingProposal({
    scope,
    identityMap,
    units: [{ id: 'u1', sourceStableId: 'go:Client:search', actionIntent: 'UPDATE', decision: {} }],
    exclusions: [
      { sourceStableId: 'go:Client:flush', reason: 'internal' },
      { sourceStableId: 'go:Client:search', reason: 'also excluded' },
    ],
  }));
  assert.equal(duplicate, 'GROUPING_PARTITION_DUPLICATE');
});

test('createGroupingProposal refuses an invalid release scope and missing identity map', () => {
  const broken = makeScope(scopeActions);
  delete broken.targetCommit;
  assert.equal(
    refusalCode(() => createGroupingProposal({ scope: broken, identityMap: makeIdentityMap(), ...happyDecisions() })),
    'GROUPING_PROPOSAL_INVALID',
  );
  assert.equal(
    refusalCode(() => createGroupingProposal({ scope: makeScope(scopeActions), identityMap: { symbols: null }, ...happyDecisions() })),
    'GROUPING_PROPOSAL_INVALID',
  );
});

test('validateGroupingProposal cross-checks lineage digests against the upstream artifacts', () => {
  const scope = makeScope(scopeActions);
  const identityMap = makeIdentityMap();
  const proposal = createGroupingProposal({ scope, identityMap, ...happyDecisions() });

  assert.equal(validateGroupingProposal(proposal, { scope, identityMap }).valid, true);

  const tampered = structuredClone(proposal);
  tampered.lineage.scopeDigest = 'sha256:' + '0'.repeat(64);
  const unbound = validateGroupingProposal(tampered, { scope, identityMap });
  assert.equal(unbound.valid, false);
  assert.ok(unbound.errors.some((error) => error.code === 'GROUPING_LINEAGE_UNBOUND'));

  const driftedMap = validateGroupingProposal(proposal, { scope, identityMap: makeIdentityMap({ extra: 1 }) });
  assert.ok(driftedMap.errors.some((error) => error.code === 'GROUPING_LINEAGE_UNBOUND'));

  const snapshot = { rows: [{ slug: 'Client-search' }] };
  const missingSnapshot = validateGroupingProposal(proposal, { scope, identityMap, snapshot });
  assert.ok(missingSnapshot.errors.some((error) => error.code === 'GROUPING_LINEAGE_UNBOUND'));

  const withSnapshot = createGroupingProposal({ scope, identityMap, snapshot, ...happyDecisions() });
  assert.equal(validateGroupingProposal(withSnapshot, { scope, identityMap, snapshot }).valid, true);
});

test('validateGroupingProposal refuses accounting drift and bad shapes', () => {
  const scope = makeScope(scopeActions);
  const identityMap = makeIdentityMap();
  const proposal = createGroupingProposal({ scope, identityMap, ...happyDecisions() });

  const drifted = structuredClone(proposal);
  drifted.coverage.units = 7;
  const accounting = validateGroupingProposal(drifted);
  assert.ok(accounting.errors.some((error) => error.code === 'GROUPING_PROPOSAL_INVALID' && error.path === '$.coverage'));

  const handMade = { schemaVersion: 1, language: 'go', units: [{ id: 'x' }] };
  const invalid = validateGroupingProposal(handMade);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.length >= 5);

  const partition = validateGroupingProposal(proposal, { scope: makeScope([
    makeAction('go:Client:search', 'Client.search'),
    makeAction('go:Client:flush', 'Client.flush'),
    makeAction('go:Client:extra', 'Client.extra'),
  ]), identityMap });
  assert.ok(partition.errors.some((error) => error.code === 'GROUPING_PARTITION_INCOMPLETE'));
});

test('groupingCoverage counts mapped, fallback, and ambiguous symbols', () => {
  const scope = makeScope([
    makeAction('go:Client:search', 'Client.search'),
    makeAction('go:NewType', 'NewType', { documentationOwnership: { classification: 'ambiguous' } }),
    makeAction('go:Client:close', 'Client.close', {
      type: 'UPDATE',
      documentationOwnership: { classification: 'method_owned', owners: [{ stableId: 'go:Client:close', canonicalSlug: 'Client-close', category: 'Client' }], selectedOwnerStableId: 'go:Client:close' },
    }),
  ]);
  const coverage = groupingCoverage({ scope, identityMap: makeIdentityMap({ 'Client.search': {} }) });
  assert.deepEqual(coverage, {
    actions: 3,
    identityMapped: 1,
    identityFallback: 2,
    ownership: { standalone: 1, methodOwned: 1, ambiguous: 1 },
    ambiguousSymbols: ['NewType'],
  });
});

test('loadIdentityMap fails with typed scout blockers', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-map-blocker-'));
  const missing = path.join(temp, 'go-v30.json');
  assert.throws(() => loadIdentityMap(missing), (error) => error instanceof ScoutIdentityMapError
    && error.code === 'SCOUT_IDENTITY_MAP_MISSING'
    && /identity-reconcile\.js --emit-draft/.test(error.message));

  const malformed = path.join(temp, 'malformed.json');
  fs.writeFileSync(malformed, '{oops');
  assert.throws(() => loadIdentityMap(malformed), (error) => error instanceof ScoutIdentityMapError
    && error.code === 'SCOUT_IDENTITY_MAP_INVALID');

  const wrongSchema = path.join(temp, 'wrong.json');
  fs.writeFileSync(wrongSchema, JSON.stringify({ schemaVersion: 2, language: 'go', track: 'v3.0.x', symbols: {} }));
  assert.throws(() => loadIdentityMap(wrongSchema), (error) => error.code === 'SCOUT_IDENTITY_MAP_INVALID');

  const valid = path.join(temp, 'valid.json');
  fs.writeFileSync(valid, JSON.stringify(makeIdentityMap()));
  assert.equal(loadIdentityMap(valid).track, 'v3.0.x');
});

test('formatFatal prefixes typed codes and falls back for plain errors', () => {
  assert.equal(formatFatal(new ScoutIdentityMapError('SCOUT_IDENTITY_MAP_MISSING', 'no map')), 'SCOUT_IDENTITY_MAP_MISSING: no map');
  assert.equal(formatFatal(new Error('boom')), 'Fatal error: boom');
});

test('record-grouping-approval writes a digest-keyed durable receipt, idempotently', () => {
  const recorder = path.join(__dirname, '..', 'scripts', 'record-grouping-approval.js');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'grouping-approval-'));
  const scope = makeScope(scopeActions);
  const identityMap = makeIdentityMap();
  const proposal = createGroupingProposal({ scope, identityMap, ...happyDecisions() });
  const proposalFile = path.join(temp, 'proposal.json');
  fs.writeFileSync(proposalFile, stableGroupingProposalJson(proposal));
  const approvalsDir = path.join(temp, 'approvals');

  const first = spawnSync(process.execPath, [
    recorder, '--proposal', proposalFile, '--approvals-dir', approvalsDir,
  ], { encoding: 'utf8' });
  assert.equal(first.status, 0, `recorder failed: ${first.stderr}`);
  const digest = groupingProposalDigest(proposal);
  const receiptPath = path.join(approvalsDir, `${digest}.json`);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.gate, 'APPROVE_GROUPING');
  assert.equal(receipt.proposalDigest, digest);
  assert.equal(receipt.approvalCommand, `APPROVE_GROUPING ${digest}`);
  assert.ok(receipt.approvedAt);

  // First-write-wins: the original approvedAt survives a re-record.
  const again = spawnSync(process.execPath, [
    recorder, '--proposal', proposalFile, '--approvals-dir', approvalsDir,
  ], { encoding: 'utf8' });
  assert.equal(again.status, 0);
  assert.match(again.stdout, /already recorded/);
  assert.equal(JSON.parse(fs.readFileSync(receiptPath, 'utf8')).approvedAt, receipt.approvedAt);

  // A schema-invalid (hand-assembled) proposal never receives a receipt.
  const handmade = path.join(temp, 'handmade.json');
  fs.writeFileSync(handmade, JSON.stringify({ schemaVersion: 1, units: [] }));
  const refused = spawnSync(process.execPath, [
    recorder, '--proposal', handmade, '--approvals-dir', approvalsDir,
  ], { encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /GROUPING_APPROVAL_INVALID/);
});

test('build-grouping-proposal CLI builds, refuses, and writes nothing on refusal', () => {
  const builder = path.join(__dirname, '..', 'scripts', 'build-grouping-proposal.js');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'grouping-builder-'));
  const scopeFile = path.join(temp, 'scope.json');
  const mapFile = path.join(temp, 'map.json');
  const decisionsFile = path.join(temp, 'decisions.json');
  const outputFile = path.join(temp, 'proposal.json');
  const scope = makeScope(scopeActions);
  const identityMap = makeIdentityMap();
  fs.writeFileSync(scopeFile, JSON.stringify(scope));
  fs.writeFileSync(mapFile, JSON.stringify(identityMap));
  fs.writeFileSync(decisionsFile, JSON.stringify(happyDecisions()));

  const built = spawnSync(process.execPath, [
    builder, '--scope', scopeFile, '--identity-map', mapFile, '--decisions', decisionsFile, '--output', outputFile,
  ], { encoding: 'utf8' });
  assert.equal(built.status, 0, `builder failed: ${built.stderr}`);
  const written = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
  assert.equal(written.lineage.scopeDigest, digestSemantic(scope));
  assert.match(built.stdout, /digest sha256:[0-9a-f]{64}/);

  const refusedFile = path.join(temp, 'refused.json');
  const incomplete = happyDecisions();
  delete incomplete.exclusions;
  const incompleteFile = path.join(temp, 'incomplete.json');
  fs.writeFileSync(incompleteFile, JSON.stringify(incomplete));
  const refused = spawnSync(process.execPath, [
    builder, '--scope', scopeFile, '--identity-map', mapFile, '--decisions', incompleteFile, '--output', refusedFile,
  ], { encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /GROUPING_PARTITION_INCOMPLETE/);
  assert.equal(fs.existsSync(refusedFile), false, 'a refused build must write nothing');
});

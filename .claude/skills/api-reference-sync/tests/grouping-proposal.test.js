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
  buildGroupingApprovalReceipt,
  validateGroupingApprovalReceipt,
  checkGroupingScopeChain,
  GroupingProposalError,
} = require('../src/sdk-doc-sync/grouping-proposal');
const {
  createReviewSession,
  loadReviewSessionState,
  recordGroupingApproval,
  saveReviewSession,
} = require('../src/sdk-doc-sync/review-session-store');
const { ScoutIdentityMapError, loadIdentityMap } = require('../src/sdk-doc-sync/release-scope/identity-normalizer');
const { formatFatal } = require('../bin/sdk-release-scout');
const { runCli: runDocSyncCli } = require('../bin/sdk-doc-sync');

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

  // Review round 1: non-object roots and directory paths type too — the raw
  // TypeError crash class this blocker replaces.
  const nullRoot = path.join(temp, 'null.json');
  fs.writeFileSync(nullRoot, 'null');
  assert.throws(() => loadIdentityMap(nullRoot), (error) => error instanceof ScoutIdentityMapError
    && error.code === 'SCOUT_IDENTITY_MAP_INVALID');
  assert.throws(() => loadIdentityMap(temp), (error) => error.code === 'SCOUT_IDENTITY_MAP_INVALID'
    && /directory/.test(error.message));

  const valid = path.join(temp, 'valid.json');
  fs.writeFileSync(valid, JSON.stringify(makeIdentityMap()));
  assert.equal(loadIdentityMap(valid).track, 'v3.0.x');
});

test('coverage accounting is re-derived at validation and immune to prototype-chain lookups', () => {
  const scope = makeScope(scopeActions);
  const identityMap = makeIdentityMap();
  const proposal = createGroupingProposal({ scope, identityMap, ...happyDecisions() });

  // Hand-edited identity counts refuse even with the artifacts provided.
  const drifted = structuredClone(proposal);
  drifted.coverage.identityMapped = 2;
  drifted.coverage.identityFallback = 0;
  const validation = validateGroupingProposal(drifted, { scope, identityMap });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === 'GROUPING_PROPOSAL_INVALID' && error.path === '$.coverage'));

  // A symbol named "constructor" does not count as mapped on an empty map.
  const protoScope = makeScope([makeAction('go:Client:constructor', 'Client.constructor')]);
  const protoProposal = createGroupingProposal({
    scope: protoScope,
    identityMap,
    units: [{ id: 'u1', sourceStableId: 'go:Client:constructor', actionIntent: 'UPDATE', decision: {} }],
    exclusions: [],
  });
  assert.equal(protoProposal.coverage.identityMapped, 0);
  assert.equal(protoProposal.coverage.identityFallback, 1);
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

test('buildGroupingApprovalReceipt embeds lineage and refuses invalid proposals', () => {
  const scope = makeScope(scopeActions);
  const identityMap = makeIdentityMap();
  const proposal = createGroupingProposal({ scope, identityMap, ...happyDecisions() });

  const receipt = buildGroupingApprovalReceipt({ proposal, proposalPath: '/tmp/proposal.json', approvedAt: '2026-10-06T00:00:00.000Z' });
  assert.equal(receipt.gate, 'APPROVE_GROUPING');
  assert.equal(receipt.proposalDigest, groupingProposalDigest(proposal));
  assert.equal(receipt.approvalCommand, `APPROVE_GROUPING ${receipt.proposalDigest}`);
  assert.equal(receipt.lineage.scopeDigest, digestSemantic(scope));
  assert.equal(receipt.lineage.identityMapDigest, digestSemantic(identityMap));
  assert.equal(validateGroupingApprovalReceipt(receipt).valid, true);

  // Tampering any binding field invalidates the receipt.
  const tamperedCommand = structuredClone(receipt);
  tamperedCommand.approvalCommand = 'APPROVE_GROUPING sha256:deadbeef';
  assert.equal(validateGroupingApprovalReceipt(tamperedCommand).valid, false);
  const noLineage = structuredClone(receipt);
  delete noLineage.lineage;
  assert.equal(validateGroupingApprovalReceipt(noLineage).valid, false);

  assert.throws(() => buildGroupingApprovalReceipt({ proposal: { schemaVersion: 1, units: [] } }),
    (error) => error instanceof GroupingProposalError && error.code === 'GROUPING_PROPOSAL_INVALID');
});

test('checkGroupingScopeChain refuses stale scopes and identity drift', () => {
  const scope = makeScope(scopeActions);
  const identityMap = makeIdentityMap();
  const proposal = createGroupingProposal({ scope, identityMap, ...happyDecisions() });
  const receipt = buildGroupingApprovalReceipt({ proposal });

  assert.deepEqual(
    checkGroupingScopeChain({ approval: receipt, scope }),
    { proposalDigest: receipt.proposalDigest, scopeDigest: digestSemantic(scope) },
  );

  const stale = makeScope([makeAction('go:Client:search', 'Client.search'), makeAction('go:Client:other', 'Client.other')]);
  assert.throws(() => checkGroupingScopeChain({ approval: receipt, scope: stale }),
    (error) => error.code === 'GROUPING_STALE');

  // Identity drift alone cannot pass the digest check (the digest covers the
  // identity fields), so the second guard is proven with a hand-corrupted
  // receipt: scopeDigest re-pointed at a foreign-track scope while the
  // approval identity still names the original track.
  const foreignTrack = structuredClone(scope);
  foreignTrack.track = 'v2.6.x';
  const corrupted = structuredClone(receipt);
  corrupted.lineage.scopeDigest = digestSemantic(foreignTrack);
  assert.throws(() => checkGroupingScopeChain({ approval: corrupted, scope: foreignTrack }),
    (error) => error.code === 'GROUPING_APPROVAL_CHAIN_INVALID');

  assert.throws(() => checkGroupingScopeChain({ approval: receipt, scope: null }),
    (error) => error.code === 'GROUPING_APPROVAL_CHAIN_INVALID');
  assert.throws(() => checkGroupingScopeChain({ approval: { gate: 'APPROVE_WRITES' }, scope }),
    (error) => error.code === 'GROUPING_APPROVAL_CHAIN_INVALID');
});

test('recordGroupingApproval binds one-shot and refuses conflicting re-binds', () => {
  const scope = makeScope(scopeActions);
  const identityMap = makeIdentityMap();
  const proposal = createGroupingProposal({ scope, identityMap, ...happyDecisions() });
  const receipt = buildGroupingApprovalReceipt({ proposal });

  const session = createReviewSession({
    sessionId: 'test:go:milvus:v3.0.x:abc',
    language: 'go',
    sdkName: 'milvus',
    track: 'v3.0.x',
    reviewUnitManifest: { manifestDigest: 'sha256:' + '1'.repeat(64), units: [] },
  });
  const bound = recordGroupingApproval(session, receipt);
  assert.equal(bound.groupingApproval.proposalDigest, receipt.proposalDigest);
  // Same digest: idempotent.
  assert.equal(recordGroupingApproval(bound, receipt), bound);
  // Different proposal: one-shot refusal.
  const otherScope = makeScope([makeAction('go:Client:search', 'Client.search'), makeAction('go:Client:x', 'Client.x')]);
  const otherProposal = createGroupingProposal({
    scope: otherScope,
    identityMap,
    units: [{ id: 'u1', sourceStableId: 'go:Client:search', actionIntent: 'UPDATE', decision: {} }],
    exclusions: [{ sourceStableId: 'go:Client:x', reason: 'internal' }],
  });
  assert.throws(() => recordGroupingApproval(bound, buildGroupingApprovalReceipt({ proposal: otherProposal })),
    (error) => error.code === 'GROUPING_APPROVAL_ALREADY_BOUND');

  // A malformed receipt never binds, and a persisted session carrying one
  // refuses at load.
  assert.throws(() => recordGroupingApproval(session, { gate: 'APPROVE_GROUPING' }),
    (error) => error.code === 'GROUPING_APPROVAL_CHAIN_INVALID');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'grouping-session-'));
  const sessionPath = path.join(temp, 'session.json');
  const corrupt = { ...bound, groupingApproval: { gate: 'APPROVE_GROUPING', proposalDigest: 'nope' } };
  saveReviewSession(sessionPath, corrupt, { expectedPreviousDigest: null });
  assert.throws(() => loadReviewSessionState(sessionPath), /groupingApproval/);
});

test('sdk-review-session approve-grouping binds the receipt and enforces the scope chain', () => {
  const cli = path.join(__dirname, '..', 'bin', 'sdk-review-session.js');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'approve-grouping-'));
  const scope = makeScope(scopeActions);
  const identityMap = makeIdentityMap();
  const proposal = createGroupingProposal({ scope, identityMap, ...happyDecisions() });
  const proposalFile = path.join(temp, 'proposal.json');
  fs.writeFileSync(proposalFile, stableGroupingProposalJson(proposal));

  const scopeFile = path.join(temp, 'scope.json');
  fs.writeFileSync(scopeFile, JSON.stringify(scope));
  const session = createReviewSession({
    sessionId: 'test:go:milvus:v3.0.x:def',
    language: 'go',
    sdkName: 'milvus',
    track: 'v3.0.x',
    reviewUnitManifest: { manifestDigest: 'sha256:' + '2'.repeat(64), units: [] },
    artifacts: { releaseScope: scopeFile },
  });
  const sessionPath = path.join(temp, 'session.json');
  saveReviewSession(sessionPath, session, { expectedPreviousDigest: null });
  const approvalsDir = path.join(temp, 'approvals');

  const bound = spawnSync(process.execPath, [
    cli, 'approve-grouping', '--session', sessionPath, '--proposal', proposalFile, '--approvals-dir', approvalsDir,
  ], { encoding: 'utf8' });
  assert.equal(bound.status, 0, `approve-grouping failed: ${bound.stderr}`);
  const persisted = loadReviewSessionState(sessionPath).session;
  const digest = groupingProposalDigest(proposal);
  assert.equal(persisted.groupingApproval.proposalDigest, digest);
  assert.ok(fs.existsSync(path.join(approvalsDir, `${digest}.json`)));

  // Same proposal again: idempotent.
  const again = spawnSync(process.execPath, [
    cli, 'approve-grouping', '--session', sessionPath, '--proposal', proposalFile, '--approvals-dir', approvalsDir,
  ], { encoding: 'utf8' });
  assert.equal(again.status, 0);

  // A different proposal against the same session: one-shot refusal. The
  // proposal covers the SAME scope with a different partition, so the bind-
  // time chain check passes and the one-shot guard fires.
  const otherProposal = createGroupingProposal({
    scope,
    identityMap,
    units: [{ id: 'u1', sourceStableId: 'go:Client:flush', actionIntent: 'BACKFILL', decision: {} }],
    exclusions: [{ sourceStableId: 'go:Client:search', reason: 're-partitioned' }],
  });
  const otherFile = path.join(temp, 'other.json');
  fs.writeFileSync(otherFile, stableGroupingProposalJson(otherProposal));
  const conflicted = spawnSync(process.execPath, [
    cli, 'approve-grouping', '--session', sessionPath, '--proposal', otherFile, '--approvals-dir', approvalsDir,
  ], { encoding: 'utf8' });
  assert.equal(conflicted.status, 1);
  assert.match(conflicted.stderr, /GROUPING_APPROVAL_ALREADY_BOUND/);

  // Chain check at bind time: a proposal for a DIFFERENT scope than the
  // session's recorded scope artifact refuses GROUPING_STALE.
  const foreignScope = makeScope([makeAction('go:Client:search', 'Client.search'), makeAction('go:Client:y', 'Client.y')]);
  const foreignProposal = createGroupingProposal({
    scope: foreignScope,
    identityMap,
    units: [{ id: 'u1', sourceStableId: 'go:Client:search', actionIntent: 'UPDATE', decision: {} }],
    exclusions: [{ sourceStableId: 'go:Client:y', reason: 'internal' }],
  });
  const foreignFile = path.join(temp, 'foreign.json');
  fs.writeFileSync(foreignFile, stableGroupingProposalJson(foreignProposal));
  const session2Path = path.join(temp, 'session2.json');
  saveReviewSession(session2Path, createReviewSession({
    sessionId: 'test:go:milvus:v3.0.x:ghi',
    language: 'go',
    sdkName: 'milvus',
    track: 'v3.0.x',
    reviewUnitManifest: { manifestDigest: 'sha256:' + '3'.repeat(64), units: [] },
    artifacts: { releaseScope: scopeFile },
  }), { expectedPreviousDigest: null });
  const stale = spawnSync(process.execPath, [
    cli, 'approve-grouping', '--session', session2Path, '--proposal', foreignFile, '--approvals-dir', approvalsDir,
  ], { encoding: 'utf8' });
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /GROUPING_STALE/);
});

test('sdk-doc-sync refuses unchained grouping approvals at every entry', async () => {
  const scope = makeScope(scopeActions);
  const identityMap = makeIdentityMap();
  const proposal = createGroupingProposal({ scope, identityMap, ...happyDecisions() });
  const receipt = buildGroupingApprovalReceipt({ proposal });
  const staleScope = makeScope([makeAction('go:Client:search', 'Client.search'), makeAction('go:Client:z', 'Client.z')]);

  const run = async ({ releaseScope, groupingApproval, resumeSession }) => {
    const stderr = [];
    let exitCode = 0;
    const result = await runDocSyncCli({
      argv: [
        'node', 'sdk-doc-sync',
        '--sdk-dir', '/fixtures/sdk',
        '--language', 'go',
        '--sdk-name', 'milvus',
        '--sdk-version', 'v3.0.x',
        '--dry-run',
        ...(releaseScope ? ['--release-scope', releaseScope] : []),
        ...(groupingApproval ? ['--grouping-approval', groupingApproval] : []),
        ...(resumeSession ? ['--resume-session', resumeSession] : []),
      ],
      env: {},
      dependencies: {
        loadEnv: false,
        onStderr: (line) => stderr.push(line),
        exit: (code) => { exitCode = code; },
      },
    });
    return { result, stderr: stderr.join('\n'), exitCode };
  };

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'docsync-chain-'));
  const scopeFile = path.join(temp, 'scope.json');
  fs.writeFileSync(scopeFile, JSON.stringify(scope));
  const staleFile = path.join(temp, 'stale.json');
  fs.writeFileSync(staleFile, JSON.stringify(staleScope));
  const receiptFile = path.join(temp, 'receipt.json');
  fs.writeFileSync(receiptFile, JSON.stringify(receipt));

  // Stale scope against the bound receipt.
  const staleRun = await run({ releaseScope: staleFile, groupingApproval: receiptFile });
  assert.equal(staleRun.result, null);
  assert.equal(staleRun.exitCode, 1);
  assert.match(staleRun.stderr, /GROUPING_STALE/);

  // Bound but no scope presented.
  const noScope = await run({ groupingApproval: receiptFile });
  assert.equal(noScope.exitCode, 1);
  assert.match(noScope.stderr, /GROUPING_APPROVAL_CHAIN_INVALID/);

  // Matching chain passes the grouping gate (the run then stops at the
  // ordinary BASE_TOKEN precondition, proving the binding did not fire).
  const chained = await run({ releaseScope: scopeFile, groupingApproval: receiptFile });
  assert.match(chained.stderr, /BASE_TOKEN/);
  assert.doesNotMatch(chained.stderr, /GROUPING/);

  // A resumed session carrying groupingApproval enforces the same chain.
  const sessionPath = path.join(temp, 'session.json');
  saveReviewSession(sessionPath, createReviewSession({
    sessionId: 'test:go:milvus:v3.0.x:jkl',
    language: 'go',
    sdkName: 'milvus',
    track: 'v3.0.x',
    reviewUnitManifest: { manifestDigest: 'sha256:' + '4'.repeat(64), units: [] },
    groupingApproval: receipt,
  }), { expectedPreviousDigest: null });
  const resumedStale = await run({ releaseScope: staleFile, resumeSession: sessionPath });
  assert.equal(resumedStale.exitCode, 1);
  assert.match(resumedStale.stderr, /GROUPING_STALE/);
  const resumedOk = await run({ releaseScope: scopeFile, resumeSession: sessionPath });
  assert.match(resumedOk.stderr, /BASE_TOKEN|REVIEW_SESSION_REFERENCE_CONTEXT_REQUIRED|review session/);
  assert.doesNotMatch(resumedOk.stderr, /GROUPING_STALE/);
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

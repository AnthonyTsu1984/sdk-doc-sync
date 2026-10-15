'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPlacementAudit,
  parseAdjacentBitable,
  parseArgs,
  parseBitableTarget,
  resolveRegistryContext,
  walkArtifact,
} = require('../scripts/build-current-placement-audit');

test('placement audit CLI parses adjacent Bitable targets', () => {
  assert.deepEqual(parseAdjacentBitable('v2.6.x:base-v26'), {
    version: 'v2.6.x',
    baseToken: 'base-v26',
    tableId: null,
  });
  assert.deepEqual(parseAdjacentBitable('v2.6.x:base-v26:table-1'), {
    version: 'v2.6.x',
    baseToken: 'base-v26',
    tableId: 'table-1',
  });
  assert.throws(() => parseAdjacentBitable('base-only'), /--adjacent-bitable/);
  assert.deepEqual(parseBitableTarget('base-v30'), { baseToken: 'base-v30', tableId: null });
  assert.throws(() => parseBitableTarget('a:b:c'), /Bitable target/);
});

test('placement audit CLI accepts registry arguments and repeatable track flags', () => {
  const args = parseArgs([
    'node', 'build-current-placement-audit.js',
    '--proposal', '/tmp/proposal.json',
    '--version', 'v3.0.x',
    '--output', '/tmp/audit.json',
    '--language', 'cpp',
    '--registry', '/tmp/registry.json',
    '--adjacent-bitable', 'v2.6.x:base-v26',
    '--adjacent-bitable', 'v2.5.x:base-v25:table-2',
    '--required-track', 'v2.6.x',
    '--required-track', 'v2.5.x',
  ]);
  assert.equal(args.language, 'cpp');
  assert.equal(args.registry, '/tmp/registry.json');
  assert.equal(args.versionRoot, undefined);
  assert.deepEqual(args.adjacentBitables, ['v2.6.x:base-v26', 'v2.5.x:base-v25:table-2']);
  assert.deepEqual(args.requiredTracks, ['v2.6.x', 'v2.5.x']);

  assert.throws(
    () => parseArgs(['node', 'script', '--proposal', 'p.json', '--version', 'v3.0.x']),
    /Missing --output/,
  );
});

test('registry context resolves cpp release roots and full cross-track enumeration', () => {
  const resolved = resolveRegistryContext({
    args: { language: 'cpp' },
    version: 'v3.0.x',
  });

  assert.deepEqual(resolved.targetBitable, {
    version: 'v3.0.x',
    baseToken: 'QdLkbfmnFatl4TsThKDc5Dobn5g',
    tableId: null,
  });
  assert.equal(resolved.targetRoot, 'NVjgfJr5aleBsedDoKCcDpnJn9b');
  // Only older tracks can physically hold inherited documents.
  assert.deepEqual(resolved.sourceVersionRoots, [{
    version: 'v2.6.x',
    rootToken: 'CSzVfDgfAlne87dDj3vcnR3nnsg',
  }]);
  // Every other track is enumerated for record pointers in both directions.
  assert.deepEqual(resolved.adjacentBitables, [{
    version: 'v2.6.x',
    baseToken: 'XmndbkxkQaigA8soRiCcTT41nMd',
    tableId: null,
  }]);
  // The registry is the independent source of the required coverage set.
  assert.deepEqual(resolved.requiredTrackVersions, ['v2.6.x', 'v3.0.x']);
});

test('registry context resolves the older cpp track without newer-tree roots', () => {
  const resolved = resolveRegistryContext({
    args: { language: 'cpp' },
    version: 'v2.6.x',
  });

  assert.equal(resolved.targetRoot, 'CSzVfDgfAlne87dDj3vcnR3nnsg');
  assert.deepEqual(resolved.sourceVersionRoots, []);
  assert.deepEqual(
    resolved.adjacentBitables.map((track) => track.version),
    ['v3.0.x'],
  );
  // The newer track can hold records pointing at unchanged v2.6 documents, so
  // it is required coverage even though it holds no inherited source roots.
  assert.deepEqual(resolved.requiredTrackVersions, ['v2.6.x', 'v3.0.x']);
});

test('registry context fails closed for unregistered tracks', () => {
  assert.throws(
    () => resolveRegistryContext({ args: { language: 'cpp' }, version: 'v9.9.x' }),
    (error) => error.code === 'TRACK_REGISTRY_TRACK_NOT_REGISTERED',
  );
  assert.throws(
    () => resolveRegistryContext({ args: { language: 'rust' }, version: 'v9.9.x' }),
    (error) => error.code === 'TRACK_REGISTRY_TRACK_NOT_REGISTERED',
  );
});

test('registry context resolves rust dual-track from the committed registry', () => {
  const resolved = resolveRegistryContext({ args: { language: 'rust' }, version: 'v3.0.x' });
  assert.equal(resolved.targetRoot, 'XiM3fDXSBldV2IdN0r9cXCe6nqw');
  // The v2.6.x tree is the inheritance source root and the adjacent Bitable.
  assert.deepEqual(resolved.sourceVersionRoots, [{
    version: 'v2.6.x',
    rootToken: 'NnYMfAqtJlzJ8zdwpiNcJOuGnF9',
  }]);
  assert.deepEqual(resolved.adjacentBitables, [{
    version: 'v2.6.x',
    baseToken: 'HmCmbiQEcawJzxszPj1cBH7Gnwd',
    tableId: null,
  }]);
  assert.deepEqual(resolved.requiredTrackVersions, ['v2.6.x', 'v3.0.x']);
});

// --- --dump-walk (campaign-control batch 15 §5.3) ---
// go's intake was forced to hand-roll walk-version-root.js because the
// canonical audit consumed indexVersionRoot internally without ever emitting
// the walk shape its composer needed. The --dump-walk flag now rides the
// audit's own walk out.

test('placement audit CLI accepts --dump-walk alongside the required flags', () => {
  const args = parseArgs([
    'node', 'build-current-placement-audit.js',
    '--proposal', '/tmp/proposal.json',
    '--version', 'v3.0.x',
    '--output', '/tmp/audit.json',
    '--dump-walk', '/tmp/root-walk.json',
  ]);
  assert.equal(args.dumpWalk, '/tmp/root-walk.json');
});

test('walkArtifact emits the go walk-version-root artifact shape, deterministically ordered', () => {
  const byToken = new Map([
    ['tokDoc', { token: 'tokDoc', type: 'docx', parentFolderToken: 'tokFolder', ancestors: ['tokRoot', 'tokFolder'], name: 'Get() page' }],
    ['tokFolder', { token: 'tokFolder', type: 'folder', parentFolderToken: 'tokRoot', ancestors: ['tokRoot'], name: 'Client' }],
    ['tokRoot', { token: 'tokRoot', type: 'folder', parentFolderToken: null, ancestors: [], name: 'v3.0.x' }],
  ]);
  const artifact = walkArtifact({ rootToken: 'tokRoot', byToken, walkedAt: '2026-10-15T00:00:00.000Z' });

  // Key order and shape match the go intake artifact exactly.
  assert.deepEqual(Object.keys(artifact), ['walkedAt', 'rootToken', 'nodeCount', 'folderCount', 'nodes', 'writesPerformed']);
  assert.equal(artifact.rootToken, 'tokRoot');
  assert.equal(artifact.nodeCount, 3);
  assert.equal(artifact.folderCount, 2);
  assert.equal(artifact.writesPerformed, false);
  assert.deepEqual(artifact.nodes.map((node) => node.name), ['v3.0.x', 'Client', 'Get() page']);
  // Ancestor chains are self-inclusive, the shape folderChain consumers expect.
  assert.deepEqual(artifact.nodes[2], {
    token: 'tokDoc',
    type: 'docx',
    name: 'Get() page',
    parentFolderToken: 'tokFolder',
    ancestors: ['tokRoot', 'tokFolder', 'tokDoc'],
  });
  // Byte determinism: same index, same bytes (module object order is stable).
  const again = walkArtifact({ rootToken: 'tokRoot', byToken, walkedAt: '2026-10-15T00:00:00.000Z' });
  assert.deepEqual(again, artifact);
});

test('walkArtifact refuses a call without a root token or index', () => {
  assert.throws(() => walkArtifact({ byToken: new Map() }), /rootToken/);
  assert.throws(() => walkArtifact({ rootToken: 'r', byToken: [] }), /byToken Map/);
});

function feishuRecord(recordId, docToken) {
  return { record_id: recordId, fields: { Docs: [{ link: `https://example.feishu.cn/docx/${docToken}` }] } };
}

test('buildPlacementAudit hands the target root walk (never source roots) to the --dump-walk sink', async () => {
  const targetIndex = new Map([
    ['folderCat', { token: 'folderCat', type: 'folder', parentFolderToken: 'rootT', ancestors: ['rootT'], name: 'Client' }],
    ['docTokenX', { token: 'docTokenX', type: 'docx', parentFolderToken: 'folderCat', ancestors: ['rootT', 'folderCat'], name: 'NewInstance()' }],
  ]);
  const sourceIndex = new Map([
    ['docTokenY', { token: 'docTokenY', type: 'docx', parentFolderToken: 'rootS', ancestors: ['rootS'], name: 'Old page' }],
  ]);
  const proposal = {
    proposals: [{
      id: 'p1',
      docIdentity: { stableId: 'go:Client:NewInstance', canonicalSlug: 'Client-NewInstance', title: 'NewInstance()', targetFolderToken: 'folderCat' },
      existingBitable: {
        status: 'matched',
        recordId: 'recA',
        currentDocumentToken: 'docTokenX',
        parentRecordIds: ['recParent'],
      },
    }],
  };

  const walkedRoots = [];
  const artifact = await buildPlacementAudit({
    proposal,
    version: 'v3.0.x',
    versionRootToken: 'rootT',
    sourceVersionRoots: [{ version: 'v2.6.x', rootToken: 'rootS' }],
    indexer: async (rootToken) => (rootToken === 'rootT' ? targetIndex : sourceIndex),
    trackBitables: [
      { version: 'v3.0.x', baseToken: 'baseT' },
      { version: 'v2.6.x', baseToken: 'baseS' },
    ],
    recordLister: async ({ version }) => (version === 'v3.0.x' ? [feishuRecord('recA', 'docTokenX')] : [feishuRecord('recOld', 'docTokenY')]),
    collectedAt: '2026-10-15T00:00:00.000Z',
    targetWalkSink: ({ rootToken, byToken }) => walkedRoots.push({ rootToken, byToken }),
  });

  // Exactly one sink call: the target root, holding the target index.
  assert.equal(walkedRoots.length, 1);
  assert.equal(walkedRoots[0].rootToken, 'rootT');
  assert.equal(walkedRoots[0].byToken.get('docTokenX').name, 'NewInstance()');
  assert.equal(walkedRoots[0].byToken.has('docTokenY'), false);

  // The audit artifact contract is unchanged by the sink's presence.
  assert.equal(artifact.schemaVersion, 3);
  assert.equal(artifact.status, 'placement_audit_ready');
  assert.equal(artifact.inheritanceEvidenceStatus, 'evidence_complete');
  assert.equal(artifact.writesPerformed, false);
  assert.equal(artifact.entries.length, 1);
  assert.equal(artifact.entries[0].placement.folderToken, 'folderCat');
  assert.equal(artifact.entries[0].sharedToken.status, 'unshared');

  // The sink's index round-trips through walkArtifact into the go shape.
  const walkJson = walkArtifact({ rootToken: walkedRoots[0].rootToken, byToken: walkedRoots[0].byToken, walkedAt: artifact.collectedAt });
  assert.equal(walkJson.nodeCount, 2);
  assert.equal(walkJson.folderCount, 1);
  assert.deepEqual(walkJson.nodes.map((node) => node.name), ['Client', 'NewInstance()']);
});

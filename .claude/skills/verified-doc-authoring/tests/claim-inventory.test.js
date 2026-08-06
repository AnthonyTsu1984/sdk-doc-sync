'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const schema = require('../contracts/claim-inventory.schema.json');
const { buildClaimInventory, buildDraftArtifact } = require('../src/claim-inventory');

function claims() {
  return [
    {
      claimId: 'claim:create-endpoint',
      text: 'Create uses POST /v2/vectordb/collections/create.',
      sourceLocator: { type: 'local-source', path: 'internal/http/handler_v2.go', symbol: 'createCollection' },
      apiShapeEvidence: [{ type: 'route', locator: 'handler_v2.go:POST /v2/vectordb/collections/create' }],
      behavioralEvidence: [{ type: 'service-call', locator: 'proxy.CreateCollection' }],
      status: 'verified',
      notes: 'Public route and downstream call agree.',
    },
    {
      claimId: 'claim:rollout-state',
      text: 'The feature is enabled for every account.',
      sourceLocator: { type: 'reference', path: 'product-note.md', symbol: null },
      apiShapeEvidence: [],
      behavioralEvidence: [],
      status: 'needs-verification',
      notes: 'Account rollout policy is not present in source.',
    },
  ];
}

test('claim inventory is deterministic and draft semantic identity binds its digest', () => {
  assert.equal(schema.title, 'Verified Doc Authoring Claim Inventory');
  const inventory = buildClaimInventory({
    inventoryId: 'claims:collection-guide:1',
    target: { kind: 'existing', documentId: 'doc-1' },
    claims: claims(),
  });
  const reordered = buildClaimInventory({
    inventoryId: 'claims:collection-guide:1',
    target: { kind: 'existing', documentId: 'doc-1' },
    claims: claims().reverse(),
  });
  assert.equal(inventory.inventoryDigest, reordered.inventoryDigest);
  const draft = buildDraftArtifact({
    markdown: '# Create a collection\n\nNeeds further verification: account rollout state.\n',
    claimInventory: inventory,
    visibleUnresolvedClaimIds: ['claim:rollout-state'],
  });
  assert.equal(draft.claimInventoryDigest, inventory.inventoryDigest);
  assert.match(draft.markdownDigest, /^sha256:/);
  assert.match(draft.semanticDigest, /^sha256:/);
});

test('claim inventory rejects duplicate IDs and incomplete evidence fields', () => {
  assert.throws(() => buildClaimInventory({
    inventoryId: 'claims:bad',
    target: { kind: 'draft-only' },
    claims: [claims()[0], claims()[0]],
  }), /duplicate/i);
  assert.throws(() => buildClaimInventory({
    inventoryId: 'claims:bad',
    target: { kind: 'draft-only' },
    claims: [{ ...claims()[0], behavioralEvidence: undefined }],
  }), /behavioralEvidence/);
});

test('draft artifact requires every unresolved or contradicted claim to remain visible', () => {
  const inventory = buildClaimInventory({
    inventoryId: 'claims:collection-guide:2',
    target: { kind: 'existing', documentId: 'doc-1' },
    claims: [...claims(), { ...claims()[0], claimId: 'claim:old-default', status: 'contradicted' }],
  });
  assert.throws(() => buildDraftArtifact({
    markdown: '# Draft\n',
    claimInventory: inventory,
    visibleUnresolvedClaimIds: ['claim:rollout-state'],
  }), /claim:old-default/);
});

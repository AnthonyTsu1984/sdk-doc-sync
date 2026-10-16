'use strict';
// The content-wave target-directory rule (2026-10-16 operator ruling), pinned:
// our structure governs (R1a-R1e), an inherited pointer is the normal sparse-delta
// state and never a copy destination (R2), and a create parent outside the version
// root is refused (R3).
const test = require('node:test');
const assert = require('node:assert/strict');
const { BINDINGS, RULES, resolveTargets, applyToDecisions } = require('../scripts/resolve-content-targets');

const ROOT = 'rootToken00000000';

function fixture() {
  const walk = {
    rootToken: ROOT,
    nodes: [
      { token: ROOT, type: 'folder', name: 'v3.0.x', parentFolderToken: null },
      { token: 'mcFolder00000000', type: 'folder', name: 'MilvusClient', parentFolderToken: ROOT },
      { token: 'collFolder000000', type: 'folder', name: 'Collections', parentFolderToken: 'mcFolder00000000' },
      { token: 'csFolder00000000', type: 'folder', name: 'CollectionSchema', parentFolderToken: 'mcFolder00000000' },
      { token: 'ormBranch0000000', type: 'folder', name: 'ORM', parentFolderToken: null },
      { token: 'utilFolder000000', type: 'folder', name: 'utility', parentFolderToken: 'ormBranch0000000' },
      { token: 'docInTrack000000', type: 'docx', name: 'describe_collection()', parentFolderToken: 'collFolder000000' },
      { token: 'docClassPage0000', type: 'docx', name: 'CollectionSchema', parentFolderToken: 'csFolder00000000' },
    ],
  };
  const snapshot = {
    rows: [
      { recordId: 'recLive', slug: 'MilvusClient-CollectionSchema', type: 'Class', docLink: 'https://host/docx/docClassPage0000' },
      { recordId: 'recLegacy', slug: 'MilvusClient-EmbeddingList', type: 'Class', docLink: 'https://host/docx/docLegacy0000000' },
    ],
  };
  const unit = (stableId, slug, category, docToken) => ({
    id: `proposal:${stableId}`,
    sourceStableId: stableId,
    actionIntent: 'UPDATE',
    decision: {
      docIdentity: { stableId, canonicalSlug: slug, category, title: slug },
      existingBitable: { status: 'present', recordId: `rec-${slug}`, currentDocumentToken: docToken },
    },
  });
  const decisions = {
    notes: [],
    units: [
      unit('python:Collections:describe_collection', 'Collections-describe_collection', 'Collections', 'docInTrack000000'),
      unit('python:MilvusClient:CollectionSchema', 'MilvusClient-CollectionSchema', 'MilvusClient', 'docClassPage0000'),
      unit('python:utility:delete_user', 'utility-delete_user', 'utility', 'docOtherVersion00'),
      unit('python:EmbeddingList:add', 'EmbeddingList-add', 'EmbeddingList', 'docOtherVersion01'),
    ],
  };
  const categoryCreates = {
    tracks: {
      'v3.0.x': {
        versionRootToken: ROOT,
        categories: [{
          category: 'EmbeddingList',
          units: ['python:EmbeddingList:add'],
          folder: {
            ref: 'res:folder-EmbeddingList',
            name: 'EmbeddingList',
            parentFolderToken: 'mcFolder00000000',
            parentAncestry: [ROOT, 'mcFolder00000000'],
          },
          repoint: null,
        }],
      },
    },
  };
  return { walk, snapshot, decisions, categoryCreates };
}

test('R1a: an in-track document is updated where it is — the family folder never overrides it', () => {
  const { walk, snapshot, decisions, categoryCreates } = fixture();
  const out = resolveTargets({ walk, snapshot, decisions, categoryCreates, track: 'v3.0.x' });
  const bySlug = new Map(out.rows.map((row) => [row.canonicalSlug, row]));
  const describe = bySlug.get('Collections-describe_collection');
  assert.equal(describe.rule, RULES.LIVE_PARENT_FOLDER, 'in-place, not a move into the family folder');
  assert.equal(describe.targetFolderToken, 'collFolder000000');
  assert.equal(describe.binding, BINDINGS.IN_TRACK);
  const classPage = bySlug.get('MilvusClient-CollectionSchema');
  assert.equal(classPage.targetFolderToken, 'csFolder00000000', 'the class page keeps the folder its document lives in');
  assert.equal(out.inTrack, 2, 'described page + class page live in this track');
});

test('R1e: no folder, no in-track document, no landing folder and no contract blocks the unit', () => {
  const { walk, snapshot, decisions } = fixture();
  // CollectionSchema has a folder of its own in this walk, so use the case where
  // the family folder is absent: EmbeddingList has only the Class landing page.
  const out = resolveTargets({ walk, snapshot, decisions, categoryCreates: null, track: 'v3.0.x' });
  const embedding = out.rows.find((row) => row.canonicalSlug === 'EmbeddingList-add');
  assert.equal(embedding.rule, RULES.BLOCKED, 'no folder, no in-track doc, no landing folder in this fixture');
  assert.equal(embedding.binding, BINDINGS.INHERITED);
});

test('R1d + R3: a create parent inside the root is accepted; outside the root is refused (kernel rule)', () => {
  const { walk, snapshot, decisions, categoryCreates } = fixture();
  const out = resolveTargets({ walk, snapshot, decisions, categoryCreates, track: 'v3.0.x' });
  const embedding = out.rows.find((row) => row.canonicalSlug === 'EmbeddingList-add');
  assert.equal(embedding.rule, RULES.CATEGORY_CREATE);
  assert.equal(embedding.folderRef, 'res:folder-EmbeddingList');
  assert.equal(out.createNeeded.length, 1);
  assert.equal(out.createNeeded[0].category, 'EmbeddingList');

  const withOrmCreate = {
    tracks: {
      'v3.0.x': {
        versionRootToken: ROOT,
        categories: [{
          category: 'utility',
          units: ['python:utility:delete_user'],
          folder: { ref: 'res:folder-utility', name: 'utility', parentFolderToken: 'ormBranch0000000', parentAncestry: ['ormBranch0000000'] },
          repoint: null,
        }],
      },
    },
  };
  const orm = resolveTargets({ walk, snapshot, decisions, categoryCreates: withOrmCreate, track: 'v3.0.x' });
  assert.equal(orm.blocked.length, 2, 'utility (out-of-root create) and EmbeddingList-add (contract removed) are both blocked');
  assert.match(orm.blocked.find((entry) => entry.category === 'utility').reason, /TREE_DELTA_TARGET_OUTSIDE_VERSION_ROOT/);
});

test('R2: an inherited pointer is recorded as such and never becomes a copy destination', () => {
  const { walk, snapshot, decisions } = fixture();
  const out = resolveTargets({ walk, snapshot, decisions, categoryCreates: null, track: 'v3.0.x' });
  const utility = out.rows.find((row) => row.canonicalSlug === 'utility-delete_user');
  assert.equal(utility.binding, BINDINGS.INHERITED);
  assert.equal(utility.sourceIsOtherVersion, true, 'the source document lives outside this track');
  assert.equal(utility.targetFolderToken, null, 'its family folder is out of root, so it is not a destination');
  assert.equal(utility.rule, RULES.BLOCKED);
  assert.equal(out.inherited, 2);
  assert.equal(out.blocked.length, 2, 'the out-of-root family folder (utility) and the contract-less unit (EmbeddingList) are both reported');
  assert.match(out.blocked.find((entry) => entry.canonicalSlug === 'utility-delete_user').reason, /TREE_DELTA_TARGET_OUTSIDE_VERSION_ROOT/);
});

test('applyToDecisions rewrites targets and records the binding/rule', () => {
  const { walk, snapshot, decisions, categoryCreates } = fixture();
  const out = resolveTargets({ walk, snapshot, decisions, categoryCreates, track: 'v3.0.x' });
  const changed = applyToDecisions(decisions, out);
  assert.equal(changed, 2, 'the two in-track/out-of-track tokens change; the folderRef unit keeps a null token');
  const describe = decisions.units.find((u) => u.sourceStableId === 'python:Collections:describe_collection');
  assert.equal(describe.decision.docIdentity.targetFolderToken, 'collFolder000000');
  assert.equal(describe.decision.docIdentity.binding, BINDINGS.IN_TRACK);
  assert.equal(describe.decision.docIdentity.targetRule, RULES.LIVE_PARENT_FOLDER, 'in-place: its document already lives in this track');
  const classPage = decisions.units.find((u) => u.sourceStableId === 'python:MilvusClient:CollectionSchema');
  assert.equal(classPage.decision.docIdentity.targetFolderToken, 'csFolder00000000');
  const embedding = decisions.units.find((u) => u.sourceStableId === 'python:EmbeddingList:add');
  assert.equal(embedding.decision.docIdentity.targetFolderRef, 'res:folder-EmbeddingList');
  assert.equal(embedding.decision.docIdentity.targetFolderStatus, 'to-create (category-create plan)');
  assert.equal(decisions.notes.length, 1);
  assert.match(decisions.notes[0], /inherited binding/);
});

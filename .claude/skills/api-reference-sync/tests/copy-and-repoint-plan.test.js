'use strict';
// COPY-AND-REPOINT as a scripted strategy: the script owns the whole order
// (create directory -> copy -> content patch/rewrite -> repoint -> verify) and
// refuses malformed payloads before any step is emitted. The model authors only
// the content payload.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ACTIONS, buildStrategy } = require('../scripts/copy-and-repoint-plan');

const ROOT = 'rootToken00000000';
const base = () => ({
  unit: { stableId: 'python:Database:use_database', canonicalSlug: 'Database-use_database' },
  source: {
    recordId: 'recSource',
    documentToken: 'docSource000000',
    version: 'v2.6.x',
    folderToken: 'oldFolder000000',
    versionRootToken: 'oldRoot000000000',
  },
  target: { version: 'v3.0.x', versionRootToken: ROOT, folderToken: 'existingFolder0' },
  content: { mode: 'patch', operations: [{ op: 'replace_text', anchor: 'This operation', replacement: 'This operation' }] },
});

test('a copy into an existing directory is copy -> patch -> verify (no folder create, no repoint)', () => {
  const plan = buildStrategy(base());
  assert.deepEqual(plan.steps.map((s) => s.action), [
    ACTIONS.COPY_PATCH_AND_REPOINT,
    ACTIONS.VERIFY_TREE_DELTA,
  ]);
  assert.equal(plan.contentMode, 'patch');
  assert.equal(plan.steps[0].metadata.copyBeforePatch, true);
  assert.equal(plan.steps[0].copySource.documentToken, 'docSource000000');
  assert.equal(plan.steps[0].target.folderToken, 'existingFolder0');
  assert.match(plan.strategyDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(plan.writesPerformed, false);
});

test('a missing directory makes the script create it first and repoint the VirtualNode last', () => {
  const payload = base();
  delete payload.target.folderToken;
  payload.target.folderRef = 'res:folder-Database';
  payload.target.folder = {
    ref: 'res:folder-Database',
    name: 'Database',
    parentFolderToken: 'mcFolder00000000',
    parentAncestry: [ROOT, 'mcFolder00000000'],
    existingLookup: { checked: true, absent: true },
  };
  payload.target.repoint = {
    ref: 'res:repoint-Database',
    recordId: 'recuA1SRTlr3w2',
    title: 'Database',
    currentFolderToken: 'JT0gfXjE3lCqEAdn6jPcFbHgnnd',
    expectedFields: { Type: 'VirtualNode', Slug: 'MilvusClient-Database' },
    baseToken: 'baseToken',
    tableId: 'tableId',
  };
  const plan = buildStrategy(payload);
  assert.deepEqual(plan.steps.map((s) => s.action), [
    ACTIONS.CREATE_FOLDER,
    ACTIONS.COPY_PATCH_AND_REPOINT,
    ACTIONS.REPOINT_CATEGORY_VIRTUAL_NODE,
    ACTIONS.VERIFY_TREE_DELTA,
  ]);
  const [create, copy, repoint] = plan.steps;
  assert.equal(create.resource.parentAncestry[0], ROOT);
  assert.equal(copy.target.folderRef, 'res:folder-Database');
  assert.deepEqual(copy.dependsOn, ['res:folder-Database'], 'the copy waits for the directory');
  assert.deepEqual(repoint.dependsOn, ['res:folder-Database', 'python:Database:use_database'], 'the repoint waits for the directory AND the document');
  assert.equal(repoint.resource.folderRef, 'res:folder-Database');
  assert.equal(repoint.resource.currentFolderToken, 'JT0gfXjE3lCqEAdn6jPcFbHgnnd');
});

test('rewrite mode carries the full body instead of patch operations', () => {
  const payload = base();
  payload.content = { mode: 'rewrite', markdown: '# use_database()\n\nThis operation ...\n' };
  const plan = buildStrategy(payload);
  assert.equal(plan.contentMode, 'rewrite');
  assert.equal(plan.steps[0].content.mode, 'rewrite');
  assert.match(plan.steps[0].content.markdown, /^# use_database/);
  assert.equal(plan.steps[0].content.operations, undefined);
});

test('malformed payloads are refused before any step is emitted', () => {
  const cases = [
    [{ ...base(), content: undefined }, 'STRATEGY_CONTENT_MODE_REQUIRED'],
    [{ ...base(), content: { mode: 'patch' } }, 'STRATEGY_CONTENT_EMPTY'],
    [{ ...base(), content: { mode: 'rewrite' } }, 'STRATEGY_CONTENT_EMPTY'],
    [{ ...base(), content: { mode: 'patch', operations: [{ op: 'x' }], markdown: 'y' } }, 'STRATEGY_CONTENT_AMBIGUOUS'],
    [{ ...base(), source: undefined }, 'STRATEGY_SOURCE_REQUIRED'],
    [{ ...base(), unit: undefined }, 'STRATEGY_UNIT_REQUIRED'],
    [{ ...base(), target: { version: 'v3.0.x', versionRootToken: ROOT } }, 'STRATEGY_TARGET_PLACEMENT_UNKNOWN'],
  ];
  for (const [payload, code] of cases) {
    assert.throws(() => buildStrategy(payload), (error) => error.code === code, `${code} expected`);
  }

  const outOfRoot = base();
  delete outOfRoot.target.folderToken;
  outOfRoot.target.folderRef = 'res:folder-utility';
  outOfRoot.target.folder = {
    ref: 'res:folder-utility',
    name: 'utility',
    parentFolderToken: 'ormBranch0000000',
    parentAncestry: ['ormBranch0000000'],
  };
  assert.throws(() => buildStrategy(outOfRoot), (error) => error.code === 'STRATEGY_CREATE_PARENT_OUTSIDE_VERSION_ROOT');

  const repointWithoutBitable = base();
  delete repointWithoutBitable.target.folderToken;
  repointWithoutBitable.target.folderRef = 'res:folder-Database';
  repointWithoutBitable.target.folder = { ref: 'res:folder-Database', name: 'Database', parentFolderToken: 'mcFolder00000000', parentAncestry: [ROOT, 'mcFolder00000000'] };
  repointWithoutBitable.target.repoint = { ref: 'res:repoint-Database', recordId: 'rec1', currentFolderToken: 'tok1' };
  assert.throws(() => buildStrategy(repointWithoutBitable), (error) => error.code === 'STRATEGY_REPOINT_BITABLE_TARGET_REQUIRED');
});

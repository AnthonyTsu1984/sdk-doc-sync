'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const SyncPlanner = require('../src/sdk-doc-sync/sync-planner');
const SdkDocSync = require('../src/sdk-doc-sync');

function artifact(content = '# Reviewed documentation\n') {
  return {
    content,
    reviewed: true,
    validation: { valid: true },
  };
}

function updateAction(overrides = {}) {
  return {
    type: 'UPDATE',
    slug: 'Collections-createCollection',
    reason: 'description changed',
    symbol: {
      name: 'createCollection',
      identity: { stableId: 'node:Collections:createCollection' },
    },
    doc: {
      id: 'rec-v26',
      metadata: {
        token: 'doc-v26',
        version: 'v2.6.x',
        folderToken: 'collections-v26',
        parentRecordId: 'parent-v26',
      },
    },
    ...overrides,
  };
}

function planningContext(overrides = {}) {
  return {
    artifact: artifact(),
    target: {
      version: 'v2.6.x',
      parentRecordId: 'parent-v26',
      folderToken: 'collections-v26',
      versionRootToken: 'root-v26',
      ancestryVerified: true,
    },
    current: {
      version: 'v2.6.x',
      recordId: 'rec-v26',
      documentToken: 'doc-v26',
      folderToken: 'collections-v26',
      parentRecordId: 'parent-v26',
      ancestryVerified: true,
      placementVerified: true,
    },
    copySource: {
      documentToken: 'doc-v26',
      link: 'https://docs.example/docx/doc-v26',
      title: 'createCollection()',
    },
    existingRecordLookup: {
      checked: true,
      absent: true,
      baseToken: 'base-v26',
      tableId: 'table-v26',
      parentRecordId: 'parent-v26',
      criteria: {
        canonicalSlug: 'Collections-createCollection',
        title: 'createCollection()',
      },
    },
    tokenReferencedByOlderVersions: false,
    ...overrides,
  };
}

function condition(plan, type) {
  return plan.preconditions.find((entry) => entry.type === type);
}

test('SyncPlanner plans CREATE from reviewed validated content with an exact SHA-256 digest', () => {
  const planner = new SyncPlanner();
  const reviewed = artifact('alpha\r\nbeta\n');
  const plan = planner.planAction({
    type: 'CREATE',
    slug: 'Collections-createCollection',
    symbol: { identity: { stableId: 'node:Collections:createCollection' } },
    doc: null,
    reason: 'new symbol',
  }, planningContext({ artifact: reviewed, current: null }));

  const expected = crypto.createHash('sha256').update(Buffer.from(reviewed.content, 'utf8')).digest('hex');
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.action, 'CREATE');
  assert.equal(plan.stableId, 'node:Collections:createCollection');
  assert.equal(plan.artifactDigest, `sha256:${expected}`);
  assert.deepEqual(plan.source, {
    version: null, recordId: null, documentToken: null, folderToken: null,
  });
  assert.deepEqual(plan.target, {
    version: 'v2.6.x',
    parentRecordId: 'parent-v26',
    folderToken: 'collections-v26',
    versionRootToken: 'root-v26',
  });
  assert.deepEqual(condition(plan, 'CURRENT_RECORD'), { type: 'CURRENT_RECORD', expected: 'ABSENT' });
  assert.deepEqual(condition(plan, 'CURRENT_DOCUMENT_TOKEN'), {
    type: 'CURRENT_DOCUMENT_TOKEN', expected: null,
  });
  assert.deepEqual(condition(plan, 'ARTIFACT_DIGEST'), {
    type: 'ARTIFACT_DIGEST', expected: plan.artifactDigest,
  });
  assert.deepEqual(plan.postconditions.find((entry) => entry.type === 'TARGET_DOCUMENT'), {
    type: 'TARGET_DOCUMENT', folderToken: 'collections-v26', documentToken: 'NEW_DOCUMENT_TOKEN',
  });
  assert.deepEqual(plan.postconditions.find((entry) => entry.type === 'TARGET_LINK'), {
    type: 'TARGET_LINK', recordId: 'NEW_RECORD_ID', documentToken: 'NEW_DOCUMENT_TOKEN',
  });
});

test('SyncPlanner rejects writes without a target parent record', () => {
  assert.throws(
    () => new SyncPlanner().planAction({
      type: 'CREATE',
      stableId: 'node:Collections:createCollection',
      doc: null,
      reason: 'new symbol',
    }, planningContext({
      current: null,
      target: { ...planningContext().target, parentRecordId: null },
    })),
    (error) => error.code === 'TARGET_ANCESTRY_REQUIRED',
  );
});

test('SyncPlanner rejects CREATE when an existing release record is present', () => {
  assert.throws(
    () => new SyncPlanner().planAction({
      type: 'CREATE',
      stableId: 'node:Collections:createCollection',
      doc: null,
      reason: 'new symbol',
    }, planningContext()),
    (error) => error.code === 'CREATE_RECORD_ALREADY_EXISTS',
  );
});

test('SyncPlanner rejects CREATE without explicit absent lookup evidence', () => {
  assert.throws(
    () => new SyncPlanner().planAction({
      type: 'CREATE',
      stableId: 'node:Collections:createCollection',
      doc: null,
      reason: 'new symbol',
    }, planningContext({ current: null, existingRecordLookup: null })),
    (error) => error.code === 'CREATE_LOOKUP_REQUIRED',
  );
});

test('SyncPlanner rejects CREATE when existing record evidence is present on the action doc', () => {
  assert.throws(
    () => new SyncPlanner().planAction({
      type: 'CREATE',
      stableId: 'node:Collections:createCollection',
      doc: {
        id: 'rec-existing',
        metadata: {
          token: 'doc-existing',
          version: 'v2.6.x',
          folderToken: 'collections-v26',
        },
      },
      reason: 'new symbol',
    }, planningContext({ current: null })),
    (error) => error.code === 'CREATE_RECORD_ALREADY_EXISTS',
  );
});

test('SyncPlanner rejects UPDATE without existing release record and document token evidence', () => {
  const planner = new SyncPlanner();

  assert.throws(
    () => planner.planAction(updateAction({ doc: null }), planningContext({ current: null })),
    (error) => error.code === 'UPDATE_SOURCE_REQUIRED',
  );
  assert.throws(
    () => planner.planAction(updateAction(), planningContext({
      current: { ...planningContext().current, documentToken: null },
    })),
    (error) => error.code === 'UPDATE_SOURCE_REQUIRED',
  );
});

test('SyncPlanner rejects UPDATE with unknown current document placement', () => {
  const planner = new SyncPlanner();
  const base = planningContext();

  assert.throws(
    () => planner.planAction(updateAction(), planningContext({
      current: {
        ...base.current,
        version: null,
        folderToken: null,
        placementVerified: false,
      },
    })),
    (error) => error.code === 'UPDATE_PLACEMENT_REQUIRED'
      && /requires verified current document placement/.test(error.message),
  );
});

test('SyncPlanner allows UPDATE_IN_PLACE only for a verified target-local unshared document', () => {
  const plan = new SyncPlanner().planAction(updateAction(), planningContext());

  assert.equal(plan.action, 'UPDATE_IN_PLACE');
  assert.deepEqual(condition(plan, 'CURRENT_RECORD'), {
    type: 'CURRENT_RECORD', expected: 'rec-v26',
  });
  assert.deepEqual(condition(plan, 'CURRENT_DOCUMENT_TOKEN'), {
    type: 'CURRENT_DOCUMENT_TOKEN', expected: 'doc-v26',
  });
  assert.deepEqual(condition(plan, 'TARGET_ANCESTRY'), {
    type: 'TARGET_ANCESTRY',
    expectedFolderToken: 'collections-v26',
    expectedVersionRootToken: 'root-v26',
    verified: true,
  });
  assert.deepEqual(condition(plan, 'SHARED_TOKEN'), {
    type: 'SHARED_TOKEN', referencedByOlderVersions: false,
  });
  assert.deepEqual(plan.postconditions.find((entry) => entry.type === 'TARGET_LINK'), {
    type: 'TARGET_LINK', recordId: 'rec-v26', documentToken: 'doc-v26',
  });
});

test('SyncPlanner uses COPY_PATCH_AND_REPOINT for every unsafe update location with copy source evidence', () => {
  const cases = [
    ['older version', { current: { ...planningContext().current, version: 'v2.5.x' } }],
    ['shared token', { tokenReferencedByOlderVersions: true }],
    ['wrong folder', { current: { ...planningContext().current, folderToken: 'wrong-folder' } }],
    ['missing current ancestry proof', { current: { ...planningContext().current, ancestryVerified: false } }],
  ];

  for (const [label, contextOverride] of cases) {
    const plan = new SyncPlanner().planAction(updateAction(), planningContext(contextOverride));
    assert.equal(plan.action, 'COPY_PATCH_AND_REPOINT', label);
    assert.deepEqual(plan.copySource, {
      documentToken: 'doc-v26',
      link: 'https://docs.example/docx/doc-v26',
      title: 'createCollection()',
    }, label);
    assert.ok(plan.postconditions.some((entry) => entry.type === 'TARGET_DOCUMENT'), label);
    assert.ok(plan.postconditions.some((entry) => entry.type === 'TARGET_LINK'), label);
    assert.ok(plan.postconditions.some((entry) => entry.type === 'TARGET_PARENT'), label);
    assert.ok(plan.postconditions.some((entry) => entry.type === 'TARGET_VERSION'), label);
  }
});

test('SyncPlanner rejects unsafe UPDATEs without copy source evidence', () => {
  assert.throws(
    () => new SyncPlanner().planAction(updateAction(), planningContext({
      current: { ...planningContext().current, version: 'v2.5.x' },
      copySource: null,
    })),
    (error) => error.code === 'COPY_SOURCE_REQUIRED',
  );
});

test('changed inherited Python docs plan as copy-patch-repoint with source preservation evidence', () => {
  const inheritedCases = [
    ['python:Volume:upload_file_to_volume', 'v2.5.x'],
    ['python:CollectionSchema:FieldSchema', 'v2.4.x'],
    ['python:Authentication:create_user', 'v2.4.x'],
    ['python:Authentication:update_password', 'v2.4.x'],
  ];

  for (const [stableId, sourceVersion] of inheritedCases) {
    const documentToken = `${stableId}:doc`;
    const title = `${stableId.split(':').at(-1)}()`;
    const plan = new SyncPlanner().planAction(
      updateAction({
        slug: stableId.replace(/^python:/, '').replace(/:/g, '-'),
        symbol: {
          name: stableId.split(':').at(-1),
          identity: { stableId },
        },
      }),
      planningContext({
        current: {
          ...planningContext().current,
          recordId: `${stableId}:record`,
          documentToken,
          version: sourceVersion,
          folderToken: `inherited-${sourceVersion}`,
          ancestryVerified: true,
          placementVerified: true,
        },
        copySource: {
          documentToken,
          link: `https://docs.example/docx/${encodeURIComponent(documentToken)}`,
          title,
        },
        tokenReferencedByOlderVersions: true,
      }),
    );

    assert.equal(plan.action, 'COPY_PATCH_AND_REPOINT', stableId);
    assert.deepEqual(plan.copySource, {
      documentToken,
      link: `https://docs.example/docx/${encodeURIComponent(documentToken)}`,
      title,
    }, stableId);
    assert.deepEqual(plan.postconditions.find((entry) => entry.type === 'OLDER_SOURCE_UNCHANGED'), {
      type: 'OLDER_SOURCE_UNCHANGED',
      version: sourceVersion,
      documentToken,
    }, stableId);
  }
});

test('cross-version plans preserve the older source document and link', () => {
  const plan = new SyncPlanner().planAction(updateAction(), planningContext({
    current: { ...planningContext().current, version: 'v2.5.x', folderToken: 'collections-v25' },
  }));

  assert.equal(plan.action, 'COPY_PATCH_AND_REPOINT');
  assert.deepEqual(plan.source, {
    version: 'v2.5.x',
    recordId: 'rec-v26',
    documentToken: 'doc-v26',
    folderToken: 'collections-v25',
  });
  assert.deepEqual(plan.postconditions.find((entry) => entry.type === 'OLDER_SOURCE_UNCHANGED'), {
    type: 'OLDER_SOURCE_UNCHANGED',
    version: 'v2.5.x',
    documentToken: 'doc-v26',
  });
});

test('write plans reject missing, unreviewed, invalid, and empty artifacts with typed errors', () => {
  const planner = new SyncPlanner();
  const create = { type: 'CREATE', slug: 'x', stableId: 'node:x', doc: null };
  const cases = [
    ['missing', undefined, 'REVIEWED_ARTIFACT_REQUIRED'],
    ['unreviewed', { content: 'x', reviewed: false, validated: true }, 'REVIEWED_ARTIFACT_REQUIRED'],
    ['empty', { content: '', reviewed: true, validated: true }, 'REVIEWED_ARTIFACT_REQUIRED'],
    ['whitespace only', { content: '  \n', reviewed: true, validated: true }, 'REVIEWED_ARTIFACT_REQUIRED'],
    ['invalid', { content: 'x', reviewed: true, validation: { valid: false } }, 'VALIDATED_ARTIFACT_REQUIRED'],
  ];

  for (const [label, suppliedArtifact, code] of cases) {
    assert.throws(
      () => planner.planAction(create, planningContext({ artifact: suppliedArtifact, current: null })),
      (error) => error.code === code,
      label,
    );
  }
});

test('target canonical folder, version root, and verified ancestry are mandatory', () => {
  const planner = new SyncPlanner();
  for (const target of [
    { ...planningContext().target, folderToken: null },
    { ...planningContext().target, versionRootToken: null },
    { ...planningContext().target, ancestryVerified: false },
  ]) {
    assert.throws(
      () => planner.planAction({ type: 'CREATE', stableId: 'node:x' }, planningContext({ target, current: null })),
      (error) => error.code === 'TARGET_ANCESTRY_REQUIRED',
    );
  }
});

test('DEPRECATE, ORPHAN, and SKIP map to metadata-only, non-destructive, and NOOP plans', () => {
  const planner = new SyncPlanner();
  const current = planningContext({ artifact: undefined });
  const deprecate = planner.planAction({ ...updateAction(), type: 'DEPRECATE' }, current);
  const orphan = planner.planAction({ ...updateAction(), type: 'ORPHAN', symbol: null }, current);
  const noop = planner.planAction({ ...updateAction(), type: 'SKIP' }, current);

  assert.equal(deprecate.action, 'DEPRECATE');
  assert.equal(deprecate.artifactDigest, null);
  assert.deepEqual(deprecate.postconditions, [{
    type: 'TARGET_METADATA', version: 'v2.6.x', state: 'DEPRECATED',
  }]);
  assert.equal(orphan.action, 'ORPHAN');
  assert.equal(orphan.metadata.destructive, false);
  assert.deepEqual(orphan.postconditions, [{ type: 'NO_MUTATION' }]);
  assert.equal(noop.action, 'NOOP');
  assert.deepEqual(noop.postconditions, [{ type: 'NO_MUTATION' }]);

  const withoutWriteAncestry = planner.planAction(
    { ...updateAction(), type: 'SKIP' },
    { target: { version: 'v2.6.x' }, current: planningContext().current },
  );
  assert.equal(withoutWriteAncestry.action, 'NOOP');
});

test('unknown diff actions fail with a typed planning error', () => {
  assert.throws(
    () => new SyncPlanner().planAction({ type: 'MOVE', stableId: 'node:x' }, planningContext()),
    (error) => error.code === 'UNKNOWN_ACTION' && /MOVE/.test(error.message),
  );
});

test('plans are deterministic, recursively frozen, and isolated from input mutation', () => {
  const planner = new SyncPlanner();
  const action = updateAction();
  const context = planningContext();
  const first = planner.planAction(action, context);
  const second = planner.planAction(action, context);

  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.source), true);
  assert.equal(Object.isFrozen(first.preconditions), true);
  assert.equal(Object.isFrozen(first.preconditions[0]), true);

  action.doc.metadata.token = 'mutated';
  context.target.folderToken = 'mutated';
  assert.equal(first.source.documentToken, 'doc-v26');
  assert.equal(first.target.folderToken, 'collections-v26');
  assert.throws(() => { first.target.folderToken = 'changed'; }, TypeError);
});

test('Document IR digest uses stable key serialization and overload stable IDs remain distinct', () => {
  const planner = new SyncPlanner({ digest: (bytes) => `test:${bytes.toString('utf8')}` });
  const firstArtifact = {
    documentIr: { schemaVersion: 1, blocks: [{ type: 'paragraph', text: 'x' }] },
    reviewed: true,
    validated: true,
  };
  const secondArtifact = {
    documentIr: { blocks: [{ text: 'x', type: 'paragraph' }], schemaVersion: 1 },
    reviewed: true,
    validated: true,
  };
  const first = planner.planAction({ type: 'CREATE', stableId: 'java:Collections:list:sig-111' }, planningContext({ artifact: firstArtifact, current: null }));
  const second = planner.planAction({ type: 'CREATE', stableId: 'java:Collections:list:sig-222' }, planningContext({ artifact: secondArtifact, current: null }));

  assert.equal(first.artifactDigest, second.artifactDigest);
  assert.equal(first.stableId, 'java:Collections:list:sig-111');
  assert.equal(second.stableId, 'java:Collections:list:sig-222');
  assert.notEqual(first.stableId, second.stableId);
});

test('SDK Document IR digest and immutable plan include the layout profile version', () => {
  const planner = new SyncPlanner();
  const documentIr = { type: 'document', children: [] };
  const base = {
    content: 'same markdown\n',
    documentIr,
    reviewed: true,
    validated: true,
  };
  const first = planner.planAction(
    { type: 'CREATE', stableId: 'python:Vector:search-v1' },
    planningContext({
      current: null,
      artifact: { ...base, layout: { profileId: 'python', profileVersion: 1 } },
    }),
  );
  const second = planner.planAction(
    { type: 'CREATE', stableId: 'python:Vector:search-v2' },
    planningContext({
      current: null,
      artifact: { ...base, layout: { profileId: 'python', profileVersion: 2 } },
    }),
  );

  assert.notEqual(first.artifactDigest, second.artifactDigest);
  assert.deepEqual(first.layout, { profileId: 'python', profileVersion: 1 });
  assert.equal(Object.isFrozen(first.layout), true);
  assert.equal(first.metadata.artifactKind, 'sdk-document-ir');
});

test('SDK UPDATE requires and preserves a validated immutable API patch plan', () => {
  const planner = new SyncPlanner();
  const sdkArtifact = {
    content: 'Searches vectors.\n',
    documentIr: { type: 'document', children: [] },
    layout: { profileId: 'python', profileVersion: 1 },
    reviewed: true,
    validated: true,
  };

  assert.throws(
    () => planner.planAction(updateAction(), planningContext({ artifact: sdkArtifact })),
    (error) => error.code === 'API_PATCH_PLAN_REQUIRED',
  );

  const apiPatchPlan = {
    schemaVersion: 1,
    profile: { id: 'python', version: 1 },
    strategy: 'targeted-semantic-patch',
    operations: [],
    validation: { valid: true, errors: [] },
  };
  const plan = planner.planAction(
    updateAction(),
    planningContext({ artifact: sdkArtifact, apiPatchPlan }),
  );
  assert.deepEqual(plan.apiPatchPlan, apiPatchPlan);
  assert.equal(Object.isFrozen(plan.apiPatchPlan), true);
});

test('planAll documents the batch API and returns frozen plans in input order', () => {
  const planner = new SyncPlanner();
  const actions = [
    { type: 'CREATE', stableId: 'node:a' },
    { type: 'SKIP', stableId: 'node:b' },
  ];
  const plans = planner.planAll(actions, (action) => planningContext({
    artifact: action.type === 'CREATE' ? artifact(action.stableId) : undefined,
    current: null,
  }));

  assert.deepEqual(plans.map((plan) => plan.stableId), ['node:a', 'node:b']);
  assert.equal(Object.isFrozen(plans), true);
});

function syncFixture({ dryRun, approvalCallback = null, calls }) {
  const scanned = [{
    name: 'createCollection',
    parentClass: 'Collections',
    docstring: 'new description',
    identity: { stableId: 'node:Collections:createCollection' },
  }];
  const indexed = [{
    id: 'rec-v26',
    metadata: {
      slug: 'Collections-createCollection',
      description: 'old description',
      token: 'doc-v26',
      version: 'v2.6.x',
      folderToken: 'collections-v26',
      parentRecordId: 'parent-v26',
    },
  }];
  const realPlanner = new SyncPlanner();
  const planner = {
    planAction(action, context) {
      calls.planner += 1;
      return realPlanner.planAction(action, context);
    },
  };
  const writer = {
    async push_markdown() { calls.documentMutations += 1; },
    async patch_document() { calls.documentMutations += 1; },
    async parse_markdown() { calls.documentMutations += 1; },
    async markdown_to_blocks() { calls.documentMutations += 1; },
  };
  const recordWriter = {
    async createRecord() { calls.recordMutations += 1; },
    async updateRecord() { calls.recordMutations += 1; },
  };

  return new SdkDocSync({
    scanner: {
      rootDir: '/fixture-sdk',
      async scan() { calls.scanner += 1; return scanned; },
    },
    indexReader: {
      async list_documents() { calls.index += 1; return indexed; },
    },
    planner,
    artifactProvider() {
      return planningContext();
    },
    documentWriter: writer,
    bitableWriter: recordWriter,
    docGenerator: { generate() { throw new Error('planning used scaffold fallback'); }, generateMeta() { return {}; } },
    rootToken: 'root-v26',
    baseToken: 'base-v26',
    sdkVersion: 'v2.6.x',
    sdkName: 'Node SDK',
    language: 'node',
    dryRun,
    approvalCallback,
    onProgress() {},
  });
}

test('dry-run scans, reads the real index, plans UPDATE accurately, and performs zero mutations', async () => {
  const calls = { scanner: 0, index: 0, planner: 0, documentMutations: 0, recordMutations: 0 };
  const result = await syncFixture({ dryRun: true, calls }).run();

  assert.equal(calls.scanner, 1);
  assert.equal(calls.index, 1);
  assert.equal(calls.planner, 1);
  assert.equal(result.diff[0].type, 'UPDATE');
  assert.equal(result.plans[0].action, 'UPDATE_IN_PLACE');
  assert.deepEqual(result.planningErrors, []);
  assert.equal(calls.documentMutations, 0);
  assert.equal(calls.recordMutations, 0);
});

test('dry and live modes produce identical plans before approval or execution', async () => {
  const dryCalls = { scanner: 0, index: 0, planner: 0, documentMutations: 0, recordMutations: 0 };
  const liveCalls = { scanner: 0, index: 0, planner: 0, documentMutations: 0, recordMutations: 0 };
  let approvalCalls = 0;
  const dry = await syncFixture({ dryRun: true, calls: dryCalls }).run();
  const live = await syncFixture({
    dryRun: false,
    calls: liveCalls,
    approvalCallback: async () => { approvalCalls += 1; return []; },
  }).run();

  assert.deepEqual(live.plans, dry.plans);
  assert.equal(approvalCalls, 1);
  assert.equal(liveCalls.scanner, 1);
  assert.equal(liveCalls.index, 1);
  assert.equal(liveCalls.planner, 1);
  assert.equal(liveCalls.documentMutations, 0);
  assert.equal(liveCalls.recordMutations, 0);
});

test('orchestrator returns typed planning errors and does not approve invalid write actions', async () => {
  const calls = { scanner: 0, index: 0, planner: 0, documentMutations: 0, recordMutations: 0 };
  let approved = false;
  const sync = syncFixture({
    dryRun: false,
    calls,
    approvalCallback: async () => { approved = true; return []; },
  });
  sync.artifactProvider = () => planningContext({ artifact: undefined });
  const result = await sync.run();

  assert.deepEqual(result.plans, []);
  assert.equal(result.planningErrors.length, 1);
  assert.equal(result.planningErrors[0].code, 'REVIEWED_ARTIFACT_REQUIRED');
  assert.equal(approved, false);
  assert.equal(calls.documentMutations, 0);
  assert.equal(calls.recordMutations, 0);
});

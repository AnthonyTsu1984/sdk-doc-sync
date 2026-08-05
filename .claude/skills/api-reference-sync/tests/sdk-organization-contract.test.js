'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  organizationRecordType,
  validateOrganizationContract,
  validateOrganizationBatch,
  validateReleasePlacement,
} = require('../src/sdk-doc-sync/sdk-organization-contract');

function bulkWriterContract(overrides = {}) {
  return {
    schemaVersion: 1,
    profileId: 'node-stateful-class',
    profileVersion: 1,
    reviewed: true,
    groupingChange: true,
    classRecord: {
      stableId: 'node:DataImport:BulkWriter',
      title: 'BulkWriter',
      recordId: 'rec-bulk-writer',
      recordType: 'Class',
      docsResourceType: 'docx',
      parentRecordId: 'rec-data-import',
      parentRecordType: 'VirtualNode',
      virtualNode: false,
    },
    drive: {
      layout: 'same_named_class_folder',
      folderName: 'BulkWriter',
      folderToken: 'folder-bulk-writer',
      landingDocumentInside: true,
      methodDocumentsInside: true,
    },
    methodInventory: {
      complete: true,
      publicMethodStableIds: [
        'node:DataImport:BulkWriter:append',
        'node:DataImport:BulkWriter:commit',
        'node:DataImport:BulkWriter:close',
        'node:DataImport:BulkWriter:writeFrom',
      ],
    },
    methods: [
      'append', 'commit', 'close', 'writeFrom',
    ].map((name) => ({
      stableId: `node:DataImport:BulkWriter:${name}`,
      title: `${name}()`,
      recordType: 'Function',
      parentRecordId: 'rec-bulk-writer',
    })),
    ...overrides,
  };
}

test('Node stateful-class contract fixes Class, Docx, child Function, and same-named folder topology', () => {
  const validation = validateOrganizationContract(bulkWriterContract());
  assert.deepEqual(validation, { valid: true, errors: [] });
  assert.equal(organizationRecordType(bulkWriterContract(), 'node:DataImport:BulkWriter'), 'Class');
  assert.equal(organizationRecordType(bulkWriterContract(), 'node:DataImport:BulkWriter:append'), 'Function');

  const invalid = validateOrganizationContract(bulkWriterContract({
    classRecord: {
      ...bulkWriterContract().classRecord,
      virtualNode: true,
    },
    drive: {
      ...bulkWriterContract().drive,
      layout: 'category_folder',
    },
  }));
  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.errors.map((error) => error.code).sort(), [
    'CLASS_VIRTUAL_NODE_FORBIDDEN',
    'SAME_NAMED_CLASS_FOLDER_REQUIRED',
  ]);
});

test('organization batch requires the complete public method inventory in the reviewed action set', () => {
  const contract = bulkWriterContract();
  const actions = [
    {
      stableId: contract.classRecord.stableId,
      planningContext: {
        target: {
          folderToken: contract.drive.folderToken,
          parentRecordId: contract.classRecord.parentRecordId,
        },
      },
    },
    ...contract.methods.slice(0, 3).map((method) => ({
      stableId: method.stableId,
      planningContext: {
        target: {
          folderToken: contract.drive.folderToken,
          parentRecordId: contract.classRecord.recordId,
        },
      },
    })),
  ];

  const validation = validateOrganizationBatch({ contract, actions });
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.errors, [{
    code: 'METHOD_INVENTORY_INCOMPLETE',
    expected: contract.methodInventory.publicMethodStableIds,
    actual: contract.methodInventory.publicMethodStableIds.slice(0, 3),
  }]);
});

test('organization contract rejects a self-declared complete inventory that omits scanner-derived public methods', () => {
  const full = bulkWriterContract();
  const truncated = bulkWriterContract({
    methodInventory: {
      complete: true,
      publicMethodStableIds: ['node:DataImport:BulkWriter:append'],
    },
    methods: [full.methods[0]],
  });
  const sourceInventory = {
    schemaVersion: 1,
    classStableId: full.classRecord.stableId,
    profileId: full.profileId,
    profileVersion: full.profileVersion,
    publicMethodStableIds: full.methodInventory.publicMethodStableIds,
    source: {
      sdk: 'milvus2-sdk-node',
      track: 'v3.0.x',
      revision: 'node-v304',
      scanner: 'node-scanner',
    },
  };

  const validation = validateOrganizationContract(truncated, { sourceInventory });

  assert.equal(validation.valid, false);
  assert.deepEqual(validation.errors, [{
    code: 'METHOD_SOURCE_INVENTORY_MISMATCH',
    expected: [...sourceInventory.publicMethodStableIds].sort(),
    actual: ['node:DataImport:BulkWriter:append'],
  }]);
});

test('organization batch rejects category-folder placement and category parenting for child methods', () => {
  const contract = bulkWriterContract();
  const actions = [
    {
      stableId: contract.classRecord.stableId,
      planningContext: {
        target: {
          folderToken: 'folder-data-import',
          parentRecordId: contract.classRecord.parentRecordId,
        },
      },
    },
    ...contract.methods.map((method) => ({
      stableId: method.stableId,
      planningContext: {
        target: {
          folderToken: 'folder-data-import',
          parentRecordId: contract.classRecord.parentRecordId,
        },
      },
    })),
  ];

  const validation = validateOrganizationBatch({ contract, actions });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === 'CLASS_FOLDER_TARGET_MISMATCH'));
  assert.ok(validation.errors.some((error) => error.code === 'METHOD_PARENT_TARGET_MISMATCH'));
});

test('ordinary content updates may select one method while retaining the complete reviewed inventory', () => {
  const contract = bulkWriterContract({ groupingChange: false });
  const method = contract.methods[0];
  const validation = validateOrganizationBatch({
    contract,
    actions: [{
      stableId: method.stableId,
      planningContext: {
        target: {
          folderToken: contract.drive.folderToken,
          parentRecordId: contract.classRecord.recordId,
        },
      },
    }],
  });
  assert.deepEqual(validation, { valid: true, errors: [] });
});

test('release placement distinguishes a configured multi-version container from the actual release child', () => {
  assert.deepEqual(validateReleasePlacement({
    configuredRootToken: 'node-sdk-container',
    configuredRootKind: 'container',
    actualReleaseFolderToken: 'node-v300',
    actualReleaseFolderName: 'v3.0.0',
    targetVersion: 'v3.0.x',
    verified: true,
  }), { valid: true, errors: [] });

  const invalid = validateReleasePlacement({
    configuredRootToken: 'node-sdk-container',
    configuredRootKind: 'container',
    actualReleaseFolderToken: 'node-sdk-container',
    actualReleaseFolderName: 'v3.0.0',
    targetVersion: 'v3.0.x',
    verified: true,
  });
  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.errors.map((error) => error.code), ['RELEASE_CHILD_FOLDER_REQUIRED']);
});

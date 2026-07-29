const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const scriptPath = path.join(__dirname, '..', 'scripts', 'audit-sdk-type-ownership.js');
const { buildTypeOwnershipAudit } = require(scriptPath);

test('audits method-owned sibling records with sorted owners and embedding status', () => {
  const audit = buildTypeOwnershipAudit({
    records: [{
      recordId: 'rec-helper',
      title: 'SharedResponse',
      documentToken: 'doc-helper',
    }],
    ownership: {
      language: 'cpp',
      track: 'v2.6.x',
      entries: [{
        typeName: 'SharedResponse',
        classification: 'method_owned',
        owners: [{ stableId: 'cpp:Vector:Query' }, { stableId: 'cpp:Vector:Search' }],
      }],
    },
    ownerDocuments: [{
      stableId: 'cpp:Vector:Search',
      embeddedTypeNames: ['SharedResponse'],
    }, {
      stableId: 'cpp:Vector:Query',
      embeddedTypeNames: [],
    }],
  });

  assert.deepEqual(audit, {
    schemaVersion: 1,
    language: 'cpp',
    track: 'v2.6.x',
    writesPerformed: false,
    invalidSiblingRecords: [{
      recordId: 'rec-helper',
      title: 'SharedResponse',
      documentToken: 'doc-helper',
      owners: ['cpp:Vector:Query', 'cpp:Vector:Search'],
      embeddedInAllOwners: false,
      proposedDisposition: 'REVIEW_CLEANUP_AFTER_EMBEDDING',
    }],
  });
});

test('CLI writes a deterministic read-only audit artifact', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'type-ownership-audit-'));
  const records = path.join(directory, 'records.json');
  const ownership = path.join(directory, 'ownership.json');
  const ownerDocuments = path.join(directory, 'owner-documents.json');
  const output = path.join(directory, 'audit.json');
  fs.writeFileSync(records, JSON.stringify([{ recordId: 'rec-helper', title: 'Request', documentToken: 'doc-helper' }]));
  fs.writeFileSync(ownership, JSON.stringify({
    language: 'go', track: 'v2.6.x',
    entries: [{ typeName: 'Request', classification: 'method_owned', owners: [{ stableId: 'go:Collections:Create' }] }],
  }));
  fs.writeFileSync(ownerDocuments, JSON.stringify([{ stableId: 'go:Collections:Create', embeddedTypeNames: ['Request'] }]));

  const result = spawnSync(process.execPath, [scriptPath,
    '--records', records,
    '--ownership', ownership,
    '--owner-documents', ownerDocuments,
    '--output', output,
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), {
    schemaVersion: 1,
    language: 'go',
    track: 'v2.6.x',
    writesPerformed: false,
    invalidSiblingRecords: [{
      recordId: 'rec-helper',
      title: 'Request',
      documentToken: 'doc-helper',
      owners: ['go:Collections:Create'],
      embeddedInAllOwners: true,
      proposedDisposition: 'REVIEW_CLEANUP_AFTER_EMBEDDING',
    }],
  });
});

test('audit script has no Feishu client dependency', () => {
  const source = fs.readFileSync(scriptPath, 'utf8');
  assert.doesNotMatch(source, /require\([^)]*(?:feishu|lark|client)[^)]*\)/i);
  assert.doesNotMatch(source, /fetch\(/);
});

test('accepts targets as canonical method ownership', () => {
  const audit = buildTypeOwnershipAudit({
    records: [{ recordId: 'rec-helper', title: 'CreateRequest', documentToken: 'doc-helper' }],
    ownership: {
      language: 'java', track: 'v3.0.x',
      entries: [{
        typeName: 'CreateRequest',
        documentationOwnership: {
          classification: 'method_owned',
          targets: [{ stableId: 'java:Collections:createCollection' }],
        },
      }],
    },
    ownerDocuments: [{ stableId: 'java:Collections:createCollection', embeddedTypeNames: ['CreateRequest'] }],
  });

  assert.deepEqual(audit.invalidSiblingRecords[0].owners, ['java:Collections:createCollection']);
  assert.equal(audit.invalidSiblingRecords[0].embeddedInAllOwners, true);
});

test('rejects method-owned entries without owners and ambiguous ownership', () => {
  const base = {
    records: [],
    ownership: { language: 'cpp', track: 'v2.6.x', entries: [] },
    ownerDocuments: [],
  };

  assert.throws(() => buildTypeOwnershipAudit({
    ...base,
    ownership: { ...base.ownership, entries: [{ typeName: 'NoOwnerRequest', classification: 'method_owned' }] },
  }), /Method-owned type NoOwnerRequest requires at least one owner/);
  assert.throws(() => buildTypeOwnershipAudit({
    ...base,
    ownership: { ...base.ownership, entries: [{ typeName: 'UnknownResponse', classification: 'ambiguous' }] },
  }), /Ambiguous documentation ownership for UnknownResponse/);
});

test('rejects duplicate audit identities and sorts equivalent inputs identically', () => {
  const base = {
    records: [{ recordId: 'rec-b', title: 'B', documentToken: 'doc-b' }, { recordId: 'rec-a', title: 'A', documentToken: 'doc-a' }],
    ownership: {
      language: 'go', track: 'v2.6.x',
      entries: [
        { typeName: 'B', classification: 'method_owned', owners: [{ stableId: 'go:Client:B' }] },
        { typeName: 'A', classification: 'method_owned', targets: [{ stableId: 'go:Client:A' }] },
      ],
    },
    ownerDocuments: [
      { stableId: 'go:Client:B', embeddedTypeNames: ['B'] },
      { stableId: 'go:Client:A', embeddedTypeNames: ['A'] },
    ],
  };
  const reordered = {
    ...base,
    records: [...base.records].reverse(),
    ownership: { ...base.ownership, entries: [...base.ownership.entries].reverse() },
    ownerDocuments: [...base.ownerDocuments].reverse(),
  };

  assert.deepEqual(buildTypeOwnershipAudit(base), buildTypeOwnershipAudit(reordered));
  assert.throws(() => buildTypeOwnershipAudit({
    ...base,
    ownership: { ...base.ownership, entries: [...base.ownership.entries, { typeName: 'A', classification: 'standalone' }] },
  }), /Duplicate ownership type name: A/);
  assert.throws(() => buildTypeOwnershipAudit({
    ...base,
    ownerDocuments: [...base.ownerDocuments, { stableId: 'go:Client:A', embeddedTypeNames: [] }],
  }), /Duplicate owner document stableId: go:Client:A/);
});

test('CLI refuses direct and symlink-equivalent output input collisions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'type-ownership-audit-collision-'));
  const records = path.join(directory, 'records.json');
  const ownership = path.join(directory, 'ownership.json');
  const ownerDocuments = path.join(directory, 'owner-documents.json');
  const outputSymlink = path.join(directory, 'output.json');
  fs.writeFileSync(records, '[]');
  fs.writeFileSync(ownership, JSON.stringify({ language: 'cpp', track: 'v2.6.x', entries: [] }));
  fs.writeFileSync(ownerDocuments, '[]');
  fs.symlinkSync(ownership, outputSymlink);

  for (const output of [records, outputSymlink]) {
    const result = spawnSync(process.execPath, [scriptPath,
      '--records', records,
      '--ownership', ownership,
      '--owner-documents', ownerDocuments,
      '--output', output,
    ], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must not overwrite an input path/);
  }
});

test('fails closed for unsupported classifications and malformed owners while inferring method ownership', () => {
  const base = {
    records: [{ recordId: 'rec-helper', title: 'Helper', documentToken: 'doc-helper' }],
    ownership: { language: 'node', track: 'v3.0.x', entries: [] },
    ownerDocuments: [{ stableId: 'node:Client:call', embeddedTypeNames: ['Helper'] }],
  };
  const inferred = buildTypeOwnershipAudit({
    ...base,
    ownership: {
      ...base.ownership,
      entries: [{ typeName: 'Helper', targets: [{ stableId: 'node:Client:call' }] }],
    },
  });
  assert.deepEqual(inferred.invalidSiblingRecords[0].owners, ['node:Client:call']);

  assert.throws(() => buildTypeOwnershipAudit({
    ...base,
    ownership: { ...base.ownership, entries: [{ typeName: 'Helper', classification: 'unknown' }] },
  }), /Unsupported documentation ownership classification: unknown/);
  assert.throws(() => buildTypeOwnershipAudit({
    ...base,
    ownership: { ...base.ownership, entries: [{ typeName: 'Helper', classification: 'method_owned', owners: [{}] }] },
  }), /Owner for Helper requires a non-empty stableId/);
});

test('CLI refuses hard-link output input collisions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'type-ownership-audit-hard-link-'));
  const records = path.join(directory, 'records.json');
  const ownership = path.join(directory, 'ownership.json');
  const ownerDocuments = path.join(directory, 'owner-documents.json');
  const outputHardLink = path.join(directory, 'output.json');
  fs.writeFileSync(records, '[]');
  fs.writeFileSync(ownership, JSON.stringify({ language: 'cpp', track: 'v2.6.x', entries: [] }));
  fs.writeFileSync(ownerDocuments, '[]');
  fs.linkSync(ownership, outputHardLink);

  const result = spawnSync(process.execPath, [scriptPath,
    '--records', records,
    '--ownership', ownership,
    '--owner-documents', ownerDocuments,
    '--output', outputHardLink,
  ], { encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not overwrite an input path/);
});

test('fails closed for missing ownership identities and conflicting canonical ownership', () => {
  const base = {
    records: [{ recordId: 'rec-helper', title: 'Helper', documentToken: 'doc-helper' }],
    ownership: { language: 'cpp', track: 'v2.6.x', entries: [] },
    ownerDocuments: [{ stableId: 'cpp:Client:Call', embeddedTypeNames: ['Helper'] }],
  };
  const entry = (value) => ({ ...base, ownership: { ...base.ownership, entries: [value] } });

  assert.throws(() => buildTypeOwnershipAudit(entry({ classification: 'standalone' })), /Missing documentation ownership type identity/);
  assert.throws(() => buildTypeOwnershipAudit(entry({
    typeName: 'Helper', classification: 'standalone', owners: [{ stableId: 'cpp:Client:Call' }],
  })), /Standalone type Helper cannot retain declared owners/);
  assert.throws(() => buildTypeOwnershipAudit(entry({
    typeName: 'Helper', classification: 'standalone',
    documentationOwnership: { classification: 'method_owned', owners: [{ stableId: 'cpp:Client:Call' }] },
  })), /Conflicting documentation ownership classification for Helper/);
  assert.throws(() => buildTypeOwnershipAudit(entry({
    typeName: 'Helper', classification: 'standalone',
    documentationOwnership: { classification: 'ambiguous' },
  })), /Conflicting documentation ownership classification for Helper/);
  assert.throws(() => buildTypeOwnershipAudit(entry({
    typeName: 'Helper', documentationOwnership: { classification: 'ambiguous' },
  })), /Ambiguous documentation ownership for Helper/);
});

test('rejects malformed owner document embedding inventories before indexing', () => {
  const base = {
    records: [{ recordId: 'rec-helper', title: 'Helper', documentToken: 'doc-helper' }],
    ownership: {
      language: 'cpp', track: 'v2.6.x',
      entries: [{ typeName: 'Helper', classification: 'method_owned', owners: [{ stableId: 'cpp:Client:Call' }] }],
    },
  };

  for (const ownerDocument of [
    { stableId: 'cpp:Client:Call', embeddedTypeNames: 'prefix-Helper-suffix' },
    { stableId: 'cpp:Client:Call', embeddedTypeNames: ['Helper', ''] },
    { stableId: ' ', embeddedTypeNames: ['Helper'] },
  ]) {
    assert.throws(() => buildTypeOwnershipAudit({ ...base, ownerDocuments: [ownerDocument] }),
      /owner document.*non-empty stableId|embeddedTypeNames.*array of non-empty type names/i);
  }
});

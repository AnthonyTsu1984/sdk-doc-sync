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

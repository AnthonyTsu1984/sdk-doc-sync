'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('tracked Node organization evidence is small, source-bound, and replayable', () => {
  const manifestPath = path.join(
    __dirname,
    '..',
    'references',
    'evidence',
    'node-v30-document-organization.json',
  );
  assert.equal(fs.existsSync(manifestPath), true, 'tracked evidence manifest is required');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.sdk.name, 'milvus2-sdk-node');
  assert.equal(manifest.sdk.track, 'v3.0.x');
  assert.match(manifest.collection.collectedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(['user', 'bot'].includes(manifest.collection.identity));
  assert.equal(manifest.collection.verified, true);
  assert.match(manifest.bitable.baseToken, /^[A-Za-z0-9]+$/);
  assert.match(manifest.bitable.tableId, /^tbl[A-Za-z0-9]+$/);
  assert.equal(manifest.releaseFolders.current.track, 'v3.0.x');
  assert.equal(manifest.releaseFolders.inherited.track, 'v2.6.x');
  assert.equal(manifest.organization.profileId, 'node-stateful-class');
  assert.equal(manifest.organization.driveLayout, 'same_named_class_folder');
  assert.equal(manifest.organization.currentState.classFolderPresent, false);
  assert.ok(manifest.records.length >= 6);
  assert.ok(manifest.records.every((record) => (
    record.recordId
    && record.title
    && record.recordType
    && record.parentRecordId
    && record.docs.resourceType
    && record.docs.token
    && Number.isInteger(record.docs.revision)
    && /^sha256:[a-f0-9]{64}$/.test(record.docs.contentHash)
  )));
  assert.ok(manifest.replay.commands.length > 0);
  assert.ok(manifest.replay.commands.every(
    (command) => command.includes(`--as ${manifest.collection.identity}`),
  ));
});

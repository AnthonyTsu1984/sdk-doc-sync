'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {reconcileControlPlane} = require('../src/rest-control-plane/reconcile');

test('reconciles source and fragment routes without hiding blockers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rest-reconcile-'));
  fs.writeFileSync(path.join(root, 'service.json'), JSON.stringify({openapi: '3.0.3', paths: {'/v2/a': {get: {}}}}));
  const config = {schemaVersion: 1, services: [{id: 'a', zdocFragments: ['service.json']}, {id: 'b', zdocFragments: []}]};
  const inventory = {repository: 'cloud', revision: 'a'.repeat(40), services: [
    {id: 'a', status: 'SCANNED', controllers: ['A.java'], routes: [{method: 'GET', path: '/v2/a'}, {method: 'POST', path: '/v2/b'}]},
    {id: 'b', status: 'CONTROLLER_MISSING', controllers: [], routes: []},
  ]};
  const report = reconcileControlPlane({inventory, config, zdocRoot: root});
  assert.equal(report.services[0].status, 'DIFF');
  assert.deepEqual(report.services[0].sourceOnly, ['POST /v2/b']);
  assert.equal(report.services[1].status, 'CONTROLLER_MISSING');
  assert.match(report.reportDigest, /^sha256:[a-f0-9]{64}$/);
  fs.rmSync(root, {recursive: true, force: true});
});

test('matches templated routes by position while reporting parameter naming differences', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rest-reconcile-params-'));
  fs.writeFileSync(path.join(root, 'service.json'), JSON.stringify({openapi: '3.0.3', paths: {
    '/v2/clusters/{CLUSTER_ID}/backups/{BACKUP_ID}': {get: {}},
  }}));
  const config = {schemaVersion: 1, services: [{id: 'backup', zdocFragments: ['service.json']}]};
  const inventory = {repository: 'cloud', revision: 'a'.repeat(40), services: [{id: 'backup', status: 'SCANNED',
    controllers: ['Backup.java'], routes: [{method: 'GET', path: '/v2/clusters/{clusterId}/backups/{backupId}'}]}]};
  const service = reconcileControlPlane({inventory, config, zdocRoot: root}).services[0];
  assert.equal(service.status, 'MATCHED');
  assert.equal(service.counts.matched, 1);
  assert.deepEqual(service.parameterNameDifferences[0].parameters, [
    {source: 'clusterId', zdoc: 'CLUSTER_ID'}, {source: 'backupId', zdoc: 'BACKUP_ID'},
  ]);
  fs.rmSync(root, {recursive: true, force: true});
});

test('preserves agent investigation blockers even when route counts are available', () => {
  const config = {schemaVersion: 1, services: [{id: 'acl', zdocFragments: []}]};
  const inventory = {repository: 'cloud', revision: 'a'.repeat(40), services: [{id: 'acl', status: 'MAPPING_REQUIRED',
    controllers: ['RoleController.java'], routes: [{method: 'GET', path: '/cloud/v1/role/list'}],
    investigation: {reason: 'internal and public routes differ'}}]};
  const service = reconcileControlPlane({inventory, config, zdocRoot: os.tmpdir()}).services[0];
  assert.equal(service.status, 'MAPPING_REQUIRED');
  assert.equal(service.investigation.reason, 'internal and public routes differ');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {buildSourceControlPlaneReview} = require('../src/rest-control-plane/source-review');

test('builds source-backed control-plane review and preserves mapping blockers', () => {
  const baseInventory = {repository: 'zilliz-cloud', revision: 'a'.repeat(40), services: [
    {id: 'roles', status: 'MAPPING_REQUIRED', routes: [{method: 'GET', path: '/cloud/v1/role/list', handler: 'listRoles'}]},
  ]};
  const headInventory = {repository: 'zilliz-cloud', revision: 'b'.repeat(40), services: [
    {id: 'roles', status: 'MAPPING_REQUIRED', investigation: {reason: 'public mapping unresolved'}, routes: [
      {method: 'GET', path: '/cloud/v1/role/list', handler: 'listRoles'},
      {method: 'POST', path: '/cloud/v1/project/role/create', handler: 'createProjectRole', requestType: 'CreateProjectRoleRequest'},
    ]},
  ]};
  const review = buildSourceControlPlaneReview({baseInventory, headInventory});
  assert.equal(review.services[0].blockers[0].code, 'MAPPING_REQUIRED');
  assert.equal(review.services[0].manifest.units.find(unit => unit.action === 'ADD').endpoint, '/cloud/v1/project/role/create');
  assert.match(review.reviewDigest, /^sha256:[a-f0-9]{64}$/);
});

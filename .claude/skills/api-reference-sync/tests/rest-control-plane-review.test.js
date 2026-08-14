'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {buildControlPlaneReviewManifest, reviewUnitIdFor} = require('../src/rest-control-plane/review-manifest');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function spec(description, includeRemoved = true) {
  return {
    openapi: '3.0.3',
    paths: {
      '/v2/projects': {get: {operationId: 'listProjects', responses: {200: {$ref: '#/components/responses/Projects'}}}},
      ...(includeRemoved ? {'/v2/projects/legacy': {delete: {operationId: 'deleteLegacy', responses: {200: {description: 'ok'}}}}} : {}),
    },
    components: {responses: {Projects: {description}}},
  };
}

test('uses a control-plane namespace without changing data-plane IDs', () => {
  assert.equal(reviewUnitIdFor('projects', '/v2/projects', 'GET'), 'rest:control-plane:projects:get:%2Fv2%2Fprojects');
});

test('propagates shared component changes to consumer operations', () => {
  const manifest = buildControlPlaneReviewManifest({
    serviceId: 'projects', repository: 'zilliz-cloud', baseRevision: SHA_A, headRevision: SHA_B,
    baseSpec: spec('old'), headSpec: spec('new'),
  });
  const list = manifest.units.find(unit => unit.endpoint === '/v2/projects');
  assert.equal(list.action, 'UPDATE');
  assert.deepEqual(list.affectedComponents, ['#/components/responses/Projects']);
  assert.match(manifest.manifestDigest, /^sha256:[a-f0-9]{64}$/);
});

test('production removals are blockers by default', () => {
  const manifest = buildControlPlaneReviewManifest({
    serviceId: 'projects', repository: 'zilliz-cloud', baseRevision: SHA_A, headRevision: SHA_B,
    baseSpec: spec('same'), headSpec: spec('same', false),
  });
  const removed = manifest.units.find(unit => unit.endpoint.endsWith('/legacy'));
  assert.equal(removed.action, 'REMOVE');
  assert.deepEqual(removed.blockers, ['REST_CONTROL_PLANE_REMOVAL_REQUIRES_APPROVAL']);
});

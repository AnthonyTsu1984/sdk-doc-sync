'use strict';

const path = require('node:path');
const {digestSemantic, sha256Digest} = require('../../../doc-ops-core/src/digest');

const FULL_SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SERVICE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace']);

function assertFullSha(value, label) {
  if (!FULL_SHA.test(value || '')) throw new Error(`REST_SOURCE_REVISION_INVALID: ${label} must be a full Git SHA`);
  return value;
}

function assertDigest(value, label) {
  if (!DIGEST.test(value || '')) throw new Error(`REST_DIGEST_INVALID: ${label} must be sha256:<64 lowercase hex>`);
  return value;
}

function assertServiceId(value) {
  if (!SERVICE_ID.test(value || '')) throw new Error(`REST_SERVICE_ID_INVALID: ${JSON.stringify(value)}`);
  return value;
}

function operationCount(spec) {
  let count = 0;
  for (const pathItem of Object.values(spec.paths || {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of Object.keys(pathItem)) if (HTTP_METHODS.has(method.toLowerCase())) count += 1;
  }
  return count;
}

function fragmentFilename(serviceId) {
  return `${assertServiceId(serviceId)}.openapi.json`;
}

function normalizeService(service) {
  const id = assertServiceId(service.id);
  const fragment = service.fragment || fragmentFilename(id);
  if (path.basename(fragment) !== fragment || !/^[a-z0-9][a-z0-9.-]*\.openapi\.json$/.test(fragment)) {
    throw new Error(`REST_FRAGMENT_FILENAME_INVALID: ${JSON.stringify(fragment)}`);
  }
  return {
    id,
    fragment,
    sha256: assertDigest(service.sha256, `services.${id}.sha256`),
    operationCount: service.operationCount,
  };
}

function buildCollectionManifest(options) {
  const apiSurface = options.apiSurface;
  if (apiSurface !== 'data-plane' && apiSurface !== 'control-plane') {
    throw new Error(`REST_API_SURFACE_INVALID: ${JSON.stringify(apiSurface)}`);
  }
  if (apiSurface === 'control-plane' && options.releaseTrack !== undefined) {
    throw new Error('REST_CONTROL_PLANE_REJECTS_TRACK');
  }
  if (!Array.isArray(options.services) || options.services.length === 0) throw new Error('REST_SERVICES_REQUIRED');

  const services = options.services.map(normalizeService).sort((left, right) => left.id.localeCompare(right.id));
  const ids = new Set();
  for (const service of services) {
    if (ids.has(service.id)) throw new Error(`REST_SERVICE_DUPLICATE: ${service.id}`);
    ids.add(service.id);
    if (!Number.isInteger(service.operationCount) || service.operationCount < 0) {
      throw new Error(`REST_OPERATION_COUNT_INVALID: ${service.id}`);
    }
  }

  const semantic = {
    schemaVersion: '1.0',
    apiSurface,
    ...(options.releaseTrack === undefined ? {} : {releaseTrack: options.releaseTrack}),
    source: {
      repository: options.source.repository,
      revision: assertFullSha(options.source.revision, 'source.revision'),
    },
    generator: {
      repository: options.generator.repository,
      revision: assertFullSha(options.generator.revision, 'generator.revision'),
      configDigest: assertDigest(options.generator.configDigest, 'generator.configDigest'),
    },
    review: {
      manifestDigest: assertDigest(options.review.manifestDigest, 'review.manifestDigest'),
      approvalDigest: assertDigest(options.review.approvalDigest, 'review.approvalDigest'),
    },
    services,
  };
  const collectionId = `${apiSurface}-${digestSemantic(semantic).slice('sha256:'.length, 'sha256:'.length + 16)}`;
  return {schemaVersion: '1.0', collectionId, ...Object.fromEntries(Object.entries(semantic).filter(([key]) => key !== 'schemaVersion'))};
}

module.exports = {
  assertDigest,
  assertFullSha,
  buildCollectionManifest,
  fragmentFilename,
  operationCount,
  sha256Digest,
};

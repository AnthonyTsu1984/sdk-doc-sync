'use strict';

const {digestSemantic} = require('../../../doc-ops-core/src/digest');
const {buildControlPlaneReviewManifest} = require('./review-manifest');

function routesToSpec(routes) {
  const paths = {};
  for (const route of routes) {
    paths[route.path] ||= {};
    paths[route.path][route.method.toLowerCase()] = {
      operationId: route.handler || `${route.method.toLowerCase()}-${route.path}`,
      'x-source-handler': route.handler,
      'x-source-request-type': route.requestType,
      'x-source-response-type': route.responseType,
      responses: {default: {description: 'Source inventory response'}},
    };
  }
  return {openapi: '3.0.3', info: {title: 'Source route inventory', version: 'latest'}, paths};
}

function buildSourceControlPlaneReview({baseInventory, headInventory}) {
  const base = new Map(baseInventory.services.map(service => [service.id, service]));
  const head = new Map(headInventory.services.map(service => [service.id, service]));
  const ids = [...new Set([...base.keys(), ...head.keys()])].sort();
  const services = ids.map(serviceId => {
    const before = base.get(serviceId) || {routes: [], status: 'CONTROLLER_MISSING'};
    const after = head.get(serviceId) || {routes: [], status: 'CONTROLLER_MISSING'};
    const manifest = buildControlPlaneReviewManifest({
      serviceId, repository: headInventory.repository, baseRevision: baseInventory.revision,
      headRevision: headInventory.revision, baseSpec: routesToSpec(before.routes), headSpec: routesToSpec(after.routes),
    });
    const blockers = ['CONTROLLER_MISSING', 'MAPPING_REQUIRED', 'OWNERSHIP_AMBIGUOUS'].includes(after.status)
      ? [{code: after.status, investigation: after.investigation || null}] : [];
    return {serviceId, status: after.status, blockers, manifest};
  });
  const review = {schemaVersion: 1, apiSurface: 'control-plane', source: {repository: headInventory.repository,
    baseRevision: baseInventory.revision, headRevision: headInventory.revision}, services,
    summary: {serviceCount: services.length, blockedServiceCount: services.filter(service => service.blockers.length).length,
      reviewUnitCount: services.reduce((count, service) => count + service.manifest.units.length, 0)}};
  return {...review, reviewDigest: digestSemantic(review)};
}

module.exports = {buildSourceControlPlaneReview, routesToSpec};

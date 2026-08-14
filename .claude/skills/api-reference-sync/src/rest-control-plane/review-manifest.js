'use strict';

const {digestSemantic} = require('../../../doc-ops-core/src/digest');

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace']);
const AUTHORING_KEYS = new Set(['x-i18n', 'examples', 'example']);

function stripAuthoring(value) {
  if (Array.isArray(value)) return value.map(stripAuthoring);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !AUTHORING_KEYS.has(key) && !key.startsWith('x-zdoc-'))
    .map(([key, child]) => [key, stripAuthoring(child)]));
}

function reviewUnitIdFor(serviceId, endpoint, method) {
  return `rest:control-plane:${serviceId}:${method.toLowerCase()}:${encodeURIComponent(endpoint)}`;
}

function collectRefs(value, refs = new Set()) {
  if (Array.isArray(value)) value.forEach(child => collectRefs(child, refs));
  else if (value && typeof value === 'object') {
    if (typeof value.$ref === 'string' && value.$ref.startsWith('#/components/')) refs.add(value.$ref);
    Object.values(value).forEach(child => collectRefs(child, refs));
  }
  return refs;
}

function inventory(spec) {
  const operations = new Map();
  const componentConsumers = new Map();
  for (const endpoint of Object.keys(spec.paths || {}).sort()) {
    const pathItem = spec.paths[endpoint];
    for (const method of Object.keys(pathItem || {}).sort()) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      const operation = pathItem[method];
      const key = `${method.toLowerCase()}|${endpoint}`;
      const refs = [...collectRefs(operation)].sort();
      operations.set(key, {endpoint, method: method.toLowerCase(), semantic: stripAuthoring(operation), refs});
      for (const ref of refs) {
        if (!componentConsumers.has(ref)) componentConsumers.set(ref, new Set());
        componentConsumers.get(ref).add(key);
      }
    }
  }
  const components = new Map();
  for (const [category, entries] of Object.entries(spec.components || {})) {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
    for (const name of Object.keys(entries).sort()) {
      const ref = `#/components/${category}/${name}`;
      components.set(ref, stripAuthoring(entries[name]));
    }
  }
  return {operations, components, componentConsumers};
}

function changedComponents(base, head) {
  const refs = new Set([...base.components.keys(), ...head.components.keys()]);
  return [...refs].filter(ref => digestSemantic(base.components.get(ref)) !== digestSemantic(head.components.get(ref))).sort();
}

function buildControlPlaneReviewManifest(options) {
  const base = inventory(options.baseSpec);
  const head = inventory(options.headSpec);
  const changed = changedComponents(base, head);
  const keys = new Set([...base.operations.keys(), ...head.operations.keys()]);
  for (const ref of changed) {
    for (const key of base.componentConsumers.get(ref) || []) keys.add(key);
    for (const key of head.componentConsumers.get(ref) || []) keys.add(key);
  }
  const units = [];
  for (const key of [...keys].sort()) {
    const before = base.operations.get(key);
    const after = head.operations.get(key);
    const operation = after || before;
    let action = 'NOOP';
    if (!before) action = 'ADD';
    else if (!after) action = 'REMOVE';
    else if (digestSemantic(before.semantic) !== digestSemantic(after.semantic)) action = after.semantic.deprecated === true && before.semantic.deprecated !== true ? 'DEPRECATE' : 'UPDATE';
    const affectedComponents = changed.filter(ref => before?.refs.includes(ref) || after?.refs.includes(ref));
    if (action === 'NOOP' && affectedComponents.length > 0) action = 'UPDATE';
    units.push({
      reviewUnitId: reviewUnitIdFor(options.serviceId, operation.endpoint, operation.method),
      apiSurface: 'control-plane',
      serviceId: options.serviceId,
      endpoint: operation.endpoint,
      method: operation.method,
      action,
      sourceEvidence: {
        repository: options.repository,
        baseRevision: options.baseRevision,
        revision: options.headRevision,
      },
      beforeDigest: before ? digestSemantic(before.semantic) : null,
      afterDigest: after ? digestSemantic(after.semantic) : null,
      affectedComponents,
      blockers: action === 'REMOVE' ? ['REST_CONTROL_PLANE_REMOVAL_REQUIRES_APPROVAL'] : [],
    });
  }
  const manifest = {
    schemaVersion: 1,
    apiSurface: 'control-plane',
    serviceId: options.serviceId,
    source: {repository: options.repository, baseRevision: options.baseRevision, headRevision: options.headRevision},
    units,
    changedComponents: changed.map(ref => ({ref, digest: head.components.has(ref) ? digestSemantic(head.components.get(ref)) : null})),
    summary: {unitCount: units.length, blockerCount: units.reduce((count, unit) => count + unit.blockers.length, 0)},
  };
  manifest.manifestDigest = digestSemantic(manifest);
  return manifest;
}

module.exports = {buildControlPlaneReviewManifest, inventory, reviewUnitIdFor};

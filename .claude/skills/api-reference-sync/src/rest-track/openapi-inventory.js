'use strict';

const {normalizeReleaseTrack} = require('./release-track');

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace']);
const LIFECYCLE_KEYS = ['x-added-at', 'x-last-modified', 'x-deprecated-since'];
const AUTHORING_KEYS = new Set(['x-i18n', 'examples', 'example']);
const COMPONENT_CATEGORIES = [
  'parameters',
  'headers',
  'requestBodies',
  'responses',
  'schemas',
];

function escapePointerSegment(segment) {
  return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
}

function pointerJoin(pointer, ...segments) {
  return `${pointer}/${segments.map(escapePointerSegment).join('/')}`;
}

function parsePointer(pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) {
    throw new Error(`REST_OPENAPI_POINTER_INVALID: ${JSON.stringify(pointer)}`);
  }
  return pointer.slice(1).split('/').map((segment) =>
    segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function resolvePointer(document, pointer) {
  let value = document;
  for (const segment of parsePointer(pointer)) {
    if (!value || typeof value !== 'object') return undefined;
    value = value[segment];
  }
  return value;
}

function isLocalRef(ref) {
  return typeof ref === 'string' && ref.startsWith('#/');
}

function readLifecycle(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
  const lifecycle = {};
  for (const key of LIFECYCLE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(node, key)) lifecycle[key] = node[key];
  }
  return Object.keys(lifecycle).length > 0 ? lifecycle : null;
}

function hasLifecycle(node) {
  return readLifecycle(node) !== null;
}

function stripAuthoring(value) {
  if (Array.isArray(value)) return value.map(stripAuthoring);
  if (!value || typeof value !== 'object') return value;

  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (AUTHORING_KEYS.has(key)) continue;
    if (key.startsWith('x-') && !LIFECYCLE_KEYS.includes(key)) continue;
    result[key] = stripAuthoring(entry);
  }
  return result;
}

function addElement(collection, pointerSet, element) {
  if (pointerSet.has(element.pointer)) return;
  pointerSet.add(element.pointer);
  collection.push(element);
}

function buildComponents(spec) {
  const components = new Map();
  for (const category of COMPONENT_CATEGORIES) {
    const group = spec.components?.[category] || {};
    for (const name of Object.keys(group).sort()) {
      const pointer = pointerJoin('#/components', category, name);
      components.set(pointer, {
        semantic: stripAuthoring(group[name]),
        referencedBy: new Set(),
      });
    }
  }
  return components;
}

function resolveLocalRef(spec, ref) {
  if (!isLocalRef(ref)) return null;
  const pointer = ref.slice(1);
  const node = resolvePointer(spec, pointer);
  if (node === undefined) throw new Error(`REST_OPENAPI_REF_MISSING: ${ref}`);
  return {node, pointer: ref};
}

function inventoryOpenApi(spec, options = {}) {
  const track = normalizeReleaseTrack(options.track);
  const sourceFile = options.sourceFile || '';
  const operations = new Map();
  const components = buildComponents(spec);

  function recordComponentRef(ref, unitId) {
    if (!isLocalRef(ref)) return;
    resolveLocalRef(spec, ref);
    if (components.has(ref)) components.get(ref).referencedBy.add(unitId);
  }

  function createUnit(endpoint, method, operation, operationPointer) {
    const normalizedMethod = method.toLowerCase();
    const unitId = `${track}|${endpoint}|${normalizedMethod}`;
    const elements = [];
    const elementPointers = new Set();
    const componentRefs = new Set();
    const seenRefs = new Set();
    const seenPointers = new Set();

    function pushElement(pointer, node, kind) {
      const lifecycle = readLifecycle(node);
      if (!lifecycle) return;
      addElement(elements, elementPointers, {
        identity: pointer,
        pointer,
        kind,
        lifecycle,
        semantic: stripAuthoring(node),
      });
    }

    function inventorySchema(node, pointer) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach((entry, index) => inventorySchema(entry, `${pointer}/${index}`));
        return;
      }
      if (node.$ref) {
        const ref = node.$ref;
        if (seenRefs.has(ref)) return;
        seenRefs.add(ref);
        recordComponentRef(ref, unitId);
        componentRefs.add(ref);
        const resolved = resolveLocalRef(spec, ref);
        if (resolved) inventorySchema(resolved.node, resolved.pointer);
        return;
      }
      if (seenPointers.has(pointer)) return;
      seenPointers.add(pointer);
      pushElement(pointer, node, pointer.includes('/properties/') ? 'schemaProperty' : 'schema');

      if (node.properties && typeof node.properties === 'object') {
        for (const [name, property] of Object.entries(node.properties)) {
          const propertyPointer = pointerJoin(pointer, 'properties', name);
          pushElement(propertyPointer, property, 'schemaProperty');
          inventorySchema(property, propertyPointer);
        }
      }

      for (const key of ['items', 'additionalProperties']) {
        if (node[key] && typeof node[key] === 'object') {
          inventorySchema(node[key], pointerJoin(pointer, key));
        }
      }

      for (const key of ['oneOf', 'anyOf', 'allOf']) {
        if (Array.isArray(node[key])) {
          node[key].forEach((branch, index) => {
            const branchPointer = pointerJoin(pointer, key, String(index));
            pushElement(branchPointer, branch, 'schemaBranch');
            inventorySchema(branch, branchPointer);
          });
        }
      }
    }

    function inventoryParameter(node, pointer) {
      if (!node || typeof node !== 'object') return;
      if (node.$ref) {
        const ref = node.$ref;
        if (!seenRefs.has(ref)) {
          seenRefs.add(ref);
          recordComponentRef(ref, unitId);
          componentRefs.add(ref);
          const resolved = resolveLocalRef(spec, ref);
          if (resolved) inventoryParameter(resolved.node, resolved.pointer);
        }
        return;
      }
      pushElement(pointer, node, 'parameter');
      if (node.schema) inventorySchema(node.schema, pointerJoin(pointer, 'schema'));
    }

    function inventoryRequestBody(node, pointer) {
      if (!node || typeof node !== 'object') return;
      if (node.$ref) {
        const ref = node.$ref;
        if (!seenRefs.has(ref)) {
          seenRefs.add(ref);
          recordComponentRef(ref, unitId);
          componentRefs.add(ref);
          const resolved = resolveLocalRef(spec, ref);
          if (resolved) inventoryRequestBody(resolved.node, resolved.pointer);
        }
        return;
      }
      pushElement(pointer, node, 'requestBody');
      if (node.content) {
        for (const [mediaType, media] of Object.entries(node.content)) {
          if (media && media.schema) {
            inventorySchema(media.schema, pointerJoin(pointer, 'content', mediaType, 'schema'));
          }
        }
      }
    }

    function inventoryResponse(node, pointer) {
      if (!node || typeof node !== 'object') return;
      if (node.$ref) {
        const ref = node.$ref;
        if (!seenRefs.has(ref)) {
          seenRefs.add(ref);
          recordComponentRef(ref, unitId);
          componentRefs.add(ref);
          const resolved = resolveLocalRef(spec, ref);
          if (resolved) inventoryResponse(resolved.node, resolved.pointer);
        }
        return;
      }
      pushElement(pointer, node, 'response');
      if (node.content) {
        for (const [mediaType, media] of Object.entries(node.content)) {
          if (media && media.schema) {
            inventorySchema(media.schema, pointerJoin(pointer, 'content', mediaType, 'schema'));
          }
        }
      }
    }

    pushElement(operationPointer, operation, 'operation');

    const pathItem = spec.paths?.[endpoint] || {};
    for (const [index, parameter] of [...(pathItem.parameters || []), ...(operation.parameters || [])].entries()) {
      const root = index < (pathItem.parameters || []).length ? 'pathItem' : 'operation';
      inventoryParameter(parameter, pointerJoin(operationPointer, root, 'parameters', String(index)));
    }
    if (operation.requestBody) {
      inventoryRequestBody(operation.requestBody, pointerJoin(operationPointer, 'requestBody'));
    }
    for (const [statusCode, response] of Object.entries(operation.responses || {})) {
      inventoryResponse(response, pointerJoin(operationPointer, 'responses', statusCode));
    }

    elements.sort((left, right) => left.pointer.localeCompare(right.pointer));
    operations.set(unitId, {
      endpoint,
      method: normalizedMethod,
      operationId: operation.operationId || `${normalizedMethod}:${endpoint}`,
      pointer: operationPointer,
      lifecycle: readLifecycle(operation),
      elements,
      componentRefs: [...componentRefs].sort(),
    });
  }

  const paths = Object.keys(spec.paths || {}).sort();
  for (const endpoint of paths) {
    const pathItem = spec.paths[endpoint] || {};
    for (const [method, operation] of Object.entries(pathItem)) {
      const normalizedMethod = method.toLowerCase();
      if (!HTTP_METHODS.has(normalizedMethod) || !operation || typeof operation !== 'object') continue;
      const operationPointer = `#/paths/${escapePointerSegment(endpoint)}/${normalizedMethod}`;
      createUnit(endpoint, method, operation, operationPointer);
    }
  }

  for (const component of components.values()) {
    component.referencedBy = [...component.referencedBy].sort();
  }

  return {
    track,
    sourceFile,
    operations,
    components,
  };
}

module.exports = {inventoryOpenApi, escapePointerSegment};

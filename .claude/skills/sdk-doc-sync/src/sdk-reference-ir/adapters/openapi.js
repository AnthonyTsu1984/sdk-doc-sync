'use strict';

const schema = require('../schema');

const UNSUPPORTED_COMBINATORS = ['oneOf', 'anyOf', 'not', 'discriminator'];
const MERGED_SCHEMA_METADATA = new WeakMap();
const LOWER_BOUNDS = ['minimum', 'exclusiveMinimum', 'minLength', 'minItems', 'minProperties'];
const UPPER_BOUNDS = ['maximum', 'exclusiveMaximum', 'maxLength', 'maxItems', 'maxProperties'];
const STRUCTURAL_KEYS = new Set([
  'type', 'description', 'enum', 'required', 'nullable', 'properties', 'items', 'allOf',
  ...LOWER_BOUNDS, ...UPPER_BOUNDS,
]);

function escapePointer(value) {
  return String(value).replace(/~/g, '~0').replace(/\//g, '~1');
}

function pointerValue(spec, pointer) {
  if (!pointer.startsWith('#/')) throw new Error(`Remote OpenAPI references are not supported: ${pointer}`);
  const segments = pointer.slice(2).split('/').map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
  let value = spec;
  for (const segment of segments) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, segment)) {
      throw new Error(`Missing OpenAPI reference: ${pointer}`);
    }
    value = value[segment];
  }
  return value;
}

function resolveNode(spec, value, pointer, stack = []) {
  if (!value || typeof value !== 'object' || !value.$ref) return { value, pointer, stack };
  const reference = value.$ref;
  if (!reference.startsWith('#/')) {
    throw new Error(`Remote OpenAPI references are not supported: ${reference}`);
  }
  if (stack.includes(reference)) {
    throw new Error(`OpenAPI reference cycle: ${[...stack, reference].join(' -> ')}`);
  }
  return resolveNode(spec, pointerValue(spec, reference), reference, [...stack, reference]);
}

function evidence(pointer, context) {
  return [schema.createEvidence({
    kind: 'openapi',
    locator: pointer,
    revision: String(context.revision || ''),
    confidence: 'direct',
  })];
}

function evidenceMany(pointers, context) {
  return [...new Set(pointers)].flatMap((pointer) => evidence(pointer, context));
}

function assertSupportedSchema(value, pointer) {
  for (const combinator of UNSUPPORTED_COMBINATORS) {
    if (Object.hasOwn(value || {}, combinator)) {
      throw new Error(`OPENAPI_UNSUPPORTED_COMBINATOR at ${pointer}/${combinator}`);
    }
  }
}

function directSchema(spec, raw, pointer, stack = []) {
  const resolved = resolveNode(spec, raw, pointer, stack);
  const value = resolved.value || {};
  assertSupportedSchema(value, resolved.pointer);
  const mergedMetadata = MERGED_SCHEMA_METADATA.get(value);
  if (mergedMetadata) {
    return {
      value,
      pointer: resolved.pointer,
      stack: resolved.stack,
      propertyPointers: mergedMetadata.propertyPointers,
      propertyEvidence: mergedMetadata.propertyEvidence,
      evidencePointers: mergedMetadata.evidencePointers,
    };
  }
  const propertyPointers = new Map();
  const propertyEvidence = new Map();
  for (const name of Object.keys(value.properties || {})) {
    const propertyPointer = `${resolved.pointer}/properties/${escapePointer(name)}`;
    propertyPointers.set(name, propertyPointer);
    propertyEvidence.set(name, [propertyPointer]);
  }
  return {
    value,
    pointer: resolved.pointer,
    stack: resolved.stack,
    propertyPointers,
    propertyEvidence,
    evidencePointers: [resolved.pointer],
  };
}

function schemaKind(spec, raw, pointer, stack = []) {
  const resolved = resolveSchema(spec, raw, pointer, stack);
  if (resolved.value.type === 'array') {
    const item = resolveSchema(spec, resolved.value.items || {}, `${resolved.pointer}/items`, resolved.stack);
    return `array<${item.value.type || (item.value.properties ? 'object' : '')}>`;
  }
  return resolved.value.type || (resolved.value.properties ? 'object' : '');
}

function equalValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function conflict(pointer, key, message) {
  throw new Error(`OPENAPI_ALLOF_CONFLICT at ${pointer}/${key}: ${message}`);
}

function mergeDescription(left, right) {
  return [...new Set([left, right].filter(Boolean))].join(' ');
}

function mergeBound(result, left, right, key, mode, pointer) {
  const leftHas = Object.hasOwn(left, key);
  const rightHas = Object.hasOwn(right, key);
  if (!leftHas && !rightHas) return;
  if (!leftHas) result[key] = right[key];
  else if (!rightHas) result[key] = left[key];
  else if (typeof left[key] === 'number' && typeof right[key] === 'number') {
    result[key] = mode === 'lower' ? Math.max(left[key], right[key]) : Math.min(left[key], right[key]);
  } else if (equalValue(left[key], right[key])) result[key] = left[key];
  else conflict(pointer, key, `incompatible values ${JSON.stringify(left[key])} and ${JSON.stringify(right[key])}`);
}

function assertPossibleRanges(value, pointer) {
  const lowerCandidates = [
    Object.hasOwn(value, 'minimum') ? { value: value.minimum, exclusive: false, key: 'minimum' } : null,
    Object.hasOwn(value, 'exclusiveMinimum') && typeof value.exclusiveMinimum === 'number'
      ? { value: value.exclusiveMinimum, exclusive: true, key: 'exclusiveMinimum' }
      : null,
  ].filter(Boolean);
  const upperCandidates = [
    Object.hasOwn(value, 'maximum') ? { value: value.maximum, exclusive: false, key: 'maximum' } : null,
    Object.hasOwn(value, 'exclusiveMaximum') && typeof value.exclusiveMaximum === 'number'
      ? { value: value.exclusiveMaximum, exclusive: true, key: 'exclusiveMaximum' }
      : null,
  ].filter(Boolean);
  const lower = lowerCandidates.sort((a, b) => b.value - a.value || Number(b.exclusive) - Number(a.exclusive))[0];
  const upper = upperCandidates.sort((a, b) => a.value - b.value || Number(b.exclusive) - Number(a.exclusive))[0];
  if (lower && upper && (lower.value > upper.value || (lower.value === upper.value && (lower.exclusive || upper.exclusive)))) {
    conflict(pointer, lower.key, `impossible range against ${upper.key}`);
  }
  for (const [minimumKey, maximumKey] of [
    ['minLength', 'maxLength'], ['minItems', 'maxItems'], ['minProperties', 'maxProperties'],
  ]) {
    if (Object.hasOwn(value, minimumKey)
      && Object.hasOwn(value, maximumKey)
      && value[minimumKey] > value[maximumKey]) {
      conflict(pointer, minimumKey, `impossible range against ${maximumKey}`);
    }
  }
}

function mergeResolvedSchemas(spec, left, right, pointer, stack) {
  const result = {};
  const leftType = left.value.type || (left.value.properties ? 'object' : left.value.items ? 'array' : '');
  const rightType = right.value.type || (right.value.properties ? 'object' : right.value.items ? 'array' : '');
  if (leftType && rightType && leftType !== rightType) {
    conflict(pointer, 'type', `incompatible values ${leftType} and ${rightType}`);
  }
  if (leftType || rightType) result.type = leftType || rightType;
  const description = mergeDescription(left.value.description, right.value.description);
  if (description) result.description = description;

  if (Array.isArray(left.value.enum) || Array.isArray(right.value.enum)) {
    if (!Array.isArray(left.value.enum)) result.enum = [...right.value.enum];
    else if (!Array.isArray(right.value.enum)) result.enum = [...left.value.enum];
    else {
      result.enum = left.value.enum.filter((candidate) => right.value.enum.some((item) => equalValue(item, candidate)));
      if (result.enum.length === 0) conflict(pointer, 'enum', 'intersection is empty');
    }
  }

  const leftNullable = Object.hasOwn(left.value, 'nullable');
  const rightNullable = Object.hasOwn(right.value, 'nullable');
  if (leftNullable || rightNullable) {
    result.nullable = leftNullable && rightNullable
      ? left.value.nullable === true && right.value.nullable === true
      : (leftNullable ? left.value.nullable : right.value.nullable);
  }

  for (const key of LOWER_BOUNDS) mergeBound(result, left.value, right.value, key, 'lower', pointer);
  for (const key of UPPER_BOUNDS) mergeBound(result, left.value, right.value, key, 'upper', pointer);

  const required = new Set([...(left.value.required || []), ...(right.value.required || [])]);
  if (required.size > 0) result.required = [...required];

  const propertyPointers = new Map();
  const propertyEvidence = new Map();
  const propertyNames = [...new Set([
    ...Object.keys(left.value.properties || {}),
    ...Object.keys(right.value.properties || {}),
  ])];
  if (propertyNames.length > 0) result.properties = {};
  for (const name of propertyNames) {
    const leftProperty = left.value.properties?.[name];
    const rightProperty = right.value.properties?.[name];
    const leftPointer = left.propertyPointers.get(name) || `${left.pointer}/properties/${escapePointer(name)}`;
    const rightPointer = right.propertyPointers.get(name) || `${right.pointer}/properties/${escapePointer(name)}`;
    if (leftProperty !== undefined && rightProperty !== undefined) {
      const merged = mergeResolvedSchemas(
        spec,
        resolveSchema(spec, leftProperty, leftPointer, left.stack),
        resolveSchema(spec, rightProperty, rightPointer, right.stack),
        `${pointer}/properties/${escapePointer(name)}`,
        stack,
      );
      result.properties[name] = merged.value;
      propertyPointers.set(name, leftPointer);
      propertyEvidence.set(name, merged.evidencePointers);
    } else if (leftProperty !== undefined) {
      result.properties[name] = leftProperty;
      propertyPointers.set(name, leftPointer);
      propertyEvidence.set(name, left.propertyEvidence.get(name) || [leftPointer]);
    } else {
      result.properties[name] = rightProperty;
      propertyPointers.set(name, rightPointer);
      propertyEvidence.set(name, right.propertyEvidence.get(name) || [rightPointer]);
    }
  }

  if (left.value.items !== undefined && right.value.items !== undefined) {
    const itemPointer = `${pointer}/items`;
    const mergedItems = mergeResolvedSchemas(
      spec,
      resolveSchema(spec, left.value.items, `${left.pointer}/items`, left.stack),
      resolveSchema(spec, right.value.items, `${right.pointer}/items`, right.stack),
      itemPointer,
      stack,
    );
    result.items = mergedItems.value;
  } else if (left.value.items !== undefined) result.items = left.value.items;
  else if (right.value.items !== undefined) result.items = right.value.items;

  const keys = new Set([...Object.keys(left.value), ...Object.keys(right.value)]);
  for (const key of keys) {
    if (STRUCTURAL_KEYS.has(key)) continue;
    const leftHas = Object.hasOwn(left.value, key);
    const rightHas = Object.hasOwn(right.value, key);
    if (!leftHas) result[key] = right.value[key];
    else if (!rightHas || equalValue(left.value[key], right.value[key])) result[key] = left.value[key];
    else conflict(pointer, key, `incompatible values ${JSON.stringify(left.value[key])} and ${JSON.stringify(right.value[key])}`);
  }
  assertPossibleRanges(result, pointer);
  const evidencePointers = [...new Set([
    ...(left.evidencePointers || [left.pointer]),
    ...(right.evidencePointers || [right.pointer]),
  ])];
  MERGED_SCHEMA_METADATA.set(result, { propertyPointers, propertyEvidence, evidencePointers });
  return { value: result, pointer, stack, propertyPointers, propertyEvidence, evidencePointers };
}

function mergeAllOf(spec, base, pointer, stack) {
  const parts = [];
  const own = { ...base.value };
  delete own.allOf;
  if (Object.keys(own).some((key) => !['description'].includes(key))) {
    parts.push(directSchema(spec, own, base.pointer, stack));
  }
  base.value.allOf.forEach((part, index) => {
    parts.push(resolveSchema(spec, part, `${base.pointer}/allOf/${index}`, stack));
  });

  if (parts.length === 0) return base;
  let merged = parts[0];
  for (const part of parts.slice(1)) merged = mergeResolvedSchemas(spec, merged, part, pointer, stack);
  if (base.value.description) {
    const value = {
      ...merged.value,
      description: mergeDescription(base.value.description, merged.value.description),
    };
    MERGED_SCHEMA_METADATA.set(value, {
      propertyPointers: merged.propertyPointers,
      propertyEvidence: merged.propertyEvidence,
      evidencePointers: merged.evidencePointers,
    });
    merged = { ...merged, value };
  }
  return merged;
}

function resolveSchema(spec, raw, pointer, stack = []) {
  const base = directSchema(spec, raw, pointer, stack);
  if (!Array.isArray(base.value.allOf)) return base;
  return mergeAllOf(spec, base, base.pointer, base.stack);
}

function schemaDisplay(spec, raw, pointer, stack) {
  return schemaKind(spec, raw, pointer, stack);
}

function normalizeField(
  spec,
  name,
  raw,
  required,
  pointer,
  context,
  stack = [],
  evidencePointers = [pointer],
) {
  const resolved = resolveSchema(spec, raw, pointer, stack);
  const value = resolved.value || {};
  const constraints = [];
  if (value.format) constraints.push(`format: ${value.format}`);
  if (value.nullable === true) constraints.push('nullable');
  if (value.nullable === false) constraints.push('non-nullable');
  if (Array.isArray(value.enum) && value.enum.length > 0) constraints.push(`enum: ${value.enum.join(', ')}`);
  for (const key of [
    'const', 'pattern', 'minimum', 'exclusiveMinimum', 'maximum', 'exclusiveMaximum',
    'minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties',
  ]) {
    if (Object.hasOwn(value, key)) constraints.push(`${key}: ${value[key]}`);
  }
  const children = [];
  if (value.type === 'array' && value.items) {
    const item = resolveSchema(spec, value.items, `${resolved.pointer}/items`, resolved.stack);
    const itemRequired = new Set(item.value?.required || []);
    for (const [childName, childSchema] of Object.entries(item.value?.properties || {})) {
      const childPointer = item.propertyPointers.get(childName) || `${item.pointer}/properties/${escapePointer(childName)}`;
      children.push(normalizeField(
        spec,
        childName,
        childSchema,
        itemRequired.has(childName),
        childPointer,
        context,
        item.stack,
        item.propertyEvidence.get(childName) || [childPointer],
      ));
    }
  } else {
    const childRequired = new Set(value.required || []);
    for (const [childName, childSchema] of Object.entries(value.properties || {})) {
      const childPointer = resolved.propertyPointers.get(childName) || `${resolved.pointer}/properties/${escapePointer(childName)}`;
      children.push(normalizeField(
        spec,
        childName,
        childSchema,
        childRequired.has(childName),
        childPointer,
        context,
        resolved.stack,
        resolved.propertyEvidence.get(childName) || [childPointer],
      ));
    }
  }
  const defaultValue = Object.hasOwn(value, 'default') ? value.default : null;
  return schema.createField({
    name,
    type: { display: schemaDisplay(spec, raw, pointer, stack), references: [] },
    required: required === true,
    defaultValue,
    description: String(value.description || ''),
    constraints,
    children,
    appliesWhen: null,
    evidence: evidenceMany(resolved.evidencePointers || evidencePointers, context),
  });
}

function normalizeObjectFields(spec, raw, pointer, context, stack = []) {
  const resolved = resolveSchema(spec, raw, pointer, stack);
  const required = new Set(resolved.value?.required || []);
  return Object.entries(resolved.value?.properties || {}).map(([name, child]) => {
    const childPointer = resolved.propertyPointers.get(name) || `${resolved.pointer}/properties/${escapePointer(name)}`;
    return normalizeField(
      spec,
      name,
      child,
      required.has(name),
      childPointer,
      context,
      resolved.stack,
      resolved.propertyEvidence.get(name) || [childPointer],
    );
  });
}

function normalizeParameter(spec, raw, pointer, context) {
  const resolved = resolveNode(spec, raw, pointer);
  const parameter = resolved.value || {};
  const normalized = normalizeField(
    spec,
    parameter.name,
    parameter.schema || {},
    parameter.required === true,
    `${resolved.pointer}/schema`,
    context,
    resolved.stack,
    [resolved.pointer],
  );
  return {
    location: parameter.in,
    field: schema.createField({
      ...normalized,
      description: String(parameter.description || normalized.description || ''),
      evidence: evidence(resolved.pointer, context),
    }),
  };
}

function mergeParameterEntries(spec, pathEntries, operationEntries) {
  const merged = [];
  const positions = new Map();
  for (const entry of [...pathEntries, ...operationEntries]) {
    const resolved = resolveNode(spec, entry.parameter, entry.pointer);
    const key = `${resolved.value?.in || ''}\u0000${resolved.value?.name || ''}`;
    if (positions.has(key)) merged[positions.get(key)] = entry;
    else {
      positions.set(key, merged.length);
      merged.push(entry);
    }
  }
  return merged;
}

function contentEntry(content) {
  if (!content || typeof content !== 'object') return [null, null];
  if (content['application/json']) return ['application/json', content['application/json']];
  return Object.entries(content)[0] || [null, null];
}

function normalizeExamples(
  operation,
  operationPointer,
  requestContentType,
  requestContent,
  responses,
  context,
) {
  const examples = [];
  (operation['x-codeSamples'] || []).forEach((sample, index) => {
    examples.push(schema.createExample({
      title: sample.label || sample.lang || '',
      description: '',
      language: 'rest',
      code: String(sample.source || ''),
      fence: String(sample.lang || '').toLowerCase() === 'curl' ? 'Bash' : 'PlainText',
      evidence: evidence(`${operationPointer}/x-codeSamples/${index}`, context),
    }));
  });
  if (requestContent?.example !== undefined) {
    examples.push(schema.createExample({
      title: 'Request body',
      description: '',
      language: 'rest',
      code: JSON.stringify(requestContent.example, null, 2),
      fence: 'JSON',
      evidence: evidence(`${operationPointer}/requestBody/content/${escapePointer(requestContentType)}/example`, context),
    }));
  }
  for (const response of responses) {
    if (response.example === undefined) continue;
    examples.push(schema.createExample({
      title: `${response.status} response`,
      description: '',
      language: 'rest',
      code: JSON.stringify(response.example, null, 2),
      fence: 'JSON',
      evidence: evidence(`${response.pointer}/content/${escapePointer(response.contentType)}/example`, context),
    }));
  }
  if (Array.isArray(context.examples)) examples.push(...context.examples.map((item) => schema.createExample(item)));
  return examples;
}

function responseOrder([left], [right]) {
  const rank = (status) => {
    if (/^[1-5]\d{2}$/.test(status)) return [0, Number(status)];
    if (/^[1-5]XX$/.test(status)) return [1, Number(status[0])];
    if (status === 'default') return [2, 0];
    return [3, status];
  };
  const leftRank = rank(left);
  const rightRank = rank(right);
  return leftRank[0] - rightRank[0] || (leftRank[1] < rightRank[1] ? -1 : leftRank[1] > rightRank[1] ? 1 : 0);
}

function securityDescriptor(spec, name, scopes, context) {
  const authPointer = `#/components/securitySchemes/${escapePointer(name)}`;
  const scheme = pointerValue(spec, authPointer);
  return {
    name,
    type: String(scheme.type || ''),
    scheme: scheme.scheme,
    bearerFormat: scheme.bearerFormat,
    in: scheme.in,
    parameterName: scheme.name,
    description: String(scheme.description || ''),
    scopes: Array.isArray(scopes) ? scopes.map(String) : [],
    evidence: evidence(authPointer, context),
  };
}

function normalizeSecurity(spec, operation, operationPointer, context) {
  const inherited = operation.security === undefined;
  const requirements = inherited ? (spec.security || []) : operation.security;
  const basePointer = inherited ? '#/security' : `${operationPointer}/security`;
  return requirements.map((requirement, index) => {
    const schemes = Object.entries(requirement || {}).map(([name, scopes]) => (
      securityDescriptor(spec, name, scopes, context)
    ));
    return {
      anonymous: schemes.length === 0,
      schemes,
      evidence: evidence(`${basePointer}/${index}`, context),
    };
  });
}

function toReferenceDocument(input, context = {}) {
  const { spec, path, method } = input || {};
  if (!spec || typeof spec !== 'object') throw new TypeError('OpenAPI adapter requires a spec object');
  const normalizedMethod = String(method || '').toLowerCase();
  const pathItem = spec.paths?.[path];
  const operation = pathItem?.[normalizedMethod];
  if (!operation) throw new Error(`OpenAPI operation not found: ${normalizedMethod.toUpperCase()} ${path}`);
  const operationPointer = `#/paths/${escapePointer(path)}/${escapePointer(normalizedMethod)}`;
  const operationEvidence = evidence(operationPointer, context);
  const pathItemPointer = `#/paths/${escapePointer(path)}`;
  const pathParameters = (pathItem.parameters || []).map((parameter, index) => ({
    parameter,
    pointer: `${pathItemPointer}/parameters/${index}`,
  }));
  const operationParameters = (operation.parameters || []).map((parameter, index) => ({
    parameter,
    pointer: `${operationPointer}/parameters/${index}`,
  }));
  const parameterEntries = mergeParameterEntries(spec, pathParameters, operationParameters);
  const parameters = parameterEntries.map(({ parameter, pointer }) => normalizeParameter(spec, parameter, pointer, context));
  const requestBodyPointer = `${operationPointer}/requestBody`;
  const requestBodyResolved = operation.requestBody
    ? resolveNode(spec, operation.requestBody, requestBodyPointer)
    : null;
  const requestBody = requestBodyResolved?.value || null;
  const [requestContentType, requestContent] = contentEntry(requestBody?.content);
  const bodyFields = requestContent?.schema
    ? normalizeObjectFields(
      spec,
      requestContent.schema,
      `${requestBodyResolved.pointer}/content/${escapePointer(requestContentType)}/schema`,
      context,
    )
    : [];
  const request = (parameters.length > 0 || requestBody) ? {
    contentType: requestContentType || '',
    path: parameters.filter((item) => item.location === 'path').map((item) => item.field),
    query: parameters.filter((item) => item.location === 'query').map((item) => item.field),
    header: parameters.filter((item) => item.location === 'header').map((item) => item.field),
    body: bodyFields,
    evidence: evidence(operation.requestBody ? requestBodyPointer : operationPointer, context),
  } : null;

  const responseDetails = [];
  const responses = Object.entries(operation.responses || {}).sort(responseOrder).map(([status, response]) => {
    const responsePointer = `${operationPointer}/responses/${escapePointer(status)}`;
    const resolved = resolveNode(spec, response, responsePointer);
    const [responseContentType, responseContent] = contentEntry(resolved.value?.content);
    const responseSchema = responseContent?.schema || {};
    const responseResolved = resolveSchema(
      spec,
      responseSchema,
      `${resolved.pointer}/content/${escapePointer(responseContentType || '')}/schema`,
      resolved.stack,
    );
    const normalized = {
      status,
      description: String(resolved.value?.description || ''),
      contentType: responseContentType || '',
      type: {
        display: responseResolved.value?.type || (responseResolved.value?.properties ? 'object' : ''),
        references: [],
      },
      fields: responseContent?.schema
        ? normalizeObjectFields(
          spec,
          responseSchema,
          `${resolved.pointer}/content/${escapePointer(responseContentType)}/schema`,
          context,
          resolved.stack,
        )
        : [],
      evidence: evidence(responsePointer, context),
    };
    responseDetails.push({
      status,
      example: responseContent?.example,
      contentType: responseContentType || '',
      pointer: responsePointer,
    });
    return normalized;
  });

  const security = normalizeSecurity(spec, operation, operationPointer, context);
  const authByName = new Map();
  for (const group of security) {
    for (const descriptor of group.schemes) {
      if (!authByName.has(descriptor.name)) authByName.set(descriptor.name, descriptor);
    }
  }
  const http = schema.createHttpMetadata({
    method: normalizedMethod.toUpperCase(),
    path,
    auth: [...authByName.values()],
    security,
    request,
    responses,
    evidence: operationEvidence,
  });
  const examples = normalizeExamples(
    operation,
    operationPointer,
    requestContentType,
    requestContent,
    responseDetails,
    context,
  );
  return schema.createReferenceDocument({
    identity: {
      kind: 'rest-operation',
      language: 'rest',
      name: String(operation.operationId || ''),
      title: String(context.title || operation.summary || operation.operationId || ''),
      stableId: `rest:${context.category || ''}:${operation.operationId || ''}`,
    },
    source: {
      repository: String(context.repository || ''),
      revision: String(context.revision || ''),
      file: String(context.file || ''),
      line: Number.isInteger(context.line) ? context.line : 0,
    },
    summary: String(context.summary ?? operation.description ?? operation.summary ?? ''),
    signatures: [schema.createSignature({
      display: `${normalizedMethod.toUpperCase()} ${path}`,
      inputs: [],
      evidence: operationEvidence,
    })],
    requestVariants: [],
    callableMembers: [],
    result: null,
    errors: [],
    examples,
    notes: Array.isArray(context.notes) ? context.notes : [],
    related: Array.isArray(context.related) ? context.related : [],
    audienceVariants: [],
    evidence: operationEvidence,
    http,
  });
}

module.exports = { toReferenceDocument };

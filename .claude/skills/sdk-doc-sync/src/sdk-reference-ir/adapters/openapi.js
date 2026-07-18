'use strict';

const schema = require('../schema');

const UNSUPPORTED_COMBINATORS = ['oneOf', 'anyOf', 'not', 'discriminator'];

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

  const merged = { type: '', description: '', required: [], properties: {} };
  const required = new Set();
  const descriptions = [];
  const propertyPointers = new Map();
  const propertyEvidence = new Map();
  for (const part of parts) {
    const partType = part.value.type || (part.value.properties ? 'object' : '');
    if (partType && merged.type && partType !== merged.type) {
      throw new Error(`OPENAPI_ALLOF_CONFLICT at ${pointer}: incompatible types ${merged.type} and ${partType}`);
    }
    if (partType) merged.type = partType;
    if (part.value.description && !descriptions.includes(part.value.description)) descriptions.push(part.value.description);
    for (const name of part.value.required || []) required.add(name);
    for (const [name, property] of Object.entries(part.value.properties || {})) {
      const propertyPointer = part.propertyPointers.get(name) || `${part.pointer}/properties/${escapePointer(name)}`;
      const sources = part.propertyEvidence.get(name) || [propertyPointer];
      if (Object.hasOwn(merged.properties, name)) {
        const previousPointer = propertyPointers.get(name);
        const previousKind = schemaKind(spec, merged.properties[name], previousPointer, stack);
        const nextKind = schemaKind(spec, property, propertyPointer, part.stack);
        if (previousKind && nextKind && previousKind !== nextKind) {
          throw new Error(`OPENAPI_ALLOF_CONFLICT at ${pointer}/properties/${escapePointer(name)}: incompatible property types ${previousKind} and ${nextKind}`);
        }
        const previous = merged.properties[name];
        const combinedDescriptions = [...new Set([previous.description, property.description].filter(Boolean))];
        merged.properties[name] = {
          ...previous,
          ...(Object.keys(previous).length === 0 ? property : {}),
          ...(combinedDescriptions.length > 0 ? { description: combinedDescriptions.join(' ') } : {}),
        };
        propertyEvidence.set(name, [...(propertyEvidence.get(name) || []), ...sources]);
      } else {
        merged.properties[name] = property;
        propertyPointers.set(name, propertyPointer);
        propertyEvidence.set(name, [...sources]);
      }
    }
  }
  merged.required = [...required];
  merged.description = [...new Set([base.value.description, ...descriptions].filter(Boolean))].join(' ');
  if (!merged.type && Object.keys(merged.properties).length > 0) merged.type = 'object';
  return { value: merged, pointer: base.pointer, stack, propertyPointers, propertyEvidence };
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
  if (Array.isArray(value.enum) && value.enum.length > 0) constraints.push(`enum: ${value.enum.join(', ')}`);
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
    evidence: evidenceMany(evidencePointers, context),
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

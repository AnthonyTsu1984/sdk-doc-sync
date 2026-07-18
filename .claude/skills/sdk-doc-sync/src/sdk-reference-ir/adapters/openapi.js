'use strict';

const schema = require('../schema');

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

function schemaDisplay(spec, raw, pointer, stack) {
  const resolved = resolveNode(spec, raw, pointer, stack);
  const value = resolved.value || {};
  if (value.type === 'array') {
    const item = resolveNode(spec, value.items || {}, `${resolved.pointer}/items`, resolved.stack);
    return `array<${item.value?.type || 'object'}>`;
  }
  return value.type || (value.properties ? 'object' : '');
}

function normalizeField(spec, name, raw, required, pointer, context, stack = [], evidencePointer = pointer) {
  const resolved = resolveNode(spec, raw, pointer, stack);
  const value = resolved.value || {};
  const constraints = [];
  if (value.format) constraints.push(`format: ${value.format}`);
  if (value.nullable === true) constraints.push('nullable');
  if (Array.isArray(value.enum) && value.enum.length > 0) constraints.push(`enum: ${value.enum.join(', ')}`);
  const children = [];
  if (value.type === 'array' && value.items) {
    const item = resolveNode(spec, value.items, `${resolved.pointer}/items`, resolved.stack);
    const itemRequired = new Set(item.value?.required || []);
    for (const [childName, childSchema] of Object.entries(item.value?.properties || {})) {
      children.push(normalizeField(
        spec,
        childName,
        childSchema,
        itemRequired.has(childName),
        `${item.pointer}/properties/${escapePointer(childName)}`,
        context,
        item.stack,
      ));
    }
  } else {
    const childRequired = new Set(value.required || []);
    for (const [childName, childSchema] of Object.entries(value.properties || {})) {
      children.push(normalizeField(
        spec,
        childName,
        childSchema,
        childRequired.has(childName),
        `${resolved.pointer}/properties/${escapePointer(childName)}`,
        context,
        resolved.stack,
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
    evidence: evidence(evidencePointer, context),
    allowRequiredDefault: required === true && defaultValue !== null,
  });
}

function normalizeObjectFields(spec, raw, pointer, context, stack = []) {
  const resolved = resolveNode(spec, raw, pointer, stack);
  const required = new Set(resolved.value?.required || []);
  return Object.entries(resolved.value?.properties || {}).map(([name, child]) => normalizeField(
    spec,
    name,
    child,
    required.has(name),
    `${resolved.pointer}/properties/${escapePointer(name)}`,
    context,
    resolved.stack,
  ));
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
    resolved.pointer,
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

function contentEntry(content) {
  if (!content || typeof content !== 'object') return [null, null];
  if (content['application/json']) return ['application/json', content['application/json']];
  return Object.entries(content)[0] || [null, null];
}

function normalizeExamples(operation, operationPointer, requestContent, responses, context) {
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
      evidence: evidence(`${operationPointer}/requestBody/content/application~1json/example`, context),
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
      evidence: evidence(`${response.pointer}/content/application~1json/example`, context),
    }));
  }
  if (Array.isArray(context.examples)) examples.push(...context.examples.map((item) => schema.createExample(item)));
  return examples;
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
  const parameterEntries = [
    ...(pathItem.parameters || []).map((parameter, index) => ({
      parameter,
      pointer: `${pathItemPointer}/parameters/${index}`,
    })),
    ...(operation.parameters || []).map((parameter, index) => ({
      parameter,
      pointer: `${operationPointer}/parameters/${index}`,
    })),
  ];
  const parameters = parameterEntries.map(({ parameter, pointer }) => normalizeParameter(
    spec,
    parameter,
    pointer,
    context,
  ));
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
  const responses = Object.entries(operation.responses || {}).map(([status, response]) => {
    const responsePointer = `${operationPointer}/responses/${escapePointer(status)}`;
    const resolved = resolveNode(spec, response, responsePointer);
    const [responseContentType, responseContent] = contentEntry(resolved.value?.content);
    const responseSchema = responseContent?.schema || {};
    const responseResolved = resolveNode(
      spec,
      responseSchema,
      `${resolved.pointer}/content/${escapePointer(responseContentType || '')}/schema`,
      resolved.stack,
    );
    const normalized = {
      status,
      description: String(resolved.value?.description || ''),
      contentType: responseContentType || '',
      type: { display: responseResolved.value?.type || (responseResolved.value?.properties ? 'object' : ''), references: [] },
      fields: responseContent?.schema
        ? normalizeObjectFields(spec, responseSchema, `${resolved.pointer}/content/${escapePointer(responseContentType)}/schema`, context, resolved.stack)
        : [],
      evidence: evidence(responsePointer, context),
    };
    responseDetails.push({ status, example: responseContent?.example, pointer: responsePointer });
    return normalized;
  });

  const security = operation.security ?? spec.security ?? [];
  const auth = [];
  for (const requirement of security) {
    for (const name of Object.keys(requirement || {})) {
      const authPointer = `#/components/securitySchemes/${escapePointer(name)}`;
      const scheme = pointerValue(spec, authPointer);
      auth.push({
        name,
        type: String(scheme.type || ''),
        in: scheme.in,
        parameterName: scheme.name,
        description: String(scheme.description || ''),
        evidence: evidence(authPointer, context),
      });
    }
  }

  const http = schema.createHttpMetadata({
    method: normalizedMethod.toUpperCase(),
    path,
    auth,
    request,
    responses,
    evidence: operationEvidence,
  });
  const examples = normalizeExamples(operation, operationPointer, requestContent, responseDetails, context);
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

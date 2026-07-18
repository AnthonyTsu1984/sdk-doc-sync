'use strict';

const DOCUMENT_KINDS = Object.freeze([
  'method',
  'function',
  'class',
  'enum',
  'struct',
  'interface',
  'command',
  'rest-operation',
]);
const LANGUAGES = Object.freeze(['python', 'java', 'node', 'go', 'cpp', 'zilliz-cli', 'rest']);
const MEMBER_KINDS = Object.freeze(['builder', 'option', 'request']);
const EVIDENCE_KINDS = Object.freeze(['source', 'openapi', 'existing-doc', 'curated']);
const CONFIDENCE_LEVELS = Object.freeze(['direct', 'derived', 'reviewed']);

function deepClone(value, seen = new Map()) {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  const clone = Array.isArray(value) ? [] : {};
  seen.set(value, clone);
  for (const [key, child] of Object.entries(value)) clone[key] = deepClone(child, seen);
  return clone;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function immutable(value) {
  return deepFreeze(deepClone(value));
}

function createEvidence({ kind, locator, revision, confidence = 'direct' } = {}) {
  return immutable({ kind, locator, revision, confidence });
}

function createTypeReference({ id, display = '', external = false } = {}) {
  return immutable({ id, display, external });
}

function createField({
  name,
  type = { display: '', references: [] },
  required = false,
  defaultValue = null,
  description = '',
  constraints = [],
  children = [],
  appliesWhen = null,
  evidence = [],
  allowRequiredDefault = false,
} = {}) {
  return immutable({
    name,
    type,
    required,
    defaultValue,
    description,
    constraints,
    children,
    appliesWhen,
    evidence,
    allowRequiredDefault,
  });
}

function createSignature({ display, inputs = [], evidence = [] } = {}) {
  return immutable({ display, inputs, evidence });
}

function createRequestVariant({
  id,
  title = '',
  description = '',
  signature = null,
  inputs = [],
  evidence = [],
} = {}) {
  return immutable({ id, title, description, signature, inputs, evidence });
}

function createCallableMember({ kind, name, signature = null, description = '', evidence = [] } = {}) {
  return immutable({ kind, name, signature, description, evidence });
}

function createResult({
  type = { display: '', references: [] },
  description = '',
  fields = [],
  evidence = [],
} = {}) {
  return immutable({ type, description, fields, evidence });
}

function createError({ name, condition = '', description = '', evidence = [] } = {}) {
  return immutable({ name, condition, description, evidence });
}

function createExample({ title, description = '', language, code, fence, evidence = [] } = {}) {
  return immutable({
    title,
    description,
    language,
    code,
    ...(fence !== undefined ? { fence } : {}),
    evidence,
  });
}

function createHttpMetadata({
  method,
  path,
  auth = [],
  security = [],
  request = null,
  responses = [],
  evidence = [],
} = {}) {
  return immutable({ method, path, auth, security, request, responses, evidence });
}

function createReferenceDocument({
  identity = {},
  source = {},
  summary = '',
  signatures = [],
  requestVariants = [],
  callableMembers = [],
  result = null,
  errors = [],
  examples = [],
  notes = [],
  related = [],
  audienceVariants = [],
  evidence = [],
  exampleOptional = false,
  http,
} = {}) {
  return immutable({
    schemaVersion: 1,
    identity,
    source,
    summary,
    signatures,
    requestVariants,
    callableMembers,
    result,
    errors,
    examples,
    notes,
    related,
    audienceVariants,
    evidence,
    exampleOptional,
    ...(http !== undefined ? { http } : {}),
  });
}

module.exports = {
  DOCUMENT_KINDS,
  LANGUAGES,
  MEMBER_KINDS,
  EVIDENCE_KINDS,
  CONFIDENCE_LEVELS,
  CONFIDENCE: CONFIDENCE_LEVELS,
  createReferenceDocument,
  referenceDocument: createReferenceDocument,
  createField,
  field: createField,
  createEvidence,
  evidence: createEvidence,
  createSignature,
  signature: createSignature,
  createRequestVariant,
  requestVariant: createRequestVariant,
  createCallableMember,
  callableMember: createCallableMember,
  createResult,
  result: createResult,
  createError,
  error: createError,
  createExample,
  example: createExample,
  createTypeReference,
  typeReference: createTypeReference,
  createHttpMetadata,
  httpMetadata: createHttpMetadata,
};

'use strict';

const schema = require('../schema');

function normalizeKind(kind, fallback = 'method') {
  const value = String(kind || fallback).toLowerCase();
  if (value === 'function') return 'function';
  if (value === 'class') return 'class';
  if (value === 'enum') return 'enum';
  if (value === 'struct') return 'struct';
  if (value === 'interface') return 'interface';
  if (value === 'command') return 'command';
  return fallback;
}

function collectEvidence(symbol, context = {}) {
  const items = [];
  if (context.revision && symbol.filePath && Number.isInteger(symbol.lineNumber) && symbol.lineNumber > 0) {
    items.push({
      kind: 'source',
      locator: `${symbol.filePath}:${symbol.lineNumber}`,
      revision: context.revision,
      confidence: 'direct',
    });
  }
  for (const key of ['evidence', 'reviewedEvidence', 'curatedEvidence']) {
    if (Array.isArray(context[key])) items.push(...context[key]);
  }
  const unique = new Map();
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const normalized = schema.createEvidence(item);
    unique.set(JSON.stringify(normalized), normalized);
  }
  return Array.from(unique.values());
}

function typeOf(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const references = Array.isArray(value.references)
      ? value.references.map((reference) => typeof reference === 'string'
        ? schema.createTypeReference({ id: reference })
        : schema.createTypeReference(reference))
      : [];
    return { display: String(value.display || ''), references };
  }
  return { display: value == null ? '' : String(value), references: [] };
}

function normalizeField(field = {}, evidence = [], overrides = {}) {
  const constraints = Array.isArray(field.constraints) ? Array.from(field.constraints) : [];
  if (field.kind && field.kind !== 'separator') constraints.push(`kind: ${field.kind}`);
  if (Array.isArray(field.choices) && field.choices.length > 0) {
    constraints.push(`choices: ${field.choices.join(', ')}`);
  }
  if (field.repeatable === true) constraints.push('repeatable');
  if (field.shorthand) constraints.push(`shorthand: ${field.shorthand}`);
  if (field.apiName) constraints.push(`api-name: ${field.apiName}`);
  if (field.position !== null && field.position !== undefined) constraints.push(`position: ${field.position}`);
  if (field.requiredUnless) constraints.push(`required-unless: ${field.requiredUnless}`);
  const defaultValue = Object.hasOwn(field, 'defaultValue')
    ? field.defaultValue
    : Object.hasOwn(field, 'default') ? field.default : null;
  const required = typeof field.required === 'boolean'
    ? field.required
    : ['positional', 'required'].includes(field.kind) && defaultValue === null;
  const children = field.children || field.fields || [];
  return schema.createField({
    name: String(overrides.name ?? field.name ?? field.argName ?? ''),
    type: typeOf(overrides.type ?? field.type),
    required: overrides.required ?? required,
    defaultValue,
    description: String(overrides.description ?? field.description ?? ''),
    constraints,
    children: Array.isArray(children) ? children.map((child) => normalizeField(child, evidence)) : [],
    appliesWhen: field.appliesWhen ?? field.requiredWhen ?? null,
    evidence: Array.isArray(field.evidence) && field.evidence.length > 0 ? field.evidence : evidence,
    allowRequiredDefault: field.allowRequiredDefault === true,
  });
}

function normalizeFields(fields, evidence) {
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((field) => field && field.kind !== 'separator' && field.name !== '*')
    .map((field) => normalizeField(field, evidence));
}

function makeSignature(display, inputs, evidence) {
  return schema.createSignature({
    display: display == null ? '' : String(display),
    inputs: normalizeFields(inputs, evidence),
    evidence,
  });
}

function makeRequestVariant(variant, evidence) {
  const inputs = normalizeFields(variant.inputs || variant.params, evidence);
  return schema.createRequestVariant({
    id: String(variant.id || ''),
    title: String(variant.title || ''),
    description: String(variant.description || ''),
    signature: makeSignature(variant.signature || '', variant.signatureInputs || variant.inputs || variant.params, evidence),
    inputs,
    evidence,
  });
}

function makeCallableMember(kind, member, evidence, signatureDisplay, signatureInputs = []) {
  return schema.createCallableMember({
    kind,
    name: String(member.name || ''),
    signature: makeSignature(signatureDisplay, signatureInputs, evidence),
    description: String(member.description || ''),
    evidence,
  });
}

function makeResult(result, evidence) {
  if (!result) return null;
  return schema.createResult({
    type: typeOf(result.type || result.returnType),
    description: String(result.description || ''),
    fields: normalizeFields(result.fields, evidence),
    evidence,
  });
}

function makeErrors(items, evidence) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => schema.createError({
    name: String(item.name || ''),
    condition: String(item.condition || ''),
    description: String(item.description || ''),
    evidence: Array.isArray(item.evidence) && item.evidence.length > 0 ? item.evidence : evidence,
  }));
}

function makeExamples(symbol, context, language, evidence) {
  const items = [];
  if (Array.isArray(context.examples)) items.push(...context.examples);
  if (Array.isArray(symbol.examples)) items.push(...symbol.examples);
  if (symbol.example && typeof symbol.example === 'object') items.push(symbol.example);
  return items.map((item) => schema.createExample({
    title: String(item.title || ''),
    description: String(item.description || ''),
    language: item.language || language,
    code: String(item.code || ''),
    evidence: Array.isArray(item.evidence) && item.evidence.length > 0 ? item.evidence : evidence,
  }));
}

function buildIdentity(symbol, context, language, kind) {
  const category = context.category || symbol.parentClass || symbol.category || '';
  const name = String(symbol.name || '');
  return {
    kind: normalizeKind(kind || symbol.kind, kind || 'method'),
    language,
    name,
    title: String(context.title || (kind === 'command' ? symbol.signature || name : `${name}()`)),
    stableId: [language, category, name].join(':'),
  };
}

function buildSource(symbol, context) {
  return {
    repository: String(context.repository || ''),
    revision: String(context.revision || ''),
    file: String(symbol.filePath || ''),
    line: Number.isInteger(symbol.lineNumber) ? symbol.lineNumber : 0,
  };
}

function buildAudienceVariants(context, evidence) {
  if (!Array.isArray(context.audienceVariants)) return [];
  return context.audienceVariants.map((variant) => ({
    audience: variant.audience,
    summary: String(variant.summary || ''),
    evidence: Array.isArray(variant.evidence) && variant.evidence.length > 0
      ? variant.evidence
      : evidence,
  }));
}

function buildReferenceDocument({
  symbol,
  context = {},
  language,
  kind,
  signatures = [],
  requestVariants = [],
  callableMembers = [],
  result = null,
  errors = [],
}) {
  const evidence = collectEvidence(symbol, context);
  return schema.createReferenceDocument({
    identity: buildIdentity(symbol, context, language, kind),
    source: buildSource(symbol, context),
    summary: String(context.summary ?? symbol.docstring ?? ''),
    signatures,
    requestVariants,
    callableMembers,
    result,
    errors,
    examples: makeExamples(symbol, context, language, evidence),
    notes: Array.isArray(context.notes) ? context.notes : [],
    related: Array.isArray(context.related) ? context.related : [],
    audienceVariants: buildAudienceVariants(context, evidence),
    evidence,
  });
}

module.exports = {
  collectEvidence,
  typeOf,
  normalizeField,
  normalizeFields,
  makeSignature,
  makeRequestVariant,
  makeCallableMember,
  makeResult,
  makeErrors,
  buildReferenceDocument,
};

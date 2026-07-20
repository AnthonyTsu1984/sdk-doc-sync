'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ir = require('../src/document-ir/schema');
const profiles = require('../src/renderers/sdk-layout-profiles');
const { validateSdkLayout } = require('../src/renderers/sdk-layout-validator');

function role(roleName, key = null) {
  return { metadata: { role: roleName, ...(key && { key }) } };
}

function validPython() {
  return ir.document([
    ir.paragraph([ir.text('Searches vectors.')], role('summary')),
    ir.heading(2, [ir.text('Request Syntax')], role('request-heading')),
    ir.codeBlock('client.search(data)', 'Python', role('request-signature', 'default')),
    ir.paragraph([ir.text('PARAMETERS:', ['bold'])], role('parameters-label')),
    ir.unorderedList([], role('parameters-list')),
    ir.paragraph([ir.text('RETURN TYPE:', ['bold'])], role('result-type-label')),
    ir.paragraph([ir.text('list')], role('result-type-value')),
    ir.paragraph([ir.text('RETURNS:', ['bold'])], role('returns-label')),
    ir.paragraph([ir.text('Returns matches.')], role('returns-description')),
    ir.paragraph([ir.text('EXCEPTIONS:', ['bold'])], role('exceptions-label')),
    ir.unorderedList([], role('exceptions-list')),
    ir.heading(2, [ir.text('Examples')], role('examples-heading')),
    ir.codeBlock('client.search([[0.1]])', 'Python', role('example-code', 'basic')),
  ]);
}

function mutable(documentIr) {
  return JSON.parse(JSON.stringify(documentIr));
}

function assertCode(documentIr, code, profile = profiles.python) {
  const result = validateSdkLayout(documentIr, profile);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === code), JSON.stringify(result.errors));
}

test('rejects body H1', () => {
  const candidate = mutable(validPython());
  candidate.children.unshift({
    type: 'heading', level: 1, children: [{ type: 'text', value: 'search()', marks: [] }],
  });
  assertCode(candidate, 'BODY_TITLE_FORBIDDEN');
});

test('rejects duplicate normalized signatures', () => {
  const candidate = mutable(validPython());
  candidate.children.splice(1, 0, {
    type: 'codeBlock', value: ' client.search(data); ', language: 'Python',
    metadata: { role: 'canonical-signature' },
  });
  assertCode(candidate, 'DUPLICATE_SIGNATURE');
});

test('rejects returns before parameters', () => {
  const candidate = mutable(validPython());
  const labelIndex = candidate.children.findIndex((node) => node.metadata?.role === 'returns-label');
  const descriptionIndex = candidate.children.findIndex((node) => node.metadata?.role === 'returns-description');
  const returns = candidate.children.splice(labelIndex, descriptionIndex - labelIndex + 1);
  candidate.children.splice(1, 0, ...returns);
  assertCode(candidate, 'SECTION_ORDER_INVALID');
});

test('rejects a label without content', () => {
  const candidate = mutable(validPython());
  candidate.children = candidate.children.filter((node) => node.metadata?.role !== 'returns-description');
  assertCode(candidate, 'SECTION_CONTENT_MISSING');
});

test('rejects a wrong request fence', () => {
  const candidate = mutable(validPython());
  candidate.children.find((node) => node.metadata?.role === 'request-signature').language = 'R';
  assertCode(candidate, 'CODE_FENCE_POLICY_INVALID');
});

test('rejects unknown semantic roles', () => {
  const candidate = mutable(validPython());
  candidate.children[0].metadata.role = 'mystery';
  assertCode(candidate, 'UNKNOWN_SEMANTIC_ROLE');
});

test('accepts a Java requestless method', () => {
  const candidate = ir.document([
    ir.paragraph([ir.text('Gets the version.')], role('summary')),
    ir.codeBlock('public String getVersion()', 'Java', role('canonical-signature')),
    ir.paragraph([ir.text('RETURNS:', ['bold'])], role('returns-label')),
    ir.paragraph([ir.text('String')], role('returns-type-value')),
    ir.paragraph([ir.text('Returns the version.')], role('returns-description')),
    ir.heading(2, [ir.text('Example')], role('examples-heading')),
    ir.codeBlock('client.getVersion();', 'Java', role('example-code')),
  ]);
  assert.deepEqual(validateSdkLayout(candidate, profiles.java), { valid: true, errors: [], warnings: [] });
});

test('accepts Node request variants with keyed parameter sections', () => {
  const candidate = ir.document([
    ir.paragraph([ir.text('Creates a collection.')], role('summary')),
    ir.codeBlock('client.createCollection(data)', 'TypeScript', role('canonical-signature')),
    ir.heading(2, [ir.text('Request Syntax')], role('request-heading')),
    ir.heading(3, [ir.text('Simple')], role('request-variant-heading', 'simple')),
    ir.codeBlock('client.createCollection({ dimension })', 'TypeScript', role('request-signature', 'simple')),
    ir.paragraph([ir.text('PARAMETERS:', ['bold'])], role('parameters-label', 'simple')),
    ir.unorderedList([], role('parameters-list', 'simple')),
    ir.heading(3, [ir.text('Schema')], role('request-variant-heading', 'schema')),
    ir.codeBlock('client.createCollection({ schema })', 'TypeScript', role('request-signature', 'schema')),
    ir.paragraph([ir.text('PARAMETERS:', ['bold'])], role('parameters-label', 'schema')),
    ir.unorderedList([], role('parameters-list', 'schema')),
    ir.paragraph([ir.text('RETURNS:', ['bold'])], role('returns-label')),
    ir.paragraph([ir.text('Promise')], role('returns-type-value')),
    ir.paragraph([ir.text('Resolves on success.')], role('returns-description')),
  ]);
  assert.deepEqual(validateSdkLayout(candidate, profiles.node), { valid: true, errors: [], warnings: [] });
});

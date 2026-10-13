'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const profiles = require('../src/renderers/sdk-layout-profiles');
const { buildApiSectionModel } = require('../src/sdk-doc-sync/api-section-model');

function textBlock(id, content, blockType = 2, style = {}) {
  const names = { 2: 'text', 3: 'heading1', 4: 'heading2', 5: 'heading3', 12: 'bullet', 14: 'code' };
  const name = names[blockType];
  return {
    block_id: id,
    parent_id: 'page',
    block_type: blockType,
    [name]: {
      elements: [{ text_run: { content, text_element_style: style } }],
      ...(blockType === 14 && { style: { language: 49 } }),
    },
  };
}

function document(children, blocks) {
  return [{ block_id: 'page', block_type: 1, children, page: { elements: [] } }, ...blocks];
}

function healthyPython({ requestTitle = 'Request Syntax', exampleTitle = 'Examples' } = {}) {
  const blocks = [
    textBlock('summary', 'Searches vectors.'),
    textBlock('request', requestTitle, 4),
    textBlock('request-code', 'client.search(data)', 14),
    textBlock('parameters', 'PARAMETERS:', 2, { bold: true }),
    textBlock('param', 'data - Query vectors.', 12),
    textBlock('return-type', 'RETURN TYPE:', 2, { bold: true }),
    textBlock('return-type-value', 'list'),
    textBlock('returns', 'RETURNS:', 2, { bold: true }),
    textBlock('returns-value', 'Returns matches.'),
    textBlock('exceptions', 'EXCEPTIONS:', 2, { bold: true }),
    textBlock('error', 'MilvusException', 12),
    textBlock('examples', exampleTitle, 4),
    textBlock('example-code', 'client.search([[0.1]])', 14),
  ];
  return document(blocks.map((block) => block.block_id), blocks);
}

test('parses a healthy Python API page into canonical section order', () => {
  const model = buildApiSectionModel(healthyPython(), profiles.python);
  assert.deepEqual(model.sections.map((section) => section.role), [
    'summary', 'request', 'parameters', 'result-type', 'returns', 'exceptions', 'examples',
  ]);
  assert.deepEqual(model.errors, []);
  assert.equal(model.requiresReviewedRebuild, false);
  assert.deepEqual(model.signatures.map((entry) => [entry.role, entry.blockId]), [
    ['request-signature', 'request-code'],
    ['example-code', 'example-code'],
  ]);
});

test('recognizes capitalization and singular example aliases', () => {
  const model = buildApiSectionModel(
    healthyPython({ requestTitle: 'Request syntax', exampleTitle: 'Example' }),
    profiles.python,
  );
  assert.deepEqual(model.errors, []);
  assert.ok(model.sections.some((section) => section.role === 'request'));
  assert.ok(model.sections.some((section) => section.role === 'examples'));
});

test('attaches rich blocks to the surrounding semantic section', () => {
  const blocks = healthyPython();
  const page = blocks[0];
  const insertAt = page.children.indexOf('param') + 1;
  page.children.splice(insertAt, 0, 'callout-1');
  blocks.push({
    block_id: 'callout-1', parent_id: 'page', block_type: 19,
    children: [], callout: { emoji_id: 'bulb' },
  });

  const model = buildApiSectionModel(blocks, profiles.python);
  assert.deepEqual(model.preserved, [{
    blockId: 'callout-1', blockType: 19, attachedToRole: 'parameters',
  }]);
  assert.deepEqual(model.errors, []);
});

test('classifies duplicate headings and body titles as reviewed rebuilds', () => {
  const blocks = healthyPython();
  blocks[0].children.unshift('body-title');
  blocks.splice(1, 0, textBlock('body-title', 'search()', 3));
  blocks[0].children.splice(blocks[0].children.indexOf('examples'), 0, 'examples-duplicate');
  blocks.push(textBlock('examples-duplicate', 'Examples', 4));

  const model = buildApiSectionModel(blocks, profiles.python);
  assert.ok(model.errors.some((error) => error.code === 'BODY_TITLE_PRESENT'));
  assert.ok(model.errors.some((error) => error.code === 'DUPLICATE_SECTION'));
  assert.equal(model.requiresReviewedRebuild, true);
});

test('classifies scrambled Python section order as a reviewed rebuild', () => {
  const blocks = healthyPython();
  const page = blocks[0];
  const exampleIds = ['examples', 'example-code'];
  page.children = page.children.filter((id) => !exampleIds.includes(id));
  page.children.splice(1, 0, ...exampleIds);

  const model = buildApiSectionModel(blocks, profiles.python);
  assert.ok(model.errors.some((error) => error.code === 'SECTION_ORDER_INVALID'));
  assert.equal(model.requiresReviewedRebuild, true);
});

function nodeFormatterLike() {
  const blocks = [
    textBlock('summary', 'A Formatter instance serializes buffered columns.'),
    textBlock('base-fence', 'interface Formatter', 14),
    textBlock('intro', 'The Formatter base is implemented by two classes.'),
    textBlock('json-heading', 'JsonFormatter', 4),
    textBlock('json-desc', 'Writes JSON import files.'),
    textBlock('json-fence', 'class JsonFormatter implements Formatter', 14),
    textBlock('json-params', 'PARAMETERS:', 2, { bold: true }),
    textBlock('json-param', 'dir - The output directory.', 12),
    textBlock('parquet-heading', 'ParquetFormatter', 4),
    textBlock('parquet-desc', 'Writes Parquet import files.'),
    textBlock('parquet-fence', 'class ParquetFormatter implements Formatter', 14),
    textBlock('parquet-params', 'PARAMETERS:', 2, { bold: true }),
    textBlock('parquet-param', 'dir - The output directory.', 12),
    textBlock('example-heading', 'Example{#example}', 4),
    textBlock('example-code', 'const formatter = new ParquetFormatter();', 14),
  ];
  return document(blocks.map((block) => block.block_id), blocks);
}

test('node implementation family: per-implementation H2 sections stay scoped (2026-10-13 Formatter ruling)', () => {
  const model = buildApiSectionModel(nodeFormatterLike(), profiles.node);
  assert.deepEqual(model.errors, []);
  assert.deepEqual(model.sections.map((section) => section.role), [
    'summary', 'canonical-signature', 'implementation:jsonformatter', 'implementation:parquetformatter', 'examples',
  ]);
  // The per-implementation PARAMETERS labels scope to their owning section;
  // neither becomes a page-level parameters section.
  assert.ok(!model.sections.some((section) => section.role === 'parameters'));
  // Two unknown-H2 sections do not trip the extensions duplicate rule.
  assert.equal(model.errors.filter((error) => error.code === 'DUPLICATE_SECTION').length, 0);
});

test('node implementation family: a repeated implementation heading stays a duplicate section', () => {
  const blocks = nodeFormatterLike();
  const page = blocks[0];
  page.children.splice(page.children.indexOf('json-heading') + 1, 0, 'json-heading-dup');
  blocks.push(textBlock('json-heading-dup', 'JsonFormatter', 4));
  const model = buildApiSectionModel(blocks, profiles.node);
  assert.ok(model.errors.some((error) => error.code === 'DUPLICATE_SECTION'));
  assert.equal(model.requiresReviewedRebuild, true);
});

test('profiles without the implementation family keep the generic extensions fallback', () => {
  const blocks = nodeFormatterLike();
  const model = buildApiSectionModel(blocks, profiles.java);
  assert.ok(model.sections.some((section) => section.role === 'extensions'));
  assert.ok(!model.sections.some((section) => section.role.startsWith('implementation:')));
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const profiles = require('../src/renderers/sdk-layout-profiles');
const { planApiReferencePatch } = require('../src/sdk-doc-sync/docx-section-patcher');

function block(id, content, blockType = 2, style = {}) {
  const names = { 2: 'text', 3: 'heading1', 4: 'heading2', 12: 'bullet', 14: 'code' };
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

function pythonDoc({ parameter = 'data - Query vectors.', request = 'client.search(data)', rich = false } = {}) {
  const blocks = [
    block('summary', 'Searches vectors.'),
    block('request', 'Request Syntax', 4),
    block('request-code', request, 14),
    block('parameters', 'PARAMETERS:', 2, { bold: true }),
    block('param', parameter, 12),
    block('returns', 'RETURNS:', 2, { bold: true }),
    block('returns-value', 'Returns matches.'),
    block('examples', 'Examples', 4),
    block('example-code', 'client.search([[0.1]])', 14),
  ];
  if (rich) {
    blocks.splice(5, 0, {
      block_id: 'callout', parent_id: 'page', block_type: 19,
      children: [], callout: { emoji_id: 'bulb' },
    });
  }
  return [
    { block_id: 'page', block_type: 1, children: blocks.map((entry) => entry.block_id), page: { elements: [] } },
    ...blocks,
  ];
}

test('plans one parameter section replacement without moving returns or examples', () => {
  const patch = planApiReferencePatch({
    currentBlocks: pythonDoc(),
    desiredBlocks: pythonDoc({ parameter: 'data - Updated query vectors.' }),
    profile: profiles.python,
  });

  assert.equal(patch.validation.valid, true);
  assert.equal(patch.strategy, 'targeted-semantic-patch');
  assert.deepEqual(patch.operations.map((operation) => operation.role), ['parameters']);
  assert.deepEqual(patch.operations[0].deleteBlockIds, ['parameters', 'param']);
  assert.ok(patch.operations[0].blocks.some((entry) => entry.block_id === 'param'));
  assert.equal(patch.operations.some((operation) => operation.role === 'examples'), false);
  assert.equal(Object.isFrozen(patch), true);
});

test('replaces request syntax without matching or replacing example code', () => {
  const patch = planApiReferencePatch({
    currentBlocks: pythonDoc(),
    desiredBlocks: pythonDoc({ request: 'client.search(data, filter=filter)' }),
    profile: profiles.python,
  });

  assert.deepEqual(patch.operations.map((operation) => operation.role), ['request']);
  assert.deepEqual(patch.operations[0].deleteBlockIds, ['request', 'request-code']);
  assert.equal(patch.operations[0].blocks.some((entry) => entry.block_id === 'example-code'), false);
});

test('preserves rich blocks attached to a replaced section', () => {
  const patch = planApiReferencePatch({
    currentBlocks: pythonDoc({ rich: true }),
    desiredBlocks: pythonDoc({ parameter: 'data - Updated query vectors.' }),
    profile: profiles.python,
  });

  assert.deepEqual(patch.preservedBlockIds, ['callout']);
  assert.deepEqual(patch.operations[0].deleteBlockIds, ['parameters', 'param']);
  assert.deepEqual(patch.operations[0].preserveBlockIds, ['callout']);
});

test('plans a scrambled page as a rebuild preview that requires repair-specific approval', () => {
  const current = pythonDoc();
  current[0].children = ['summary', 'examples', 'example-code', 'request', 'request-code', 'parameters', 'param', 'returns', 'returns-value'];

  const preview = planApiReferencePatch({
    currentBlocks: current,
    desiredBlocks: pythonDoc(),
    profile: profiles.python,
    documentToken: 'doc-1',
  });
  assert.equal(preview.validation.valid, true);
  assert.equal(preview.strategy, 'reviewed-full-body-rebuild');
  assert.deepEqual(preview.approval, {
    required: true,
    kind: 'REPAIR_WRITE_APPROVAL',
    documentToken: 'doc-1',
    preservedBlockIds: [],
  });
  assert.deepEqual(preview.operations.map((operation) => operation.type), ['rebuild-body']);
});

test('blocks planning when the live page structure cannot be modeled', () => {
  const patch = planApiReferencePatch({
    currentBlocks: [block('orphan', 'No page')],
    desiredBlocks: pythonDoc(),
    profile: profiles.python,
  });
  assert.equal(patch.validation.valid, false);
  assert.ok(patch.validation.errors.some((error) => error.code === 'PATCH_PLANNING_BLOCKED'));
});

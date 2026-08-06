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

test('preserves the live reference-synced wrapper instead of its source block ID', () => {
  const current = pythonDoc();
  current[0].children.splice(1, 0, 'reference-wrapper');
  current.splice(2, 0, {
    block_id: 'reference-wrapper',
    parent_id: 'page',
    block_type: 50,
    reference_synced: {
      source_document_id: 'insert-source-doc',
      source_block_id: 'insert-source-block',
    },
  });
  const desired = pythonDoc();
  desired[1].text.elements[0].text_run.content = 'Updated summary.';

  const patch = planApiReferencePatch({
    currentBlocks: current,
    desiredBlocks: desired,
    profile: profiles.python,
  });

  assert.equal(patch.validation.valid, true);
  assert.deepEqual(patch.currentModel.topLevelBlockIds.slice(0, 3), [
    'summary', 'reference-wrapper', 'request',
  ]);
  assert.deepEqual(patch.preservedBlockIds, ['reference-wrapper']);
  assert.deepEqual(patch.operations[0].preserveBlockIds, ['reference-wrapper']);
  assert.doesNotMatch(JSON.stringify(patch), /insert-source-block/);
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

test('reviewed rebuild excludes preserved rich blocks from deletion and records their desired placement', () => {
  const current = pythonDoc({ rich: true });
  current[0].children = ['summary', 'examples', 'example-code', 'request', 'request-code', 'parameters', 'param', 'callout', 'returns', 'returns-value'];

  const preview = planApiReferencePatch({
    currentBlocks: current,
    desiredBlocks: pythonDoc(),
    profile: profiles.python,
    documentToken: 'doc-rich',
  });

  assert.equal(preview.strategy, 'reviewed-full-body-rebuild');
  assert.equal(preview.operations[0].deleteBlockIds.includes('callout'), false);
  assert.deepEqual(preview.operations[0].preservedPlacements, [{ blockId: 'callout', insertAt: 5 }]);
});

test('scrambled source copied for a newer version rebuilds only the copy without repair approval', () => {
  const current = pythonDoc();
  current[0].children = ['summary', 'examples', 'example-code', 'request', 'request-code', 'parameters', 'param', 'returns', 'returns-value'];

  const preview = planApiReferencePatch({
    currentBlocks: current,
    desiredBlocks: pythonDoc(),
    profile: profiles.python,
    documentToken: 'historical-source',
    copyOnWrite: true,
  });

  assert.equal(preview.strategy, 'copy-full-body-rebuild');
  assert.equal(preview.approval, undefined);
  assert.deepEqual(preview.operations[0].deleteBlockIds, current[0].children);
});

test('structural copy updates rebuild the new copy in complete desired role order without repair approval', () => {
  const current = pythonDoc();
  const desired = pythonDoc();
  desired.splice(5, 0, block('members', 'BUILDER METHODS:', 2, { bold: true }), block('member', 'name - Member name.', 12));
  desired[0].children.splice(4, 0, 'members', 'member');

  const preview = planApiReferencePatch({
    currentBlocks: current,
    desiredBlocks: desired,
    profile: profiles.python,
    documentToken: 'source-doc',
    copyOnWrite: true,
  });

  assert.equal(preview.strategy, 'copy-full-body-rebuild');
  assert.equal(preview.approval, undefined);
  assert.deepEqual(preview.operations.map((operation) => operation.type), ['rebuild-body']);
  assert.deepEqual(preview.operations[0].deleteBlockIds, current[0].children);
  assert.deepEqual(preview.operations[0].blocks.map((entry) => entry.block_id), desired[0].children);
});

test('structural replacements use desired section positions when earlier sections change size', () => {
  const current = pythonDoc();
  current.splice(6, 0,
    block('param-extra-1', 'limit - Result limit.', 12),
    block('param-extra-2', 'offset - Result offset.', 12));
  current[0].children.splice(5, 0, 'param-extra-1', 'param-extra-2');

  const desired = pythonDoc();
  desired[9].code.elements[0].text_run.content = 'client.search([[0.2]])';
  desired.push(block('notes', 'Notes', 4), block('note', 'Aggregation details.'));
  desired[0].children.push('notes', 'note');

  const preview = planApiReferencePatch({
    currentBlocks: current,
    desiredBlocks: desired,
    profile: profiles.python,
  });

  assert.equal(preview.strategy, 'ordered-section-replacement');
  const examples = preview.operations.find((operation) => operation.role === 'examples');
  assert.equal(examples.insertAt, 7);
});

test('plans an explicitly reviewed preserved block placement in the desired document order', () => {
  const current = pythonDoc({ rich: true });
  current.push(block('notes', 'Notes', 4), block('note', 'Duplicate callout guidance.', 12));
  current[0].children.push('notes', 'note');
  current[0].children.push(current[0].children.splice(current[0].children.indexOf('callout'), 1)[0]);

  const desired = pythonDoc({
    parameter: 'data - Updated query vectors.',
    request: 'client.search(data, filter=filter)',
  });
  desired[1].text.elements[0].text_run.content = 'Updated search summary.';
  desired[7].text.elements[0].text_run.content = 'Returns updated matches.';
  desired[9].code.elements[0].text_run.content = 'client.search([[0.2]])';

  const preview = planApiReferencePatch({
    currentBlocks: current,
    desiredBlocks: desired,
    profile: profiles.python,
    preservedBlockPlacements: [{ blockId: 'callout', role: 'summary', offset: 1 }],
  });

  assert.equal(preview.strategy, 'ordered-section-replacement');
  assert.deepEqual(preview.preservedPlacements, [{ blockId: 'callout', insertAt: 1 }]);
  assert.equal(preview.operations.some((operation) => (
    operation.blocks || []
  ).some((entry) => entry.block_type === 19)), false);
});

test('plans creation of a reviewed native callout that is absent from the live summary', () => {
  const desired = pythonDoc();
  desired.splice(2, 0, {
    block_id: 'desired-callout', parent_id: 'page', block_type: 19,
    children: [], callout: { emoji_id: 'blue_book', background_color: 2, border_color: 2 },
  });
  desired[0].children.splice(1, 0, 'desired-callout');

  const preview = planApiReferencePatch({
    currentBlocks: pythonDoc(),
    desiredBlocks: desired,
    profile: profiles.python,
  });

  const summary = preview.operations.find((operation) => operation.role === 'summary');
  assert.deepEqual(summary.blocks.map((entry) => entry.block_type), [2, 19]);
});

test('copy rebuild retains nested desired block hierarchy in the immutable patch plan', () => {
  const desired = pythonDoc();
  desired[5].children = [{
    block_id: 'nested-member',
    parent_id: 'param',
    block_type: 12,
    bullet: { elements: [{ text_run: { content: 'nested member' } }] },
    children: [],
  }];

  const preview = planApiReferencePatch({
    currentBlocks: pythonDoc({ request: 'client.search(data, old=true)' }),
    desiredBlocks: desired,
    profile: profiles.python,
    copyOnWrite: true,
  });

  assert.equal(preview.strategy, 'targeted-semantic-patch');

  desired.splice(5, 0, block('members', 'BUILDER METHODS:', 2, { bold: true }));
  desired[0].children.splice(4, 0, 'members');
  const structuralPreview = planApiReferencePatch({
    currentBlocks: pythonDoc(),
    desiredBlocks: desired,
    profile: profiles.python,
    copyOnWrite: true,
  });
  const parameterBlock = structuralPreview.operations[0].blocks.find((entry) => entry.block_id === 'param');
  assert.equal(Object.isFrozen(parameterBlock.children[0]), true);
  assert.equal(parameterBlock.children[0].bullet.elements[0].text_run.content, 'nested member');
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

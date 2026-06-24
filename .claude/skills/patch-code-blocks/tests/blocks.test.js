const test = require('node:test');
const assert = require('node:assert/strict');
const { extractSections } = require('../src/blocks');
const fixture = require('./fixtures/blocks.sample.json');

test('extracts heading-keyed sections from nested descendants', () => {
  const sections = extractSections(fixture);

  assert.equal(sections.length, 3);
  assert.equal(sections[0].operationKey, 'create-collection');
  assert.equal(sections[1].operationKey, 'drop-collection');
  assert.equal(sections[2].heading, '!!!');
  assert.equal(sections[2].operationKey, 'section-3');
  assert.ok(sections.every((section) => section.codeBlocks.length > 0));
});

test('restores parent heading when traversing sibling blocks after nested heading', () => {
  const blocks = [
    { block_id: 'root', block_type: 1, children: ['parent'] },
    {
      block_id: 'parent',
      block_type: 3,
      heading1: { elements: [{ text_run: { content: 'Parent Heading' } }] },
      children: ['child', 'code-parent'],
    },
    {
      block_id: 'child',
      block_type: 4,
      heading2: { elements: [{ text_run: { content: 'Child Heading' } }] },
      children: ['code-child'],
    },
    {
      block_id: 'code-child',
      block_type: 14,
      code: { language: 'Python', elements: [{ text_run: { content: 'child()' } }] },
    },
    {
      block_id: 'code-parent',
      block_type: 14,
      code: { language: 'Python', elements: [{ text_run: { content: 'parent()' } }] },
    },
  ];

  const sections = extractSections(blocks);
  assert.equal(sections.length, 2);

  const parentSection = sections.find((section) => section.heading === 'Parent Heading');
  const childSection = sections.find((section) => section.heading === 'Child Heading');

  assert.ok(parentSection);
  assert.ok(childSection);
  assert.deepEqual(
    parentSection.codeBlocks.map((block) => block.code),
    ['parent()']
  );
  assert.deepEqual(
    childSection.codeBlocks.map((block) => block.code),
    ['child()']
  );
});

test('keeps repeated heading names as distinct sections', () => {
  const blocks = [
    { block_id: 'root', block_type: 1, children: ['example-1', 'example-2'] },
    {
      block_id: 'example-1',
      block_type: 3,
      heading1: { elements: [{ text_run: { content: 'Example' } }] },
      children: ['code-1'],
    },
    {
      block_id: 'code-1',
      block_type: 14,
      code: { language: 'Python', elements: [{ text_run: { content: 'first()' } }] },
    },
    {
      block_id: 'example-2',
      block_type: 3,
      heading1: { elements: [{ text_run: { content: 'Example' } }] },
      children: ['code-2'],
    },
    {
      block_id: 'code-2',
      block_type: 14,
      code: { language: 'Python', elements: [{ text_run: { content: 'second()' } }] },
    },
  ];

  const sections = extractSections(blocks);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].heading, 'Example');
  assert.equal(sections[1].heading, 'Example');
  assert.deepEqual(
    sections.map((section) => section.codeBlocks.map((block) => block.code)),
    [['first()'], ['second()']]
  );
});

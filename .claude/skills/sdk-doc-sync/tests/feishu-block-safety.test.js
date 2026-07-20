'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertPublishableContent,
  validateRenderedApiBlocks,
} = require('../src/sdk-doc-sync/feishu-block-safety');

function textBlock(content, blockId = `block-${content}`) {
  return {
    block_id: blockId,
    block_type: 2,
    text: {
      elements: [{
        text_run: {
          content,
          text_element_style: {},
        },
      }],
    },
  };
}

test('rejects internal review notes in publishable SDK artifacts', () => {
  assert.throws(
    () => assertPublishableContent('## Notes\n\nReviewed grouping approved for pymilvus v2.6.12..v2.6.17.'),
    /INTERNAL_REVIEW_NOTE/,
  );
});

test('rejects generic generated return placeholders', () => {
  assert.throws(
    () => assertPublishableContent('**RETURNS:**\n\nReturn value for dump_messages.'),
    /GENERIC_RETURN_PLACEHOLDER/,
  );
});

test('rejects visibly escaped python identifiers in rendered Docx blocks', () => {
  const result = validateRenderedApiBlocks([
    textBlock('dump\\_messages()'),
    textBlock('Request Syntax'),
  ]);

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((error) => error.code), ['ESCAPED_IDENTIFIER']);
});

test('rejects escaped identifiers with digits or leading underscores', () => {
  const result = validateRenderedApiBlocks([
    textBlock('field2\\_name'),
    textBlock('_private\\_name'),
  ]);

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((error) => error.code), [
    'ESCAPED_IDENTIFIER',
    'ESCAPED_IDENTIFIER',
  ]);
});

test('rejects visible Markdown punctuation escapes in rendered Docx blocks', () => {
  const result = validateRenderedApiBlocks([
    textBlock('\\[REQUIRED\\]'),
  ]);

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((error) => error.code), ['VISIBLE_MARKDOWN_ESCAPE']);
});

test('accepts normal API-reference block text', () => {
  const result = validateRenderedApiBlocks([
    textBlock('dump_messages()'),
    textBlock('Request Syntax'),
    textBlock('PARAMETERS:'),
    textBlock('RETURNS:'),
    textBlock('Examples'),
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

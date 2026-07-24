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

function linkedTextBlock(content, {
  blockId = 'linked-text-block',
  url = 'https://zilliverse.feishu.cn/docx/TargetToken',
  inlineCode = false,
} = {}) {
  return {
    block_id: blockId,
    block_type: 2,
    text: {
      elements: [{
        text_run: {
          content,
          text_element_style: {
            link: { url },
            inline_code: inlineCode,
          },
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
  assert.throws(
    () => assertPublishableContent('Generated from the user-approved Java v3.0.x grouping review.'),
    /INTERNAL_REVIEW_NOTE/,
  );
  assert.throws(
    () => assertPublishableContent('Reviewed for milvus-sdk-java abc123..def456.'),
    /INTERNAL_REVIEW_NOTE/,
  );
});

test('rejects internal helper-grouping instructions in artifacts and rendered blocks', () => {
  const note = 'Keep request, response, builder, ordering, aggregation, and progress helper types embedded in this owning public interface page.';
  assert.throws(
    () => assertPublishableContent(`## Notes\n\n- ${note}`),
    /INTERNAL_GROUPING_NOTE/,
  );

  const result = validateRenderedApiBlocks([textBlock(note)]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((error) => error.code), ['INTERNAL_GROUPING_NOTE']);
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

test('rejects audience markers that swallow a Markdown heading into one text block', () => {
  const result = validateRenderedApiBlocks([
    textBlock('<include target="zilliz">\n### CloudDescribeImportRequest\n\n'),
  ]);

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((error) => error.code), ['LITERAL_AUDIENCE_HEADING']);
});

test('rejects linked inline-code labels rendered as literal Markdown backticks', () => {
  const result = validateRenderedApiBlocks([
    linkedTextBlock('`StructFieldSchema`'),
  ]);

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((error) => error.code), [
    'LINKED_CODE_RENDERED_AS_LITERAL_BACKTICKS',
  ]);
});

test('accepts a canonical link whose label is real inline code', () => {
  const result = validateRenderedApiBlocks([
    linkedTextBlock('StructFieldSchema', { inlineCode: true }),
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('Java validation rejects linked API identifiers without inline-code styling even when no inventory was declared', () => {
  const result = validateRenderedApiBlocks([
    linkedTextBlock('StructFieldSchema'),
  ], {
    requireLinkedIdentifiersInlineCode: true,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((error) => error.code), [
    'LINKED_API_IDENTIFIER_NOT_INLINE_CODE',
  ]);
});

test('Java linked-identifier validation does not classify ordinary prose links as code', () => {
  const result = validateRenderedApiBlocks([
    linkedTextBlock('Zilliz Cloud documentation'),
  ], {
    requireLinkedIdentifiersInlineCode: true,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('rejects a required canonical reference when its link is not inline code', () => {
  const url = 'https://zilliverse.feishu.cn/docx/TargetToken';
  const result = validateRenderedApiBlocks([
    linkedTextBlock('StructFieldSchema', { url, inlineCode: false }),
  ], {
    requiredLinkedInlineCode: [{ text: 'StructFieldSchema', url }],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((error) => error.code), [
    'REQUIRED_LINKED_INLINE_CODE_MISSING',
  ]);
});

test('accepts a required canonical reference only when link and inline code coexist', () => {
  const url = 'https://zilliverse.feishu.cn/docx/TargetToken';
  const result = validateRenderedApiBlocks([
    linkedTextBlock('StructFieldSchema', { url, inlineCode: true }),
  ], {
    requiredLinkedInlineCode: [{ text: 'StructFieldSchema', url }],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
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

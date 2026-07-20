'use strict';

class FeishuBlockSafetyError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = 'FeishuBlockSafetyError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function assertPublishableContent(content) {
  const value = String(content || '');
  if (/Reviewed grouping approved/i.test(value)) {
    throw new FeishuBlockSafetyError(
      'INTERNAL_REVIEW_NOTE',
      'Internal grouping review notes must not be published into API reference pages',
    );
  }
  if (/\bReturn value for [A-Za-z_][\w.]*\.?/i.test(value)) {
    throw new FeishuBlockSafetyError(
      'GENERIC_RETURN_PLACEHOLDER',
      'Generic generated return placeholders must be replaced with reviewed source-backed content',
    );
  }
  if (/\b(?:Brief description|Usage example|List relevant exceptions)\b/i.test(value)) {
    throw new FeishuBlockSafetyError(
      'LEGACY_SCAFFOLD_ARTIFACT',
      'Legacy scaffold text must not be published',
    );
  }
}

function blockText(block) {
  const typeName = Object.keys(block || {}).find((key) => block[key]?.elements);
  const elements = block?.[typeName]?.elements || block?.text?.elements || [];
  return elements.map((element) => element.text_run?.content || '').join('');
}

function validateRenderedApiBlocks(blocks) {
  const errors = [];
  const texts = (blocks || []).map((block) => ({ blockId: block.block_id, text: blockText(block) }));

  for (const entry of texts) {
    if (/[A-Za-z_][A-Za-z0-9_]*\\_[A-Za-z0-9_]+/.test(entry.text)) {
      errors.push({
        code: 'ESCAPED_IDENTIFIER',
        blockId: entry.blockId,
        text: entry.text,
      });
    }
    if (/\\[\[\]*]/.test(entry.text)) {
      errors.push({
        code: 'VISIBLE_MARKDOWN_ESCAPE',
        blockId: entry.blockId,
        text: entry.text,
      });
    }
    try {
      assertPublishableContent(entry.text);
    } catch (error) {
      errors.push({
        code: error.code || 'UNPUBLISHABLE_TEXT',
        blockId: entry.blockId,
        text: entry.text,
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

module.exports = {
  FeishuBlockSafetyError,
  assertPublishableContent,
  validateRenderedApiBlocks,
};

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
  if (/(?:Reviewed grouping approved|Generated from (?:the )?user-approved[^\n]{0,120}grouping review|Reviewed for [^\n]{1,160}(?:\.\.| through )[^\n]{1,160})/i.test(value)) {
    throw new FeishuBlockSafetyError(
      'INTERNAL_REVIEW_NOTE',
      'Internal grouping review notes must not be published into API reference pages',
    );
  }
  if (/(?:\bPhase [1-5]\b|\bBitable\b|\bCurrent Drive ancestry and shared-token status\b|\bcurrently share document token\b|\brecord inherits [^\n]{0,120}document token\b)/i.test(value)) {
    throw new FeishuBlockSafetyError(
      'INTERNAL_WORKFLOW_NOTE',
      'Internal release-planning and placement notes must not be published into API reference pages',
    );
  }
  if (/\bKeep\b[^\n]{0,240}\bembedded in (?:this|the) owning public interface page\b/i.test(value)) {
    throw new FeishuBlockSafetyError(
      'INTERNAL_GROUPING_NOTE',
      'Internal helper-grouping instructions must not be published into API reference pages',
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

function blockElements(block) {
  const typeName = Object.keys(block || {}).find((key) => block[key]?.elements);
  return block?.[typeName]?.elements || block?.text?.elements || [];
}

function linkUrl(style) {
  return typeof style?.link === 'string' ? style.link : style?.link?.url || null;
}

function looksLikeApiIdentifier(value) {
  const text = String(value || '');
  return /^[A-Z][a-z0-9_$]+(?:[A-Z][A-Za-z0-9_$]*)+$/.test(text)
    || /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*\([^\n)]*\)$/.test(text);
}

function validateRenderedApiBlocks(blocks, {
  requiredLinkedInlineCode = [],
  requireLinkedIdentifiersInlineCode = false,
} = {}) {
  const errors = [];
  const texts = (blocks || []).map((block) => ({ blockId: block.block_id, text: blockText(block) }));
  const runs = (blocks || []).flatMap((block) => blockElements(block).map((element) => ({
    blockId: block.block_id,
    run: element?.text_run,
  }))).filter((entry) => entry.run);

  for (const entry of texts) {
    if (/^<(?:include|exclude)\s+target="[^"]+">\s*\n#{1,6}\s+/i.test(entry.text)) {
      errors.push({
        code: 'LITERAL_AUDIENCE_HEADING',
        blockId: entry.blockId,
        text: entry.text,
      });
    }
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

  for (const block of blocks || []) {
    for (const element of blockElements(block)) {
      const run = element?.text_run;
      const style = run?.text_element_style || {};
      if (linkUrl(style) && /^`[^`\n]+`$/.test(run?.content || '') && style.inline_code !== true) {
        errors.push({
          code: 'LINKED_CODE_RENDERED_AS_LITERAL_BACKTICKS',
          blockId: block.block_id,
          text: run.content,
          link: linkUrl(style),
        });
      } else if (requireLinkedIdentifiersInlineCode
        && linkUrl(style)
        && looksLikeApiIdentifier(run?.content)
        && !requiredLinkedInlineCode.some((requirement) => requirement?.text === run?.content)
        && style.inline_code !== true) {
        errors.push({
          code: 'LINKED_API_IDENTIFIER_NOT_INLINE_CODE',
          blockId: block.block_id,
          text: run.content,
          link: linkUrl(style),
        });
      }
    }
  }

  for (const requirement of requiredLinkedInlineCode) {
    const matched = runs.some(({ run }) => {
      const style = run.text_element_style || {};
      return run.content === requirement?.text
        && style.inline_code === true
        && linkUrl(style) === requirement?.url;
    });
    if (!matched) {
      errors.push({
        code: 'REQUIRED_LINKED_INLINE_CODE_MISSING',
        text: requirement?.text || null,
        link: requirement?.url || null,
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

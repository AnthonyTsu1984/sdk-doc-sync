'use strict';

function textContainerName(block) {
  return Object.keys(block || {}).find((key) => block[key]?.elements) || null;
}

function textOf(block) {
  const typeName = textContainerName(block);
  return (block?.[typeName]?.elements || [])
    .map((element) => element.text_run?.content || '')
    .join('');
}

function findByText(blocks, pattern) {
  return (blocks || []).find((block) => pattern.test(textOf(block))) || null;
}

function indexOfBlock(blocks, block) {
  return (blocks || []).findIndex((entry) => entry?.block_id === block?.block_id);
}

function parameterNameFromBlock(block) {
  return textOf(block).split(/\s+-\s+/, 1)[0].trim();
}

function blockTextStyle(block) {
  const typeName = textContainerName(block);
  return block?.[typeName]?.elements?.[0]?.text_run?.text_element_style || {};
}

function parameterBlock(content, style = {}) {
  return {
    block_type: 12,
    bullet: {
      elements: [{
        text_run: {
          content,
          text_element_style: { ...style },
        },
      }],
    },
  };
}

function findSignatureBlock(blocks, requestHeading, parametersLabel) {
  const requestIndex = indexOfBlock(blocks, requestHeading);
  const parametersIndex = indexOfBlock(blocks, parametersLabel);
  if (requestIndex < 0 || parametersIndex < 0 || requestIndex >= parametersIndex) return null;
  const candidates = blocks
    .slice(requestIndex + 1, parametersIndex)
    .filter((block) => block.block_type === 14);
  return candidates.length === 1 ? candidates[0] : null;
}

function findParameterBlocks(blocks, parametersLabel) {
  const startIndex = (blocks || []).findIndex((block) => block.block_id === parametersLabel.block_id);
  if (startIndex < 0) return [];

  const parameterBlocks = [];
  for (const block of blocks.slice(startIndex + 1)) {
    if (block.block_type !== 12) break;
    parameterBlocks.push(block);
  }
  return parameterBlocks;
}

function planApiReferencePatch(blocks, updates = {}) {
  const requestHeading = findByText(blocks, /^\s*Request Syntax\s*$/);
  const parametersLabel = findByText(blocks, /^\s*PARAMETERS:\s*$/);
  const signatureBlock = requestHeading && parametersLabel
    ? findSignatureBlock(blocks || [], requestHeading, parametersLabel)
    : null;

  if (!requestHeading) {
    return {
      ok: false,
      errors: [{ code: 'SECTION_NOT_FOUND', section: 'request-syntax' }],
      operations: [],
    };
  }
  if (!parametersLabel) {
    return {
      ok: false,
      errors: [{ code: 'SECTION_NOT_FOUND', section: 'parameters' }],
      operations: [],
    };
  }
  if (!signatureBlock) {
    return {
      ok: false,
      errors: [{ code: 'SECTION_NOT_FOUND', section: 'signature' }],
      operations: [],
    };
  }

  const operations = [];
  if (updates.signature && textOf(signatureBlock) !== updates.signature) {
    operations.push({
      type: 'update_text',
      blockId: signatureBlock.block_id,
      text: updates.signature,
    });
  }

  const parameterBlocks = findParameterBlocks(blocks, parametersLabel);
  const existingByName = new Map(parameterBlocks.map((block) => [parameterNameFromBlock(block), block]));
  let insertionAnchor = parameterBlocks[parameterBlocks.length - 1] || parametersLabel;
  const style = parameterBlocks.length > 0 ? blockTextStyle(parameterBlocks[0]) : {};

  for (const parameter of updates.parameters || []) {
    const content = `${parameter.name} - ${parameter.description}`;
    const existing = existingByName.get(parameter.name);
    if (existing) {
      if (textOf(existing) !== content) {
        operations.push({
          type: 'update_text',
          blockId: existing.block_id,
          text: content,
        });
      }
      insertionAnchor = existing;
      continue;
    }

    const block = parameterBlock(content, style);
    operations.push({
      type: 'insert_after',
      afterBlockId: insertionAnchor.block_id,
      block,
    });
  }

  return {
    ok: true,
    errors: [],
    operations,
  };
}

module.exports = {
  planApiReferencePatch,
};

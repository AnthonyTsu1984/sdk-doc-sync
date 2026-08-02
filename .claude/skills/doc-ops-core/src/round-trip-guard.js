'use strict';

const PROTECTED_TYPES = new Set(['board', 'figma', 'image', 'opaque', 'sheet', 'supademo']);

function normalizedBlock(block, index) {
  return {
    id: String(block?.id || block?.blockId || `index:${index}`),
    type: String(block?.type || block?.kind || 'opaque').toLowerCase(),
  };
}

function inventoryDocument(document = {}) {
  const blocks = (document.blocks || []).map(normalizedBlock).sort((left, right) => left.id.localeCompare(right.id));
  const counts = {};
  for (const block of blocks) counts[block.type] = (counts[block.type] || 0) + 1;
  return {
    counts: Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))),
    blocks,
    protectedIds: blocks.filter(block => PROTECTED_TYPES.has(block.type)).map(block => block.id).sort(),
  };
}

function compareRoundTrip({ before, after, approvedLosses = [] } = {}) {
  const approved = new Set(approvedLosses);
  const afterIds = new Set((after?.blocks || []).map(block => block.id));
  const errors = [];
  for (const blockId of before?.protectedIds || []) {
    if (!afterIds.has(blockId) && !approved.has(blockId)) {
      const block = (before.blocks || []).find(item => item.id === blockId);
      errors.push({ code: 'PROTECTED_BLOCK_LOST', blockId, blockType: block?.type || null });
    }
  }
  errors.sort((left, right) => left.blockId.localeCompare(right.blockId));
  return { valid: errors.length === 0, errors };
}

module.exports = { PROTECTED_TYPES, inventoryDocument, compareRoundTrip };

'use strict';

const { canonicalize } = require('../../doc-ops-core/src/canonical-json');
const { digestSemantic } = require('../../doc-ops-core/src/digest');

function blockSemantic(block) {
  return canonicalize({
    blockId: block.blockId,
    type: block.type,
    childIndex: block.childIndex,
    languageLabel: block.languageLabel || null,
    code: block.code || null,
    text: block.text || null,
  });
}

function inventoryProcedureDocument({ documentId, revision, blocks = [], targetBlockIds = [] }) {
  if (!documentId || revision === undefined || revision === null) throw new TypeError('documentId and revision are required');
  const targetSet = new Set(targetBlockIds);
  const normalized = blocks.map(blockSemantic).sort((a, b) => a.childIndex - b.childIndex || a.blockId.localeCompare(b.blockId));
  const targetBlocks = normalized.filter((block) => targetSet.has(block.blockId)).map((block) => ({
    blockId: block.blockId,
    childIndex: block.childIndex,
    languageLabel: block.languageLabel,
    code: block.code,
  }));
  const protectedBlocks = normalized.filter((block) => !targetSet.has(block.blockId));
  const semantic = canonicalize({
    schemaVersion: 1,
    documentId,
    revision,
    blocks: normalized,
    targetBlocks,
    blocksDigest: digestSemantic(normalized),
    protectedSurroundingDigest: digestSemantic(protectedBlocks),
  });
  return Object.freeze({ ...semantic, snapshotDigest: digestSemantic(semantic) });
}

module.exports = { inventoryProcedureDocument };

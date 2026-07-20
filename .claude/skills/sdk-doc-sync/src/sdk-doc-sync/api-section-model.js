'use strict';

const { normalizeSignature } = require('../renderers/sdk-layout-validator');

const PRESERVED_BLOCK_TYPES = new Set([19, 23, 26, 27, 30, 31, 43, 49, 50]);

function textContainerName(block) {
  return Object.keys(block || {}).find((key) => block[key]?.elements) || null;
}

function textOf(block) {
  const name = textContainerName(block);
  return (block?.[name]?.elements || [])
    .map((element) => element.text_run?.content || element.mention_doc?.title || element.mention_url?.title || '')
    .join('')
    .trim();
}

function normalizedLabel(block) {
  return textOf(block).replace(/\s+/g, ' ').replace(/:$/, '').trim().toUpperCase();
}

function headingSection(block) {
  if (block?.block_type !== 4) return null;
  const value = textOf(block).replace(/\{#[^}]+\}$/, '').trim().toLowerCase();
  if (value === 'request syntax') return 'request';
  if (value === 'example' || value === 'examples') return 'examples';
  if (value === 'notes') return 'notes';
  if (value === 'related') return 'related';
  return 'extensions';
}

function labelSection(block, profile, currentRole) {
  if (block?.block_type !== 2) return null;
  const label = normalizedLabel(block);
  if (label === 'PARAMETERS') {
    return profile.id === 'node' && currentRole === 'request' ? null : 'parameters';
  }
  if (['BUILDER METHODS', 'OPTION METHODS', 'REQUEST METHODS', 'METHODS'].includes(label)) return 'members';
  if (label === 'RETURN TYPE') return 'result-type';
  if (label === 'RETURNS') return 'returns';
  if (['EXCEPTIONS', 'ERROR HANDLING'].includes(label)) return 'exceptions';
  return null;
}

function buildApiSectionModel(rawBlocks, profile) {
  if (!Array.isArray(rawBlocks)) throw new TypeError('buildApiSectionModel requires raw Docx blocks');
  if (!profile?.id || !Array.isArray(profile.order)) throw new TypeError('buildApiSectionModel requires a layout profile');

  const errors = [];
  const byId = new Map(rawBlocks.map((block) => [block.block_id, block]));
  const page = rawBlocks.find((block) => block.block_type === 1);
  if (!page || !Array.isArray(page.children)) {
    return {
      profileId: profile.id,
      pageBlockId: page?.block_id || null,
      topLevelBlockIds: [],
      sections: [],
      preserved: [],
      signatures: [],
      errors: [{ code: 'PAGE_STRUCTURE_INVALID', message: 'A page block with ordered children is required' }],
      requiresReviewedRebuild: true,
    };
  }

  const topLevelBlockIds = [...page.children];
  const topLevel = topLevelBlockIds.map((id, index) => {
    const block = byId.get(id);
    if (!block) errors.push({ code: 'MISSING_TOP_LEVEL_BLOCK', blockId: id, index });
    return block;
  }).filter(Boolean);

  const sections = [];
  let current = null;

  function startSection(role, index) {
    if (current) current.endIndex = index;
    current = { role, startIndex: index, endIndex: topLevel.length, blockIds: [], attachments: [] };
    sections.push(current);
  }

  for (let index = 0; index < topLevel.length; index += 1) {
    const block = topLevel[index];
    if (block.block_type === 3) {
      errors.push({ code: 'BODY_TITLE_PRESENT', blockId: block.block_id, index, text: textOf(block) });
      if (!current) startSection('summary', index);
      current.blockIds.push(block.block_id);
      continue;
    }

    const headingRole = headingSection(block);
    const labelRole = labelSection(block, profile, current?.role || null);
    let nextRole = headingRole || labelRole;
    if (!nextRole && block.block_type === 14 && (!current || current.role === 'summary')) {
      nextRole = 'canonical-signature';
    }
    if (!current) nextRole = nextRole || 'summary';
    if (nextRole && (nextRole !== current?.role || headingRole)) startSection(nextRole, index);
    current.blockIds.push(block.block_id);

    if (PRESERVED_BLOCK_TYPES.has(block.block_type)) {
      current.attachments.push(block.block_id);
    }
  }
  if (current) current.endIndex = topLevel.length;

  const seen = new Map();
  for (const section of sections) {
    if (section.role === 'extensions') continue;
    if (seen.has(section.role)) {
      errors.push({
        code: 'DUPLICATE_SECTION',
        role: section.role,
        firstIndex: seen.get(section.role).startIndex,
        index: section.startIndex,
      });
    } else {
      seen.set(section.role, section);
    }
  }

  const orderIndexes = new Map(profile.order.map((role, index) => [role, index]));
  let previous = -1;
  for (const section of sections) {
    const currentIndex = orderIndexes.get(section.role);
    if (currentIndex === undefined) continue;
    if (currentIndex < previous) {
      errors.push({ code: 'SECTION_ORDER_INVALID', role: section.role, index: section.startIndex });
    } else {
      previous = currentIndex;
    }
  }

  const preserved = [];
  const signatures = [];
  for (const section of sections) {
    for (const blockId of section.blockIds) {
      const block = byId.get(blockId);
      if (!block) continue;
      if (PRESERVED_BLOCK_TYPES.has(block.block_type)) {
        preserved.push({ blockId, blockType: block.block_type, attachedToRole: section.role });
      }
      if (block.block_type === 14) {
        const role = section.role === 'request'
          ? 'request-signature'
          : section.role === 'examples'
            ? 'example-code'
            : section.role === 'canonical-signature'
              ? 'canonical-signature'
              : 'code';
        signatures.push({ blockId, role, normalized: normalizeSignature(textOf(block)) });
      }
    }
  }

  return {
    profileId: profile.id,
    pageBlockId: page.block_id,
    topLevelBlockIds,
    sections,
    preserved,
    signatures,
    errors,
    requiresReviewedRebuild: errors.some((error) => [
      'BODY_TITLE_PRESENT',
      'DUPLICATE_SECTION',
      'SECTION_ORDER_INVALID',
      'PAGE_STRUCTURE_INVALID',
      'MISSING_TOP_LEVEL_BLOCK',
      'AMBIGUOUS_SECTION_BOUNDARY',
    ].includes(error.code)),
  };
}

module.exports = { buildApiSectionModel, textOf, PRESERVED_BLOCK_TYPES };

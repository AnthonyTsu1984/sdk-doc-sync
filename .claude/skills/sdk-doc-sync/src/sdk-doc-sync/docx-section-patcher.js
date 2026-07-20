'use strict';

const { buildApiSectionModel, PRESERVED_BLOCK_TYPES } = require('./api-section-model');

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function blocksById(blocks) {
  return new Map((blocks || []).map((block) => [block.block_id, block]));
}

function blocksForSection(blocks, section) {
  const byId = blocksById(blocks);
  return section.blockIds.map((id) => byId.get(id)).filter(Boolean);
}

function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['block_id', 'parent_id', 'children'].includes(key))
    .map(([key, child]) => [key, comparable(child)]));
}

function sectionFingerprint(blocks, section) {
  return JSON.stringify(blocksForSection(blocks, section)
    .filter((block) => !PRESERVED_BLOCK_TYPES.has(block.block_type))
    .map(comparable));
}

function blockedPlan(profile, currentModel, desiredModel, errors) {
  return deepFreeze({
    schemaVersion: 1,
    profile: { id: profile.id, version: profile.version },
    strategy: 'planning-blocked',
    currentModel,
    desiredRoleSequence: desiredModel?.sections?.map((section) => section.role) || [],
    preservedBlockIds: currentModel?.preserved?.map((item) => item.blockId) || [],
    operations: [],
    validation: { valid: false, errors },
  });
}

function normalizeDesiredDocument(blocks) {
  if ((blocks || []).some((block) => block?.block_type === 1)) return blocks;
  const normalized = clone(blocks || []).map((block, index) => ({
    ...block,
    block_id: block.block_id || `desired-${index}`,
    parent_id: 'desired-page',
  }));
  return [{
    block_id: 'desired-page',
    block_type: 1,
    children: normalized.map((block) => block.block_id),
    page: { elements: [] },
  }, ...normalized];
}

function planApiReferencePatch({
  currentBlocks,
  desiredBlocks,
  profile,
  documentToken = null,
  repairApproval = null,
} = {}) {
  if (!profile?.id) throw new TypeError('planApiReferencePatch requires a layout profile');
  desiredBlocks = normalizeDesiredDocument(desiredBlocks);
  const currentModel = buildApiSectionModel(currentBlocks || [], profile);
  const desiredModel = buildApiSectionModel(desiredBlocks || [], profile);

  if (desiredModel.errors.length > 0) {
    return blockedPlan(profile, currentModel, desiredModel, [{
      code: 'DESIRED_LAYOUT_INVALID',
      errors: desiredModel.errors,
    }]);
  }

  if (currentModel.errors.some((error) => ['PAGE_STRUCTURE_INVALID', 'MISSING_TOP_LEVEL_BLOCK'].includes(error.code))) {
    return blockedPlan(profile, currentModel, desiredModel, [{
      code: 'PATCH_PLANNING_BLOCKED',
      errors: currentModel.errors,
    }]);
  }

  const preservedBlockIds = currentModel.preserved.map((item) => item.blockId);
  if (currentModel.requiresReviewedRebuild) {
    const desiredById = blocksById(desiredBlocks);
    const desiredTopLevel = desiredModel.topLevelBlockIds.map((id) => desiredById.get(id)).filter(Boolean);
    return deepFreeze({
      schemaVersion: 1,
      profile: { id: profile.id, version: profile.version },
      strategy: 'reviewed-full-body-rebuild',
      approval: {
        required: true,
        kind: 'REPAIR_WRITE_APPROVAL',
        documentToken,
        preservedBlockIds,
      },
      currentModel,
      desiredRoleSequence: desiredModel.sections.map((section) => section.role),
      preservedBlockIds,
      operations: [{
        type: 'rebuild-body',
        deleteBlockIds: currentModel.topLevelBlockIds,
        blocks: clone(desiredTopLevel),
      }],
      validation: { valid: true, errors: [] },
    });
  }

  const currentByRole = new Map(currentModel.sections.map((section) => [section.role, section]));
  const desiredByRole = new Map(desiredModel.sections.map((section) => [section.role, section]));
  const operations = [];
  let structuralChange = false;

  for (const desiredSection of desiredModel.sections) {
    const currentSection = currentByRole.get(desiredSection.role);
    const desiredSectionBlocks = blocksForSection(desiredBlocks, desiredSection);
    if (!currentSection) {
      structuralChange = true;
      operations.push({
        type: 'insert-section',
        role: desiredSection.role,
        insertAt: desiredSection.startIndex,
        blocks: clone(desiredSectionBlocks),
      });
      continue;
    }
    if (sectionFingerprint(currentBlocks, currentSection) === sectionFingerprint(desiredBlocks, desiredSection)) continue;
    const preserveBlockIds = currentSection.attachments || [];
    operations.push({
      type: 'replace-section',
      role: desiredSection.role,
      deleteBlockIds: currentSection.blockIds.filter((id) => !preserveBlockIds.includes(id)),
      preserveBlockIds: [...preserveBlockIds],
      insertAt: currentSection.startIndex,
      blocks: clone(desiredSectionBlocks),
    });
  }

  for (const currentSection of currentModel.sections) {
    if (desiredByRole.has(currentSection.role)) continue;
    structuralChange = true;
    const preserveBlockIds = currentSection.attachments || [];
    operations.push({
      type: 'delete-section',
      role: currentSection.role,
      deleteBlockIds: currentSection.blockIds.filter((id) => !preserveBlockIds.includes(id)),
      preserveBlockIds: [...preserveBlockIds],
    });
  }

  return deepFreeze({
    schemaVersion: 1,
    profile: { id: profile.id, version: profile.version },
    strategy: structuralChange ? 'ordered-section-replacement' : 'targeted-semantic-patch',
    currentModel,
    desiredRoleSequence: desiredModel.sections.map((section) => section.role),
    preservedBlockIds,
    operations,
    validation: { valid: true, errors: [] },
  });
}

module.exports = { planApiReferencePatch };

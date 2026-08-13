'use strict';

const { canonicalize } = require('../../doc-ops-core/src/canonical-json');
const { digestSemantic } = require('../../doc-ops-core/src/digest');

const CONTENT_CODES = new Set(['NEW', 'UPDATE_CONTENT', 'TARGET_LOCAL_EDIT', 'TRANSLATION_DIVERGED', 'TRANSLATION_BASELINE_REQUIRED', 'TRANSLATION_CONTRACT_STALE']);
const SKIP_CODES = new Set(['NOOP', 'POLICY_EXCLUDED', 'LOCALE_EQUIVALENT']);

function unitId(kind, issueIds) {
  return `localization-unit:${kind}:${digestSemantic({ kind, issueIds: [...issueIds].sort() }).slice(7, 23)}`;
}

function metaGroupKey(issue) {
  return JSON.stringify([
    issue.tableMappingId, issue.placement, issue.localeOwner,
    [...(issue.changedFields || [])].sort(), issue.riskClass,
    issue.preconditionSchema, issue.publicationEffect, issue.localePolicyDecision,
  ]);
}

function buildReviewUnits({ scanManifestDigest, issues = [] }) {
  if (!scanManifestDigest) throw new TypeError('scanManifestDigest is required');
  for (const issue of issues) {
    if (issue.placement !== 'canonical' && (issue.changedFields || []).includes('Targets')) {
      throw new Error('Targets changes are allowed for canonical placement only');
    }
  }
  const units = [];
  const metadataGroups = new Map();
  for (const issue of issues) {
    if (SKIP_CODES.has(issue.code) || issue.placement === 'ref') continue;
    if (issue.code === 'META_ONLY') {
      const key = metaGroupKey(issue);
      if (!metadataGroups.has(key)) metadataGroups.set(key, []);
      metadataGroups.get(key).push(issue);
      continue;
    }
    let kind = 'policy';
    if (CONTENT_CODES.has(issue.code)) kind = 'content';
    else if (issue.code === 'PUBLICATION_SCOPE_MISMATCH') kind = 'publication-scope';
    else if (issue.code === 'LOCAL_META_DRIFT') kind = 'metadata';
    const issueIds = [issue.issueId];
    const unit = {
      schemaVersion: 1,
      reviewUnitId: unitId(kind, issueIds),
      kind,
      scanManifestDigest,
      issueIds,
      placement: issue.placement,
      identity: issue.identity || null,
      tableMappingId: issue.tableMappingId || null,
      translationPairId: issue.translationPairId || null,
      requiresDocumentAcceptance: kind === 'content',
      riskClass: issue.riskClass || 'medium',
      actions: issue.actions || [],
    };
    if (kind === 'publication-scope') {
      unit.publicationChange = {
        before: issue.beforeTargets || [],
        after: issue.afterTargets || [],
        chineseSourceEvidence: issue.chineseSourceEvidence || null,
      };
    }
    units.push(canonicalize(unit));
  }
  for (const group of metadataGroups.values()) {
    group.sort((a, b) => a.issueId.localeCompare(b.issueId));
    const issueIds = group.map((issue) => issue.issueId);
    units.push(canonicalize({
      schemaVersion: 1,
      reviewUnitId: unitId('metadata', issueIds),
      kind: 'metadata',
      scanManifestDigest,
      issueIds,
      placement: group[0].placement,
      tableMappingId: group[0].tableMappingId,
      requiresDocumentAcceptance: false,
      riskClass: group[0].riskClass || 'low',
      actions: group.flatMap((issue) => issue.actions || []),
    }));
  }
  return units.sort((a, b) => a.reviewUnitId.localeCompare(b.reviewUnitId));
}

function adaptTranslatorPlan({ reviewUnit, translatorPlan }) {
  if (translatorPlan?.autoApprove === true || translatorPlan?.interactiveApproval === true) {
    throw new Error('Translator approval paths cannot become executable authority');
  }
  const allowed = new Set((reviewUnit.actions || []).map((action) => action.actionId));
  return (translatorPlan?.actions || []).filter((action) => allowed.has(action.actionId));
}

module.exports = { adaptTranslatorPlan, buildReviewUnits };

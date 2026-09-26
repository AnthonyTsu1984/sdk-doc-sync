'use strict';

const { canonicalize } = require('../../doc-ops-core/src/canonical-json');
const { digestSemantic } = require('../../doc-ops-core/src/digest');

const CONTENT_CODES = new Set(['NEW', 'UPDATE_CONTENT', 'TARGET_LOCAL_EDIT', 'TRANSLATION_DIVERGED', 'TRANSLATION_BASELINE_REQUIRED', 'TRANSLATION_CONTRACT_STALE']);
const SKIP_CODES = new Set(['NOOP', 'POLICY_EXCLUDED', 'LOCALE_EQUIVALENT']);
const SOURCE_LOCALES = new Set(['en']);
const TARGET_LOCAL_CODES = new Set(['TARGET_LOCAL_EDIT', 'TRANSLATION_DIVERGED']);

function typedError(code, message) {
  return Object.assign(new Error(message), { code });
}

function actionIsDeletion(action) {
  return (action.sideEffects || []).some((sideEffect) => /delete/i.test(String(sideEffect)))
    || action.operation === 'delete';
}

// localization.source-read-only: source-locale issues are diagnostic-only —
// they may never enter a review unit carrying executable actions.
function assertSourceIssueHasNoActions(issue) {
  if (SOURCE_LOCALES.has(issue.locale) && (issue.actions || []).length > 0) {
    throw typedError('SOURCE_MUTATION_UNAUTHORIZED', `source-locale issue ${issue.issueId} carries executable actions; source records are read-only without a separately approved source-side change`);
  }
}

// localization.target-only-preserve: TARGET_ONLY records are preserved and
// reported; deleting one requires a distinct, separately approved batch that
// never forms here.
function assertTargetOnlyIssueHasNoDeletion(issue) {
  if (issue.code !== 'TARGET_ONLY') return;
  if ((issue.actions || []).some(actionIsDeletion)) {
    throw typedError('TARGET_ONLY_DELETE_FORBIDDEN', `TARGET_ONLY issue ${issue.issueId} carries a deletion action; preservation is the canonical result and deletion needs a distinct approved batch`);
  }
}

// localization.target-local-prose: target-local prose is never overwritten
// implicitly — a reviewed merge decision must be recorded on the issue first.
// localization.source-read-only: target ownership must travel inside the
// digest-protected action set, so every planned action is stamped with the
// issue's locale; the executor derives ownership from this field, never from
// the independently supplied unit.locale.
function localeStampedActions(issue) {
  return (issue.actions || []).map((action) => ({ ...action, locale: issue.locale }));
}

function assertTargetLocalIssueHasMergeDecision(issue) {
  if (!TARGET_LOCAL_CODES.has(issue.code)) return;
  if ((issue.actions || []).length === 0) return;
  if (typeof issue.mergeDecision !== 'string' || !issue.mergeDecision.trim()) {
    throw typedError('TARGET_LOCAL_OVERWRITE_FORBIDDEN', `${issue.code} issue ${issue.issueId} carries actions without an explicit mergeDecision; target-local prose is never overwritten implicitly`);
  }
}

function unitId(kind, issueIds) {
  return `localization-unit:${kind}:${digestSemantic({ kind, issueIds: [...issueIds].sort() }).slice(7, 23)}`;
}

function metaGroupKey(issue) {
  return JSON.stringify([
    issue.locale, issue.tableMappingId, issue.placement, issue.localeOwner,
    [...(issue.changedFields || [])].sort(), issue.riskClass,
    issue.preconditionSchema, issue.publicationEffect, issue.localePolicyDecision,
  ]);
}

function buildReviewUnits({ scanManifestDigest, issues = [] }) {
  if (!scanManifestDigest) throw new TypeError('scanManifestDigest is required');
  for (const issue of issues) {
    if (issue.placement !== 'canonical' && (issue.changedFields || []).includes('Targets')) {
      throw typedError('PUBLICATION_SCOPE_PLACEMENT_INVALID', 'Targets changes are allowed for canonical placement only');
    }
    assertSourceIssueHasNoActions(issue);
    assertTargetOnlyIssueHasNoDeletion(issue);
    assertTargetLocalIssueHasMergeDecision(issue);
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
      locale: issue.locale || null,
      placement: issue.placement,
      identity: issue.identity || null,
      tableMappingId: issue.tableMappingId || null,
      translationPairId: issue.translationPairId || null,
      requiresDocumentAcceptance: kind === 'content',
      riskClass: issue.riskClass || 'medium',
      actions: localeStampedActions(issue),
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
      locale: group[0].locale || null,
      placement: group[0].placement,
      tableMappingId: group[0].tableMappingId,
      requiresDocumentAcceptance: false,
      riskClass: group[0].riskClass || 'low',
      actions: group.flatMap((issue) => localeStampedActions(issue)),
    }));
  }
  return units.sort((a, b) => a.reviewUnitId.localeCompare(b.reviewUnitId));
}

function adaptTranslatorPlan({ reviewUnit, translatorPlan }) {
  if (translatorPlan?.autoApprove === true || translatorPlan?.interactiveApproval === true) {
    throw typedError('TRANSLATOR_AUTHORITY_INVALID', 'Translator approval paths cannot become executable authority');
  }
  const allowed = new Set((reviewUnit.actions || []).map((action) => action.actionId));
  return (translatorPlan?.actions || []).filter((action) => allowed.has(action.actionId));
}

module.exports = { adaptTranslatorPlan, buildReviewUnits };

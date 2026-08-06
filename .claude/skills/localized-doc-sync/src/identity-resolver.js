'use strict';

function fieldValue(record, fieldName) {
  return record?.fields?.[fieldName];
}

function scalar(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(scalar).filter(Boolean);
  if (value && typeof value === 'object') return scalar(value.text || value.name || value.value || value.link || value.url || '');
  return value;
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined && value !== '';
}

function issue(code, record, reason) {
  return { code, recordId: record?.recordId || record?.record_id || record?.id || null, reason, blocking: true };
}

function documentToken(record, roles) {
  const value = scalar(fieldValue(record, roles.docs));
  if (typeof value !== 'string' || !value) return null;
  return value.includes('/') ? value.split('/').filter(Boolean).at(-1) : value;
}

function resolveRecordIdentity({ record, roles, locale, translationPairs = [] }) {
  const placement = String(scalar(fieldValue(record, roles.placement)) || '').toLowerCase();
  const slug = scalar(fieldValue(record, roles.slug));
  const targets = scalar(fieldValue(record, roles.targets));
  const refTarget = scalar(fieldValue(record, roles.refTarget));
  const forbiddenSlug = hasValue(slug);
  const forbiddenTargets = hasValue(targets);
  if (!['canonical', 'section', 'link', 'ref'].includes(placement)) {
    return { issue: issue('PLACEMENT_METADATA_INVALID', record, 'unsupported placement') };
  }
  if (placement === 'canonical') {
    if (!hasValue(slug) || !hasValue(targets)) return { issue: issue('PLACEMENT_METADATA_INVALID', record, 'canonical requires Slug and Targets') };
    return { placement, identity: `canonical:${slug}`, slug, targets, documentToken: documentToken(record, roles) };
  }
  if (placement === 'section') {
    if (!hasValue(slug) || forbiddenTargets) return { issue: issue('PLACEMENT_METADATA_INVALID', record, 'section requires Slug and omits Targets') };
    return { placement, identity: `section:${slug}`, slug, documentToken: documentToken(record, roles) };
  }
  if (forbiddenSlug || forbiddenTargets) return { issue: issue('PLACEMENT_METADATA_INVALID', record, `${placement} omits Slug and Targets`) };
  if (placement === 'link') {
    if (typeof refTarget !== 'string') return { issue: issue('LINK_TARGET_INVALID', record, 'link target is required') };
    if (refTarget.startsWith('/')) return { placement, linkKind: 'internal', identity: `link:internal:${refTarget}`, refTarget };
    if (refTarget.startsWith('http')) return { placement, linkKind: 'external', identity: `link:external:${refTarget}`, refTarget };
    return { issue: issue('LINK_TARGET_INVALID', record, 'unsupported link target') };
  }
  const tokenField = locale === 'zh' ? 'chineseDocumentToken' : 'englishDocumentToken';
  const pair = translationPairs.find((entry) => entry[tokenField] === refTarget);
  if (!pair) return { issue: issue('IDENTITY_AMBIGUOUS', record, 'reference source is not a locale member of one translation pair') };
  return {
    placement,
    identity: `reference-source:${locale}:${pair.translationPairId}`,
    translationPairId: pair.translationPairId,
    referenceSource: refTarget,
  };
}

function resolveTableIdentities(input) {
  const identities = [];
  const issues = [];
  const byIdentity = new Map();
  for (const record of input.records || []) {
    const resolved = resolveRecordIdentity({ ...input, record });
    if (resolved.issue) {
      issues.push(resolved.issue);
      continue;
    }
    const entry = { recordId: record.recordId || record.record_id || record.id, ...resolved };
    identities.push(entry);
    if (!byIdentity.has(entry.identity)) byIdentity.set(entry.identity, []);
    byIdentity.get(entry.identity).push(entry);
  }
  for (const [identity, entries] of byIdentity) {
    if (entries.length > 1 && entries[0].placement !== 'ref') {
      issues.push({ code: 'IDENTITY_AMBIGUOUS', identity, recordIds: entries.map((entry) => entry.recordId).sort(), blocking: true });
    }
  }
  identities.sort((a, b) => a.identity.localeCompare(b.identity) || String(a.recordId).localeCompare(String(b.recordId)));
  issues.sort((a, b) => a.code.localeCompare(b.code) || String(a.identity || a.recordId || '').localeCompare(String(b.identity || b.recordId || '')));
  return { identities, issues };
}

function buildTranslationPairs({
  sourceIdentities = [],
  targetIdentities = [],
  tableMappings = [],
  identityOverrides = [],
}) {
  const translationPairs = [];
  const issues = [];
  const usedTargets = new Set();
  for (const mapping of tableMappings.filter((entry) => ['mapped', 'split', 'merged'].includes(entry.relation))) {
    const sources = sourceIdentities.filter((entry) => entry.placement === 'canonical' && mapping.sourceTableIds.includes(entry.tableId));
    const targets = targetIdentities.filter((entry) => entry.placement === 'canonical' && mapping.targetTableIds.includes(entry.tableId));
    for (const source of sources) {
      const override = identityOverrides.find((entry) => (
        (entry.sourceIdentity === source.identity || entry.sourceIdentities?.includes(source.identity))
        && entry.targetIdentity
      ));
      const targetIdentity = override?.targetIdentity || source.identity;
      const matches = targets.filter((entry) => entry.identity === targetIdentity);
      if (matches.length !== 1) {
        issues.push({
          code: matches.length === 0 ? 'NEW' : 'IDENTITY_AMBIGUOUS',
          placement: 'canonical',
          tableMappingId: mapping.mappingId,
          identity: source.identity,
          targetIdentity,
          blocking: matches.length > 1,
        });
        continue;
      }
      const target = matches[0];
      usedTargets.add(`${target.tableId}:${target.recordId}`);
      translationPairs.push({
        translationPairId: `translation-pair:${mapping.mappingId}:${source.identity}`,
        tableMappingId: mapping.mappingId,
        sourceIdentity: source.identity,
        targetIdentity: target.identity,
        englishRecordId: source.recordId,
        chineseRecordId: target.recordId,
        englishDocumentToken: source.documentToken || null,
        chineseDocumentToken: target.documentToken || null,
        overrideId: override?.overrideId || null,
      });
    }
    for (const target of targets) {
      if (!usedTargets.has(`${target.tableId}:${target.recordId}`)) {
        issues.push({
          code: 'TARGET_ONLY',
          placement: 'canonical',
          tableMappingId: mapping.mappingId,
          identity: target.identity,
          blocking: false,
        });
      }
    }
  }
  translationPairs.sort((a, b) => a.translationPairId.localeCompare(b.translationPairId));
  issues.sort((a, b) => a.code.localeCompare(b.code) || String(a.identity).localeCompare(String(b.identity)));
  return { translationPairs, issues };
}

module.exports = { buildTranslationPairs, resolveRecordIdentity, resolveTableIdentities };

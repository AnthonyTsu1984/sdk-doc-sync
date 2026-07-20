'use strict';

const { languageId } = require('../document-ir/block-registry');

const ROLE_GROUPS = Object.freeze({
  summary: 'summary',
  audience: 'audience',
  'canonical-signature': 'canonical-signature',
  'request-heading': 'request',
  'request-description': 'request',
  'request-variant-heading': 'request',
  'request-signature': 'request',
  'parameters-label': 'parameters',
  'parameters-list': 'parameters',
  'members-label': 'members',
  'members-list': 'members',
  'result-type-label': 'result-type',
  'result-type-value': 'result-type',
  'returns-label': 'returns',
  'returns-type-value': 'returns',
  'returns-description': 'returns',
  'result-fields': 'returns',
  'exceptions-label': 'exceptions',
  'exceptions-list': 'exceptions',
  'examples-heading': 'examples',
  'example-heading': 'examples',
  'example-description': 'examples',
  'example-code': 'examples',
  'extension-section': 'extensions',
  'notes-heading': 'notes',
  'notes-list': 'notes',
  'related-section': 'related',
  'related-list': 'related',
});

function normalizeSignature(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().replace(/;$/, '');
}

function validateSdkLayout(documentIr, profile) {
  const errors = [];
  const warnings = [];
  const children = Array.isArray(documentIr?.children) ? documentIr.children : [];

  function report(code, index, role, message, value = undefined) {
    errors.push({
      code,
      path: index === null ? '$' : `$.children[${index}]`,
      role: role || null,
      message,
      ...(value !== undefined && { value }),
    });
  }

  if (!profile || typeof profile.id !== 'string' || !Array.isArray(profile.order)) {
    report('INVALID_LAYOUT_PROFILE', null, null, 'A versioned SDK layout profile is required');
    return { valid: false, errors, warnings };
  }

  const entries = children.map((node, index) => ({
    node,
    index,
    role: node?.metadata?.role || null,
    key: node?.metadata?.key || null,
  }));

  if (profile.bodyTitle === 'omit') {
    for (const entry of entries.filter(({ node }) => node?.type === 'heading' && node.level === 1)) {
      report('BODY_TITLE_FORBIDDEN', entry.index, entry.role, 'SDK document bodies must not contain a level-one title');
    }
  }

  for (const entry of entries) {
    if (!entry.role || !Object.hasOwn(ROLE_GROUPS, entry.role)) {
      report('UNKNOWN_SEMANTIC_ROLE', entry.index, entry.role, 'Top-level SDK blocks require a known semantic role');
    }
  }

  const byRole = new Map();
  for (const entry of entries) {
    const values = byRole.get(entry.role) || [];
    values.push(entry);
    byRole.set(entry.role, values);
  }

  for (const [role, [minimum, maximum]] of Object.entries(profile.cardinality || {})) {
    const count = byRole.get(role)?.length || 0;
    if (count < minimum || count > maximum) {
      report(
        'SECTION_CARDINALITY_INVALID',
        byRole.get(role)?.[0]?.index ?? null,
        role,
        `Role ${role} occurs ${count} times; expected ${minimum}..${maximum}`,
        count,
      );
    }
  }

  const signatureEntries = entries.filter(({ role }) => ['canonical-signature', 'request-signature'].includes(role));
  const signatures = new Map();
  for (const entry of signatureEntries) {
    const normalized = normalizeSignature(entry.node?.value);
    if (!normalized) continue;
    if (signatures.has(normalized)) {
      report('DUPLICATE_SIGNATURE', entry.index, entry.role, 'Normalized signature is repeated', normalized);
    } else {
      signatures.set(normalized, entry);
    }
  }

  const orderIndexes = new Map(profile.order.map((group, index) => [group, index]));
  let previous = -1;
  for (const entry of entries) {
    let group = ROLE_GROUPS[entry.role];
    if (entry.key && ['parameters-label', 'parameters-list'].includes(entry.role)) group = 'request';
    if (!group || !orderIndexes.has(group)) continue;
    const current = orderIndexes.get(group);
    if (current < previous) {
      report('SECTION_ORDER_INVALID', entry.index, entry.role, `Role ${entry.role} appears outside the ${group} section order`);
    } else {
      previous = current;
    }
  }

  const pairs = [
    ['parameters-label', 'parameters-list'],
    ['members-label', 'members-list'],
    ['result-type-label', 'result-type-value'],
    ['returns-label', 'returns-description'],
    ['exceptions-label', 'exceptions-list'],
    ['examples-heading', 'example-code'],
    ['request-heading', 'request-signature'],
  ];
  for (const [labelRole, contentRole] of pairs) {
    for (const labelEntry of byRole.get(labelRole) || []) {
      const content = (byRole.get(contentRole) || []).find((entry) => (
        labelEntry.key ? entry.key === labelEntry.key : true
      ));
      if (!content) {
        report('SECTION_CONTENT_MISSING', labelEntry.index, labelRole, `${labelRole} requires ${contentRole}`);
      }
    }
  }

  for (const [role, expectedLanguage] of Object.entries(profile.fences || {})) {
    for (const entry of byRole.get(role) || []) {
      if (languageId(entry.node?.language) !== languageId(expectedLanguage)) {
        report(
          'CODE_FENCE_POLICY_INVALID',
          entry.index,
          role,
          `Role ${role} must use ${expectedLanguage}`,
          entry.node?.language,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

module.exports = { validateSdkLayout, normalizeSignature, ROLE_GROUPS };

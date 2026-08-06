'use strict';

const { canonicalize } = require('../../doc-ops-core/src/canonical-json');
const { digestSemantic } = require('../../doc-ops-core/src/digest');

function viewHasScope(view) {
  return (Array.isArray(view?.filters) && view.filters.length > 0)
    || (Array.isArray(view?.filterInfo?.conditions) && view.filterInfo.conditions.length > 0);
}

function profileTableSchema({ table, rolePolicy = {}, activeViewId = null }) {
  const issues = [];
  const roles = {};
  const activeFieldIds = new Set();
  for (const [role, policy] of Object.entries(rolePolicy)) {
    const matches = (table.fields || []).filter((field) => (policy.names || []).includes(field.name));
    if (matches.length === 0) {
      if (policy.required) issues.push({ code: 'SCHEMA_DRIFT', role, reason: 'missing-active-field', blocking: true });
      continue;
    }
    if (matches.length > 1) {
      issues.push({ code: 'SCHEMA_DRIFT', role, reason: 'ambiguous-active-field', blocking: true });
      continue;
    }
    const field = matches[0];
    activeFieldIds.add(field.fieldId);
    const typeValid = !policy.types?.length || policy.types.includes(field.type);
    roles[role] = canonicalize({
      fieldId: field.fieldId,
      fieldName: field.name,
      type: field.type,
      options: field.options || [],
      publicationCritical: policy.publicationCritical === true,
      typeValid,
    });
    if (!typeValid) {
      issues.push({ code: 'SCHEMA_DRIFT', role, fieldName: field.name, reason: 'active-field-type', blocking: true });
    }
  }
  const primary = (table.fields || []).find((field) => field.fieldId === table.primaryFieldId || field.isPrimary === true);
  if (!primary) issues.push({ code: 'SCHEMA_DRIFT', role: 'primary', reason: 'primary-field-missing', blocking: true });
  const activeView = activeViewId ? (table.views || []).find((view) => view.viewId === activeViewId) : null;
  if (activeViewId && !activeView) issues.push({ code: 'SCHEMA_DRIFT', role: 'view', reason: 'active-view-missing', blocking: true });
  else if (activeView && viewHasScope(activeView)) {
    issues.push({ code: 'FILTERED_VIEW_SCOPE', viewId: activeView.viewId, blocking: true });
  }
  const hiddenFields = (table.fields || [])
    .filter((field) => !activeFieldIds.has(field.fieldId))
    .map((field) => canonicalize(field))
    .sort((left, right) => String(left.fieldId).localeCompare(String(right.fieldId)));
  const semantic = canonicalize({
    tableId: table.tableId,
    primaryFieldId: primary?.fieldId || null,
    roles,
    hiddenFields,
    activeViewId,
  });
  return {
    ...semantic,
    schemaFingerprint: digestSemantic(semantic),
    issues: issues.sort((a, b) => a.code.localeCompare(b.code) || String(a.role || '').localeCompare(String(b.role || ''))),
  };
}

module.exports = { profileTableSchema };

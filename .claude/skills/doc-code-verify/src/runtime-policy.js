'use strict';

const { canonicalize } = require('../../doc-ops-core/src/canonical-json');
const { digestSemantic } = require('../../doc-ops-core/src/digest');

const MUTATING_SIDE_EFFECTS = new Set(['create', 'update', 'delete']);

function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

function normalizeResourceName(value) {
  return String(value || '').trim().toLowerCase().replace(/_/g, '-').replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');
}

function quotedResources(code, suffix) {
  const names = [];
  const pattern = /["'`]([A-Za-z0-9._-]{3,})["'`]/g;
  let match;
  while ((match = pattern.exec(code))) {
    const normalized = normalizeResourceName(match[1]);
    if (!suffix || normalized.includes(normalizeResourceName(suffix))) names.push(normalized);
  }
  return uniqueSorted(names);
}

function networkTargets(code) {
  const targets = [];
  const pattern = /https?:\/\/([A-Za-z0-9.-]+)/g;
  let match;
  while ((match = pattern.exec(code))) targets.push(match[1].toLowerCase());
  return uniqueSorted(targets);
}

function runtimeItemFromSnippet(snippet, opts = {}) {
  const code = String(snippet?.code || '');
  const normalizedCode = code.toLowerCase();
  const creates = /(?:^|[^a-z])(create|insert|upsert|import|load)(?=[_(.\s]|$)/.test(normalizedCode)
    || /(?:-x|--request)\s+post\b/i.test(code);
  const updates = (/(?:^|[^a-z])(update|alter|grant|revoke)(?=[_(.\s]|$)/.test(normalizedCode)
    || /(?:-x|--request)\s+(put|patch)\b/i.test(code)) && !creates;
  const deletes = /(?:^|[^a-z])(delete|drop|remove|destroy|truncate|uninstall)(?=[_(.\s]|$)/.test(normalizedCode)
    || /(?:-x|--request)\s+delete\b/i.test(code);
  const mutating = creates || updates || deletes;
  if (mutating && !String(opts.resourceSuffix || '').trim()) {
    throw new Error(`Mutating runtime item ${snippet?.id || '(unknown)'} requires an isolated resource suffix`);
  }
  let resources = quotedResources(code, opts.resourceSuffix || '');
  if (mutating && resources.length === 0) resources = [`doc-verify-${normalizeResourceName(opts.resourceSuffix)}`];
  const expectedMutations = [];
  const cleanupActions = [];
  for (const resourceName of resources) {
    if (creates) expectedMutations.push({ sideEffectClass: 'create', resourceName });
    if (updates) expectedMutations.push({ sideEffectClass: 'update', resourceName });
    if (deletes) cleanupActions.push({
      sideEffectClass: 'delete',
      resourceName,
      recoveryCommand: `cleanup ${resourceName}`,
    });
  }
  return canonicalize({
    itemId: snippet.id,
    kind: 'snippet',
    language: snippet.language || 'unknown',
    annotationMode: snippet.annotations?.mode || null,
    displayName: snippet.annotations?.name || null,
    timeoutMs: snippet.annotations?.timeout || opts.timeout || 8000,
    networkTargets: networkTargets(code),
    resourceNames: resources,
    expectedMutations,
    cleanupActions,
  });
}

function normalizeItem(item) {
  if (!item?.itemId || !item.kind || !item.language || !Number.isFinite(item.timeoutMs)) throw new TypeError('Runtime items require itemId, kind, language, and timeoutMs');
  return canonicalize({
    itemId: item.itemId,
    kind: item.kind,
    language: item.language,
    annotationMode: item.annotationMode || null,
    displayName: item.displayName || null,
    timeoutMs: item.timeoutMs,
    networkTargets: uniqueSorted(item.networkTargets),
    resourceNames: uniqueSorted(item.resourceNames),
    expectedMutations: [...(item.expectedMutations || [])].map((action) => canonicalize(action)).sort((a, b) => `${a.resourceName}:${a.sideEffectClass}`.localeCompare(`${b.resourceName}:${b.sideEffectClass}`)),
    cleanupActions: [...(item.cleanupActions || [])].map((action) => canonicalize(action)).sort((a, b) => `${a.resourceName}:${a.sideEffectClass}`.localeCompare(`${b.resourceName}:${b.sideEffectClass}`)),
  });
}

function buildRuntimeManifest({ runId, liveProfile, requiredEnvGroups = [], items = [] }) {
  if (!runId || !liveProfile) throw new TypeError('runId and liveProfile are required');
  const normalizedItems = items.map(normalizeItem).sort((left, right) => left.itemId.localeCompare(right.itemId));
  const actions = [];
  for (const item of normalizedItems) {
    for (const [collection, role] of [[item.expectedMutations, 'mutation'], [item.cleanupActions, 'cleanup']]) {
      for (const action of collection) {
        const semantic = { itemId: item.itemId, role, sideEffectClass: action.sideEffectClass, resourceName: action.resourceName };
        actions.push(canonicalize({
          actionId: `runtime:${digestSemantic(semantic).slice(7, 23)}`,
          itemId: item.itemId,
          role,
          sideEffectClass: action.sideEffectClass,
          resourceName: action.resourceName,
          recoveryCommand: action.recoveryCommand || null,
          declaredInRuntime: true,
        }));
      }
    }
  }
  const mutationResources = uniqueSorted(actions.filter((action) => action.role === 'mutation').map((action) => action.resourceName));
  const cleanupResources = new Set(actions.filter((action) => action.role === 'cleanup').map((action) => action.resourceName));
  for (const resourceName of mutationResources) {
    if (cleanupResources.has(resourceName)) continue;
    const semantic = { itemId: `recovery:${resourceName}`, role: 'cleanup', sideEffectClass: 'delete', resourceName };
    actions.push(canonicalize({
      actionId: `runtime:${digestSemantic(semantic).slice(7, 23)}`,
      itemId: semantic.itemId,
      role: 'cleanup',
      sideEffectClass: 'delete',
      resourceName,
      recoveryCommand: `cleanup ${resourceName}`,
      declaredInRuntime: false,
    }));
  }
  actions.sort((left, right) => left.actionId.localeCompare(right.actionId));
  const semantic = canonicalize({
    schemaVersion: 1,
    artifactType: 'doc-code-runtime-manifest',
    runId,
    liveProfile,
    requiredEnvGroups: requiredEnvGroups.map((group) => uniqueSorted(group)).sort((a, b) => a.join('|').localeCompare(b.join('|'))),
    items: normalizedItems,
    actions,
    networkTargets: uniqueSorted(normalizedItems.flatMap((item) => item.networkTargets)),
    resourceNames: uniqueSorted(normalizedItems.flatMap((item) => item.resourceNames)),
    sideEffectClasses: uniqueSorted(actions.map((action) => action.sideEffectClass)),
    mutating: actions.some((action) => MUTATING_SIDE_EFFECTS.has(action.sideEffectClass)),
  });
  return Object.freeze({ ...semantic, runtimeManifestDigest: digestSemantic(semantic) });
}

function assertRuntimeApproval({ manifest, approvedDigest }) {
  if (!manifest?.mutating) return true;
  if (!approvedDigest) throw new Error(`Runtime approval is required for ${manifest.runtimeManifestDigest}`);
  if (approvedDigest !== manifest.runtimeManifestDigest) throw new Error(`Runtime approval digest mismatch: expected ${manifest.runtimeManifestDigest}`);
  return true;
}

module.exports = { MUTATING_SIDE_EFFECTS, assertRuntimeApproval, buildRuntimeManifest, runtimeItemFromSnippet };

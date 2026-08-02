#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { validateReleaseScope } = require('../src/sdk-doc-sync/release-scope/schema');
const { resolvePlanningContexts } = require('../src/sdk-doc-sync/release-scope/planning-context');

const SDK_REFERENCE_BY_LANGUAGE = {
  cpp: 'sdk-cpp.md',
  go: 'sdk-go.md',
  java: 'sdk-java.md',
  node: 'sdk-node.md',
  python: 'sdk-python.md',
  rest: 'sdk-rest.md',
  zilliz_cli: 'sdk-zilliz-cli.md',
  'zilliz-cli': 'sdk-zilliz-cli.md',
};

function parseArgs(argv = process.argv) {
  const args = {};
  const valueOptions = new Set(['--release-scope', '--candidate-spec', '--output-scope', '--output-context', '--sdk-reference']);
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (!valueOptions.has(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    const key = arg.replace(/^--/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    args[key] = value;
    index += 1;
  }
  return args;
}

function usage() {
  return `Usage: build-reviewed-release-context --release-scope <file> --candidate-spec <file> --output-scope <file> --output-context <file> [--sdk-reference <file>]

Filters a release-scout artifact to reviewed user-facing candidates and builds
the --reference-context JSON required for schema-first dry-runs.
`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function required(value, message) {
  if (value === undefined || value === null || value === '') throw new Error(message);
  return value;
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function uniqueValues(values) {
  const unique = [];
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (!unique.some((existing) => isDeepStrictEqual(existing, value))) unique.push(clone(value));
  }
  return unique;
}

function reviewedContextError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function preferredReviewedAction(actions, identity) {
  const standalone = actions.filter((action) => action.documentationOwnership?.classification === 'standalone');
  const preferred = standalone.length > 0 ? standalone : actions;
  const lifecycleTypes = [...new Set(preferred.map((action) => action.type))];
  if (lifecycleTypes.length > 1) {
    throw reviewedContextError(
      'CONFLICTING_REVIEWED_ACTIONS',
      `Reviewed owner ${identity.stableId} has incompatible lifecycle actions: ${lifecycleTypes.join(', ')}`,
    );
  }
  return preferred[0];
}

function assertCompatibleReviewedActions(actions, identity) {
  const stableIds = [...new Set(actions.map((action) => action.stableId))];
  if (stableIds.length > 1) {
    throw reviewedContextError(
      'CONFLICTING_REVIEWED_IDENTITY',
      `Reviewed owner ${identity.stableId} has incompatible release identities: ${stableIds.join(', ')}`,
    );
  }
  const planningContext = resolvePlanningContexts(actions.map((action) => action.planningContext));
  if (planningContext.conflict) {
    throw reviewedContextError(
      'CONFLICTING_RELEASE_SCOPE_ACTIONS',
      `Reviewed owner ${identity.stableId} has incompatible planningContext values`,
    );
  }
  const targets = uniqueValues(actions.map((action) => action.target));
  if (targets.length > 1) {
    throw reviewedContextError(
      'CONFLICTING_RELEASE_SCOPE_ACTIONS',
      `Reviewed owner ${identity.stableId} has incompatible target values`,
    );
  }
  return planningContext.value;
}

function sourceVariantsFor(actions) {
  return uniqueValues(actions.flatMap((action) => {
    const variants = Array.isArray(action.sourceVariants) && action.sourceVariants.length > 0
      ? action.sourceVariants
      : [{
        stableId: action.stableId,
        canonicalSlug: action.canonicalSlug,
        symbol: action.symbol,
        source: action.source,
        reason: action.reason,
        ...(action.evidence !== undefined ? { evidence: action.evidence } : {}),
        ...(action.sourceDeltaType !== undefined ? { sourceDeltaType: action.sourceDeltaType } : {}),
      }];
    return variants.map((variant) => ({
      ...clone(variant),
      stableId: variant.stableId || action.stableId,
      canonicalSlug: variant.canonicalSlug || action.canonicalSlug,
      reason: variant.reason || action.reason,
      ...(variant.evidence === undefined && action.evidence !== undefined
        ? { evidence: clone(action.evidence) }
        : {}),
      ...(variant.sourceDeltaType === undefined && action.sourceDeltaType !== undefined
        ? { sourceDeltaType: action.sourceDeltaType }
        : {}),
    }));
  }));
}

function trackParts(track) {
  const match = String(track || '').match(/^v(\d+)\.(\d+)\.x$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
  };
}

function compareTracks(left, right) {
  const a = trackParts(left);
  const b = trackParts(right);
  if (!a || !b) return String(left).localeCompare(String(right));
  if (a.major !== b.major) return a.major - b.major;
  return a.minor - b.minor;
}

function defaultSdkReferencePath(language) {
  const fileName = SDK_REFERENCE_BY_LANGUAGE[language];
  if (!fileName) return null;
  return path.join(__dirname, '..', fileName);
}

function readSdkReference({ language, filePath }) {
  const resolvedPath = filePath || defaultSdkReferencePath(language);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) return '';
  return fs.readFileSync(resolvedPath, 'utf8');
}

function detectVersionTracksFromReference(markdown) {
  const tracks = new Set();
  let inVersionTable = false;
  for (const line of String(markdown || '').split(/\r?\n/)) {
    if (!line.includes('|')) {
      inVersionTable = false;
      continue;
    }
    const cells = line
      .trim()
      .split('|')
      .map((cell) => cell.trim())
      .filter(Boolean);
    if (cells.length === 0) continue;
    const firstCell = cells[0]?.replace(/`/g, '').trim();
    if (/^:?-{3,}:?$/.test(firstCell)) continue;
    if (/^version$/i.test(firstCell)) {
      inVersionTable = true;
      continue;
    }
    if (!inVersionTable) continue;
    const version = firstCell;
    if (/^v\d+\.\d+\.x$/.test(version)) {
      tracks.add(version);
    } else {
      inVersionTable = false;
    }
  }
  return [...tracks].sort(compareTracks);
}

function resolveDetectedSuccessorTracks({ releaseScope, sdkReference }) {
  const tracks = detectVersionTracksFromReference(sdkReference);
  if (!tracks.includes(releaseScope.track)) return [];
  return tracks.filter((track) => compareTracks(track, releaseScope.track) > 0);
}

function titleFor(action) {
  return action.symbol.includes('.') ? `${action.symbol}()` : `${action.symbol}()`;
}

function evidenceFor(action, spec, releaseScope) {
  const source = action.source || {};
  return [{
    kind: 'source',
    locator: `${source.file}:${source.line}`,
    revision: source.revision || releaseScope.targetCommit,
    confidence: spec.evidenceConfidence || 'reviewed',
  }];
}

function expandCandidateSpec(candidateSpec) {
  const candidates = {};
  for (const [canonicalSlug, spec] of Object.entries(candidateSpec.candidates || {})) {
    candidates[canonicalSlug] = { ...spec, canonicalSlug };
  }

  for (const [groupIndex, group] of (candidateSpec.groups || []).entries()) {
    const sourceCanonicalSlugs = [...(group.canonicalSlugs || [])];
    for (const canonicalSlug of group.canonicalSlugs || []) {
      candidates[canonicalSlug] = {
        ...group,
        ...(group.overrides?.[canonicalSlug] || {}),
        canonicalSlug,
        sourceCanonicalSlugs,
        groupIndex,
      };
      delete candidates[canonicalSlug].canonicalSlugs;
      delete candidates[canonicalSlug].overrides;
    }
  }
  return candidates;
}

function categoryFromStableId(stableId) {
  const parts = String(stableId || '').split(':');
  return parts.length >= 3 ? parts[1] : '';
}

function ownershipError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertActionDocumentationOwnership(action) {
  const ownership = action.documentationOwnership;
  if (!ownership) return;
  const owners = [
    ...(Array.isArray(ownership.owners) ? ownership.owners : []),
    ...(Array.isArray(ownership.targets) ? ownership.targets : []),
  ];
  const hasDeclaredOwners = ownership.owners !== undefined || ownership.targets !== undefined;
  if (ownership.classification === 'ambiguous') {
    throw ownershipError(
      'AMBIGUOUS_DOCUMENTATION_OWNERSHIP',
      `Release action ${action.canonicalSlug} has ambiguous documentation ownership`,
    );
  }
  if (ownership.classification === 'standalone' && (hasDeclaredOwners || owners.length > 0)) {
    throw ownershipError(
      'METHOD_OWNED_STANDALONE_FORBIDDEN',
      `Release action ${action.canonicalSlug} cannot be standalone while retaining known method owners`,
    );
  }
  if (ownership.classification !== 'method_owned') return;
  const declaredOwner = owners.some((owner) => owner?.stableId === ownership.selectedOwnerStableId);
  if (!declaredOwner || ownership.selectedOwnerStableId !== action.stableId) {
    throw ownershipError(
      'METHOD_OWNED_STANDALONE_FORBIDDEN',
      `Release action ${action.canonicalSlug} must select its declared method owner`,
    );
  }
}

function assertCandidateIdentity({ action, spec, category }) {
  const docIdentity = spec.docIdentity || {};
  const effectiveStableId = docIdentity.stableId || spec.stableId || action.stableId;
  const effectiveCanonicalSlug = docIdentity.canonicalSlug || spec.canonicalSlug || action.canonicalSlug;
  const stableCategory = categoryFromStableId(effectiveStableId);
  if (stableCategory && stableCategory !== category) {
    throw new Error(
      `Candidate ${action.canonicalSlug} category ${category} does not match documentation identity ${effectiveStableId}. ` +
      'Fix the identity map or candidate docIdentity before building approval-ready context.',
    );
  }
  if (effectiveCanonicalSlug.includes('-')) {
    const hasCategoryPrefix = effectiveCanonicalSlug === category
      || effectiveCanonicalSlug.startsWith(`${category}-`)
      || new RegExp(`^v\\d+-${category.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}-`).test(effectiveCanonicalSlug);
    if (!hasCategoryPrefix) {
      throw new Error(
        `Candidate ${action.canonicalSlug} category ${category} does not match canonical slug ${effectiveCanonicalSlug}. ` +
        'Use a category-based documentation slug before building approval-ready context.',
      );
    }
  }

  const groupedSources = spec.sourceCanonicalSlugs || [];
  if (groupedSources.length > 1) {
    if (!docIdentity.stableId || !docIdentity.canonicalSlug) {
      throw new Error(`Grouped candidate ${groupedSources.join(', ')} must declare docIdentity.stableId and docIdentity.canonicalSlug`);
    }
    if (!spec.groupingReview || spec.groupingReview.reviewed !== true) {
      throw new Error(`Grouped candidate ${groupedSources.join(', ')} must have groupingReview.reviewed=true before approval-ready context`);
    }
    throw new Error(`Grouped candidate ${groupedSources.join(', ')} must not group multiple interface actions into one documentation identity`);
  }

  return {
    stableId: effectiveStableId,
    canonicalSlug: effectiveCanonicalSlug,
    symbol: docIdentity.symbol || spec.symbol || action.symbol,
  };
}

function assertExistingRecordEvidence({ action, spec, identity }) {
  if (action.type !== 'UPDATE') return null;
  const existing = spec.existingRecord || null;
  if (!existing || !existing.recordId || !existing.documentToken || !existing.parentRecordId) {
    throw new Error(`Candidate ${action.canonicalSlug} existingRecord evidence is required for UPDATE ${identity.stableId}`);
  }
  if (!existing.placement
    || existing.placement.verified !== true
    || !existing.placement.version
    || !existing.placement.folderToken
    || typeof existing.placement.referencedByOlderVersions !== 'boolean') {
    throw new Error(`verified current placement is required for UPDATE ${identity.stableId}`);
  }
  return {
    recordId: existing.recordId,
    documentToken: existing.documentToken,
    parentRecordId: existing.parentRecordId,
    version: existing.placement.version,
    folderToken: existing.placement.folderToken,
    ancestryVerified: true,
    placementVerified: true,
    referencedByOlderVersions: existing.placement.referencedByOlderVersions,
  };
}

function assertCreateMissingEvidence({ action, spec, identity }) {
  if (action.type !== 'CREATE') return null;
  if (spec.existingRecord?.recordId) {
    throw new Error(`Candidate ${action.canonicalSlug} is CREATE but existingRecord ${spec.existingRecord.recordId} was found for ${identity.stableId}`);
  }
  const lookup = spec.existingRecordLookup || null;
  const criteria = lookup?.criteria || {};
  const canonicalSlugs = Array.isArray(criteria.canonicalSlugs)
    ? criteria.canonicalSlugs
    : [criteria.canonicalSlug].filter(Boolean);
  if (!lookup
    || lookup.checked !== true
    || lookup.absent !== true
    || !lookup.baseToken
    || !lookup.tableId
    || (!lookup.parentRecordId && !lookup.parentRecordRef)
    || !canonicalSlugs.includes(identity.canonicalSlug)
    || !criteria.title) {
    throw new Error(`Candidate ${action.canonicalSlug} must include explicit absent existingRecordLookup evidence before CREATE ${identity.stableId}`);
  }
  return {
    checked: true,
    absent: true,
    baseToken: lookup.baseToken,
    tableId: lookup.tableId,
    parentRecordId: lookup.parentRecordId,
    parentRecordRef: lookup.parentRecordRef || null,
    criteria: clone(criteria),
  };
}

function requiresCopySource({ current, targetVersion, targetFolderToken, targetFolderRef }) {
  if (!current) return false;
  if (targetFolderRef) return true;
  if (current.version && targetVersion && current.version !== targetVersion) return true;
  if (current.folderToken && targetFolderToken && current.folderToken !== targetFolderToken) return true;
  if (current.referencedByOlderVersions === true) return true;
  return false;
}

function assertCopySourceEvidence({ action, spec, identity, current, targetVersion, targetFolderToken, targetFolderRef }) {
  if (action.type !== 'UPDATE') return null;
  if (!requiresCopySource({ current, targetVersion, targetFolderToken, targetFolderRef })) return null;
  const copySource = spec.copySource || null;
  if (!copySource || !copySource.documentToken || !copySource.link) {
    throw new Error(`Candidate ${action.canonicalSlug} copySource evidence is required before changing inherited doc ${identity.stableId}`);
  }
  return {
    documentToken: copySource.documentToken,
    link: copySource.link,
    title: copySource.title || null,
  };
}

function assertNoSyntheticGroupAcrossExistingRecords({ spec, identity }) {
  const records = Array.isArray(spec.existingRecords) ? spec.existingRecords.filter((item) => item?.recordId) : [];
  const recordIds = [...new Set(records.map((item) => item.recordId))];
  if (recordIds.length > 1 && spec.docIdentity?.stableId === identity.stableId) {
    throw new Error(`Candidate ${identity.stableId} groups multiple existing interface records: ${recordIds.join(', ')}`);
  }
}

const REVIEWED_ACTION_TYPES = new Set(['CREATE', 'UPDATE', 'DEPRECATE', 'BACKFILL']);

function actionForPlanning(action, spec) {
  const reviewedType = spec.actionIntent || spec.reviewedActionType || action.type;
  if (!REVIEWED_ACTION_TYPES.has(reviewedType)) {
    throw new Error(`Candidate ${action.canonicalSlug} has invalid reviewed action type ${reviewedType}`);
  }
  return { ...action, type: reviewedType };
}

const INHERITANCE_STATUSES = new Set([
  'inherited',
  'missing',
  'renamed',
  'changed',
  'not_applicable',
  'deferred',
  'successor_action_planned',
]);

const INHERITANCE_DECISIONS = new Set([
  'no_successor_action',
  'include_successor_action',
  'defer',
  'exclude',
]);

const ALLOWED_INHERITANCE_DECISIONS_BY_STATUS = {
  inherited: new Set(['no_successor_action']),
  missing: new Set(['include_successor_action', 'defer', 'exclude']),
  renamed: new Set(['include_successor_action', 'defer']),
  changed: new Set(['include_successor_action', 'defer']),
  not_applicable: new Set(['no_successor_action', 'exclude']),
  deferred: new Set(['defer']),
  successor_action_planned: new Set(['include_successor_action']),
};

function resolveRequiredSuccessorTracks({ releaseScope, candidateSpec, sdkReference }) {
  const explicitTracks = candidateSpec.inheritance?.requiredSuccessorTracks || [];
  const effectiveSdkReference = sdkReference === undefined
    ? readSdkReference({ language: releaseScope.language })
    : sdkReference;
  const detectedTracks = resolveDetectedSuccessorTracks({ releaseScope, sdkReference: effectiveSdkReference });
  return [...new Set([...detectedTracks, ...explicitTracks])].sort(compareTracks);
}

function assertInheritanceReview({ action, spec, requiredSuccessorTracks }) {
  if (requiredSuccessorTracks.length === 0) return undefined;

  const review = spec.inheritanceReview;
  if (!review || review.reviewed !== true) {
    throw new Error(`Candidate ${action.canonicalSlug} must have inheritanceReview.reviewed=true for successor tracks: ${requiredSuccessorTracks.join(', ')}`);
  }
  const successors = Array.isArray(review.successors) ? review.successors : [];
  const byTrack = new Map(successors.map((item) => [item.track, item]));
  for (const track of requiredSuccessorTracks) {
    const successor = byTrack.get(track);
    if (!successor) {
      throw new Error(`Candidate ${action.canonicalSlug} is missing inheritance review for successor track ${track}`);
    }
    if (!INHERITANCE_STATUSES.has(successor.status)) {
      throw new Error(`Candidate ${action.canonicalSlug} has invalid inheritance status ${successor.status} for successor track ${track}`);
    }
    if (!INHERITANCE_DECISIONS.has(successor.decision)) {
      throw new Error(`Candidate ${action.canonicalSlug} has invalid inheritance decision ${successor.decision} for successor track ${track}`);
    }
    if (['missing', 'renamed', 'changed'].includes(successor.status) && successor.decision === 'no_successor_action') {
      throw new Error(
        `Candidate ${action.canonicalSlug} successor track ${track} is ${successor.status}; ` +
        'use include_successor_action, defer, or exclude instead of no_successor_action',
      );
    }
    if (!ALLOWED_INHERITANCE_DECISIONS_BY_STATUS[successor.status].has(successor.decision)) {
      throw new Error(
        `Candidate ${action.canonicalSlug} successor track ${track} status ${successor.status} ` +
        `cannot use decision ${successor.decision}`,
      );
    }
    if (successor.status === 'needs_review') {
      throw new Error(`Candidate ${action.canonicalSlug} still needs inheritance review for successor track ${track}`);
    }
    if (successor.decision === 'include_successor_action' && (!successor.docIdentity?.stableId || !successor.docIdentity?.canonicalSlug)) {
      throw new Error(`Candidate ${action.canonicalSlug} successor track ${track} include_successor_action requires docIdentity.stableId and docIdentity.canonicalSlug`);
    }
  }
  return clone(review);
}

function defaultExceptions(action, spec, evidence) {
  if (spec.exceptions) return spec.exceptions.map((item) => ({ ...item, evidence: clone(item.evidence) || evidence }));
  return [{
    name: spec.exceptionName || 'MilvusException',
    condition: spec.exceptionCondition || 'Raised when the server rejects the request or the RPC fails.',
    description: spec.exceptionDescription || 'Inspect the server error message for the exact failure reason.',
    evidence,
  }];
}

function exampleFor(action, spec, evidence) {
  const examples = spec.examples || (spec.example ? [spec.example] : []);
  if (examples.length === 0) {
    throw new Error(`Candidate ${action.canonicalSlug} is missing a reviewed example`);
  }
  return examples.map((example) => ({
    title: example.title || `${action.symbol} example`,
    description: example.description || `Shows a typical ${action.symbol} call for the ${spec.version || 'target'} API.`,
    audience: example.audience || 'shared',
    language: example.language || spec.language || 'python',
    code: required(example.code, `Candidate ${action.canonicalSlug} example is missing code`),
    ...(example.fence !== undefined ? { fence: example.fence } : {}),
    evidence: clone(example.evidence) || evidence,
  }));
}

function buildReviewedReleaseContext({ releaseScope, candidateSpec, sdkReference }) {
  if (candidateSpec.language && candidateSpec.language !== releaseScope.language) {
    throw new Error(`Candidate spec language ${candidateSpec.language} does not match release scope language ${releaseScope.language}`);
  }
  if (candidateSpec.track && candidateSpec.track !== releaseScope.track) {
    throw new Error(`Candidate spec track ${candidateSpec.track} does not match release scope track ${releaseScope.track}`);
  }
  for (const action of releaseScope.actions || []) assertActionDocumentationOwnership(action);

  const candidates = expandCandidateSpec(candidateSpec);
  const requiredSuccessorTracks = resolveRequiredSuccessorTracks({ releaseScope, candidateSpec, sdkReference });
  const configuredSlugs = Object.keys(candidates).sort();
  if (configuredSlugs.length === 0) {
    throw new Error('Candidate spec must configure at least one candidate');
  }
  const releaseSlugs = new Set((releaseScope.actions || []).map((action) => action.canonicalSlug));
  const missingConfiguredSlugs = configuredSlugs.filter((canonicalSlug) => !releaseSlugs.has(canonicalSlug));
  if (missingConfiguredSlugs.length > 0) {
    throw new Error(`Candidate spec includes ${missingConfiguredSlugs.length} entries not present in release scope: ${missingConfiguredSlugs.join(', ')}`);
  }
  const selected = [];
  const selectedSlugs = new Set();
  const contexts = {};
  const emittedDocIdentities = new Set();
  const target = required(candidateSpec.target, 'Candidate spec is missing target');
  const version = required(target.version || releaseScope.track, 'Candidate spec target is missing version');
  const versionRootToken = required(target.versionRootToken, 'Candidate spec target is missing versionRootToken');
  const folders = required(target.folders, 'Candidate spec target is missing folders');
  const resources = clone(target.resources || []);
  const resourceRefs = new Set();
  for (const resource of resources) {
    const ref = required(resource.ref, 'Target resource is missing ref');
    if (resourceRefs.has(ref)) throw new Error(`Duplicate target resource ref ${ref}`);
    resourceRefs.add(ref);
  }

  for (const action of releaseScope.actions || []) {
    const spec = candidates[action.canonicalSlug];
    if (!spec) continue;
    const groupedSources = spec.sourceCanonicalSlugs || [action.canonicalSlug];
    const sourceActions = (releaseScope.actions || [])
      .filter((item) => groupedSources.includes(item.canonicalSlug));
    const reviewedAction = preferredReviewedAction(sourceActions, {
      stableId: spec.docIdentity?.stableId || spec.stableId || action.stableId,
    });
    const planningAction = actionForPlanning(reviewedAction, spec);
    selectedSlugs.add(action.canonicalSlug);

    const category = required(spec.category, `Candidate ${planningAction.canonicalSlug} is missing category`);
    const identity = assertCandidateIdentity({ action: planningAction, spec, category });
    const releasePlanningContext = assertCompatibleReviewedActions(sourceActions, identity);
    if (planningAction.documentationOwnership?.classification === 'method_owned'
      && identity.stableId !== planningAction.documentationOwnership.selectedOwnerStableId) {
      throw ownershipError(
        'METHOD_OWNED_STANDALONE_FORBIDDEN',
        `Candidate ${action.canonicalSlug} must retain selected method owner ${planningAction.documentationOwnership.selectedOwnerStableId}`,
      );
    }
    assertNoSyntheticGroupAcrossExistingRecords({ spec, identity });
    const existingRecord = assertExistingRecordEvidence({ action: planningAction, spec, identity });
    const existingRecordLookup = assertCreateMissingEvidence({ action: planningAction, spec, identity });
    const inheritanceReview = assertInheritanceReview({ action: planningAction, spec, requiredSuccessorTracks });
    for (const sourceSlug of groupedSources) {
      if (candidates[sourceSlug]) selectedSlugs.add(sourceSlug);
    }
    if (emittedDocIdentities.has(identity.stableId)) continue;
    emittedDocIdentities.add(identity.stableId);

    const folderToken = spec.folderToken || folders[category] || null;
    const folderRef = spec.folderRef || null;
    if (!folderToken && (!folderRef || !resourceRefs.has(folderRef))) {
      throw new Error(`Candidate ${action.canonicalSlug} has no folder token or approved folder resource for category ${category}`);
    }
    const dependencies = [...new Set(spec.dependencies || [])];
    for (const dependency of dependencies) {
      if (!resourceRefs.has(dependency)) throw new Error(`Candidate ${action.canonicalSlug} references unknown resource ${dependency}`);
    }
    const parentRecordId = existingRecord?.parentRecordId || existingRecordLookup?.parentRecordId || null;
    const parentRecordRef = spec.parentRecordRef || existingRecordLookup?.parentRecordRef || null;
    if (!parentRecordId && (!parentRecordRef || !dependencies.includes(parentRecordRef))) {
      throw new Error(`Candidate ${action.canonicalSlug} has no parent record or approved parent resource`);
    }
    const copySource = assertCopySourceEvidence({
      action: planningAction,
      spec,
      identity,
      current: existingRecord,
      targetVersion: version,
      targetFolderToken: folderToken,
      targetFolderRef: folderRef,
    });
    const sourceVariants = sourceVariantsFor(sourceActions);
    const releaseEvidence = uniqueValues([
      ...sourceActions.flatMap((item) => item.evidence || []),
      ...sourceVariants.flatMap((variant) => variant.evidence || []),
    ]);
    const evidence = uniqueValues([
      ...releaseEvidence,
      ...sourceActions.flatMap((item) => evidenceFor(item, spec, releaseScope)),
    ]);
    const reasons = uniqueValues([
      ...sourceActions.flatMap((item) => item.reasons || [item.reason]),
      ...sourceVariants.map((variant) => variant.reason),
    ]);
    const planningTarget = {
      version,
      folderToken,
      parentRecordId,
      versionRootToken,
      ancestryVerified: true,
    };
    if (folderRef) planningTarget.folderRef = folderRef;
    if (parentRecordRef) planningTarget.parentRecordRef = parentRecordRef;
    const selectedAction = {
      ...planningAction,
      stableId: identity.stableId,
      canonicalSlug: identity.canonicalSlug,
      symbol: identity.symbol,
      sourceVariants: sourceVariants.length > 0 ? sourceVariants : undefined,
      reasons,
      evidence: releaseEvidence,
      inheritanceReview,
      planningContext: {
        ...(releasePlanningContext || {}),
        current: existingRecord || undefined,
        existingRecordLookup: existingRecordLookup || undefined,
        copySource,
        target: planningTarget,
        dependencies,
        tokenReferencedByOlderVersions: existingRecord?.referencedByOlderVersions ?? false,
      },
    };
    selected.push(selectedAction);
    contexts[identity.stableId] = {
      repository: spec.repository || candidateSpec.repository || planningAction.source?.repository || releaseScope.sdkName,
      revision: spec.revision || releaseScope.targetCommit,
      category,
      symbolName: identity.symbol,
      kind: spec.kind,
      title: spec.title || titleFor({ ...planningAction, symbol: identity.symbol }),
      summary: required(spec.summary, `Candidate ${action.canonicalSlug} is missing summary`),
      signature: clone(spec.signature),
      params: clone(spec.params),
      requestVariants: clone(spec.requestVariants),
      callableMembers: clone(spec.callableMembers),
      reviewedEvidence: evidence,
      result: clone(spec.result),
      exceptions: defaultExceptions(planningAction, spec, evidence),
      examples: exampleFor(planningAction, { ...candidateSpec.defaults, ...spec, version }, evidence),
      inheritanceReview,
      sourceVariants,
      reasons,
      documentationOwnership: clone(planningAction.documentationOwnership),
      notes: spec.notes || candidateSpec.notes || [],
    };
  }

  if (selected.length === 0) {
    throw new Error('Candidate spec did not match any release-scope actions');
  }

  const filteredScope = {
    ...releaseScope,
    actions: selected,
    resources,
    scannerDiagnostics: [
      ...(releaseScope.scannerDiagnostics || []).filter((item) => item.code !== 'FILTERED_USER_FACING_SCOPE'),
      {
        level: 'info',
        code: 'FILTERED_USER_FACING_SCOPE',
        message: `Filtered to ${selected.length} reviewed user-facing ${releaseScope.language} ${releaseScope.track} documentation candidates; configured scanner noise excluded.`,
      },
    ],
    writesPerformed: false,
    scanStateUpdated: false,
  };
  const validation = validateReleaseScope(filteredScope);
  if (!validation.valid) {
    throw new Error(`Filtered release scope is invalid: ${JSON.stringify(validation.errors)}`);
  }

  return {
    filteredScope,
    referenceContext: {
      schemaVersion: 1,
      releaseRange: releaseScope.releaseRange,
      targetTag: releaseScope.targetTag,
      contexts,
    },
    selectedCount: selected.length,
  };
}

function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  for (const name of ['releaseScope', 'candidateSpec', 'outputScope', 'outputContext']) {
    if (!args[name]) throw new Error(`Missing required --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  }

  const releaseScope = readJson(args.releaseScope);
  const result = buildReviewedReleaseContext({
    releaseScope,
    candidateSpec: readJson(args.candidateSpec),
    sdkReference: readSdkReference({
      language: releaseScope.language,
      filePath: args.sdkReference,
    }),
  });
  writeJson(args.outputScope, result.filteredScope);
  writeJson(args.outputContext, result.referenceContext);
  console.log(JSON.stringify({
    selectedCount: result.selectedCount,
    outputScope: args.outputScope,
    outputContext: args.outputContext,
  }, null, 2));
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  buildReviewedReleaseContext,
  compareTracks,
  detectVersionTracksFromReference,
  expandCandidateSpec,
  parseArgs,
  readSdkReference,
  resolveDetectedSuccessorTracks,
  resolveRequiredSuccessorTracks,
  trackParts,
};

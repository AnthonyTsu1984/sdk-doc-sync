'use strict';

const { canonicalStringify } = require('../../../doc-ops-core/src/canonical-json');
const { sha256Digest } = require('../../../doc-ops-core/src/digest');

const SHARED_TOKEN_STATUSES = new Set(['shared', 'unshared', 'unknown']);
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

// Feishu link URLs can carry percent-encoded tokens; decode the extracted
// token segment (not the whole URL, whose separators must stay encoded-safe)
// so the same document always normalizes to the same token.
function documentTokenFromLink(link) {
  if (!nonEmptyString(link)) return null;
  const match = link.match(/\/docx\/([^/?#]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function trackInventoryDigest(entries) {
  const normalized = (entries || [])
    .map((entry) => ({
      recordId: entry?.recordId || null,
      documentToken: entry?.documentToken || null,
    }))
    .sort((left, right) => `${left.recordId}\u0000${left.documentToken}`
      .localeCompare(`${right.recordId}\u0000${right.documentToken}`));
  return sha256Digest(Buffer.from(canonicalStringify(normalized), 'utf8'));
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function canonicalEvidence(value) {
  const copy = clone(value) || {};
  delete copy.evidenceDigest;
  return copy;
}

function digestInheritanceEvidence(value) {
  return sha256Digest(Buffer.from(canonicalStringify(canonicalEvidence(value)), 'utf8'));
}

function createInheritanceEvidence({
  stableId,
  current,
  target,
  sharedTokenStatus,
  referencedRecordIds = [],
  trackInventoryDigests = {},
  collectedAt = '1970-01-01T00:00:00.000Z',
} = {}) {
  const evidence = {
    schemaVersion: 1,
    stableId: stableId || null,
    current: clone(current) || null,
    target: clone(target) || null,
    sharedToken: {
      status: sharedTokenStatus || 'unknown',
      referencedRecordIds: [...new Set((referencedRecordIds || []).filter(nonEmptyString))].sort(),
    },
    trackInventoryDigests: clone(trackInventoryDigests) || {},
    collectedAt,
  };
  return Object.freeze({ ...evidence, evidenceDigest: digestInheritanceEvidence(evidence) });
}

function validateInheritanceEvidence(evidence, {
  stableId = null,
  current = null,
  target = null,
} = {}) {
  const errors = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return { valid: false, errors: [{ code: 'SHARED_TOKEN_EVIDENCE_REQUIRED', path: '$' }] };
  }
  if (evidence.schemaVersion !== 1) errors.push({ code: 'INHERITANCE_EVIDENCE_SCHEMA_INVALID', path: '$.schemaVersion' });
  if (!nonEmptyString(evidence.evidenceDigest) || evidence.evidenceDigest !== digestInheritanceEvidence(evidence)) {
    errors.push({ code: 'INHERITANCE_EVIDENCE_DIGEST_INVALID', path: '$.evidenceDigest' });
  }
  if (!nonEmptyString(evidence.stableId)) errors.push({ code: 'INHERITANCE_EVIDENCE_ID_REQUIRED', path: '$.stableId' });
  else if (stableId && evidence.stableId !== stableId) errors.push({ code: 'INHERITANCE_EVIDENCE_ID_MISMATCH', path: '$.stableId' });
  if (!evidence.current || typeof evidence.current !== 'object') {
    errors.push({ code: 'INHERITANCE_EVIDENCE_CURRENT_REQUIRED', path: '$.current' });
  } else {
    for (const key of ['recordId', 'documentToken', 'version', 'folderToken', 'versionRootToken']) {
      if (!nonEmptyString(evidence.current[key])) errors.push({ code: 'INHERITANCE_EVIDENCE_CURRENT_REQUIRED', path: `$.current.${key}` });
    }
    if (evidence.current.ancestryVerified !== true || evidence.current.placementVerified !== true) {
      errors.push({ code: 'INHERITANCE_EVIDENCE_CURRENT_UNVERIFIED', path: '$.current' });
    }
  }
  if (!evidence.target || typeof evidence.target !== 'object') {
    errors.push({ code: 'INHERITANCE_EVIDENCE_TARGET_REQUIRED', path: '$.target' });
  } else {
    for (const key of ['version', 'versionRootToken']) {
      if (!nonEmptyString(evidence.target[key])) errors.push({ code: 'INHERITANCE_EVIDENCE_TARGET_REQUIRED', path: `$.target.${key}` });
    }
    if (!nonEmptyString(evidence.target.folderToken) && !nonEmptyString(evidence.target.folderRef)) {
      errors.push({ code: 'INHERITANCE_EVIDENCE_TARGET_REQUIRED', path: '$.target.folderToken' });
    }
    if (evidence.target.ancestryVerified !== true) errors.push({ code: 'INHERITANCE_EVIDENCE_TARGET_UNVERIFIED', path: '$.target.ancestryVerified' });
  }
  if (!evidence.sharedToken || !SHARED_TOKEN_STATUSES.has(evidence.sharedToken.status)) {
    errors.push({ code: 'SHARED_TOKEN_EVIDENCE_STATUS_INVALID', path: '$.sharedToken.status' });
  } else if (evidence.sharedToken.status === 'unknown') {
    errors.push({ code: 'SHARED_TOKEN_EVIDENCE_UNKNOWN', path: '$.sharedToken.status' });
  }
  if (!Array.isArray(evidence.sharedToken?.referencedRecordIds)) {
    errors.push({ code: 'SHARED_TOKEN_EVIDENCE_REFERENCES_REQUIRED', path: '$.sharedToken.referencedRecordIds' });
  } else if (evidence.sharedToken.referencedRecordIds.some((id) => !nonEmptyString(id))) {
    errors.push({ code: 'SHARED_TOKEN_EVIDENCE_REFERENCES_REQUIRED', path: '$.sharedToken.referencedRecordIds' });
  } else if (nonEmptyString(evidence.current?.recordId) && SHARED_TOKEN_STATUSES.has(evidence.sharedToken?.status)) {
    // referencedRecordIds is the complete set of Bitable records (across every
    // enumerated track, current record included) whose Docs pointer resolves to
    // current.documentToken. The status must agree with that set so the live
    // pre-write requery has an exact approved baseline to compare against.
    const referenced = new Set(evidence.sharedToken.referencedRecordIds);
    const includesCurrent = referenced.has(evidence.current.recordId);
    const consistent = evidence.sharedToken.status === 'shared'
      ? includesCurrent && referenced.size >= 2
      : evidence.sharedToken.status === 'unshared'
        ? includesCurrent && referenced.size === 1
        : true;
    if (!consistent) {
      errors.push({ code: 'SHARED_TOKEN_EVIDENCE_REFERENCES_INCONSISTENT', path: '$.sharedToken.referencedRecordIds' });
    }
  }
  if (!evidence.trackInventoryDigests || typeof evidence.trackInventoryDigests !== 'object') {
    errors.push({ code: 'INHERITANCE_EVIDENCE_INVENTORY_REQUIRED', path: '$.trackInventoryDigests' });
  } else {
    for (const [version, digest] of Object.entries(evidence.trackInventoryDigests)) {
      if (!DIGEST_PATTERN.test(String(digest))) {
        errors.push({ code: 'INHERITANCE_EVIDENCE_INVENTORY_REQUIRED', path: `$.trackInventoryDigests.${version}` });
      }
    }
    // Both the track that physically holds the document and the track being
    // planned must have been fully enumerated, or sharing is unknown.
    for (const version of [evidence.current?.version, evidence.target?.version]) {
      if (nonEmptyString(version) && !nonEmptyString(evidence.trackInventoryDigests[version])) {
        errors.push({ code: 'INHERITANCE_EVIDENCE_INVENTORY_REQUIRED', path: `$.trackInventoryDigests.${version}` });
      }
    }
  }
  if (!nonEmptyString(evidence.collectedAt)) {
    errors.push({ code: 'INHERITANCE_EVIDENCE_COLLECTED_AT_REQUIRED', path: '$.collectedAt' });
  }
  if (current && evidence.current) {
    for (const key of ['recordId', 'documentToken', 'version', 'folderToken']) {
      if (nonEmptyString(current[key]) && evidence.current[key] !== current[key]) {
        errors.push({ code: 'INHERITANCE_EVIDENCE_CURRENT_MISMATCH', path: `$.current.${key}` });
      }
    }
  }
  if (target && evidence.target) {
    for (const key of ['version', 'folderToken', 'folderRef', 'versionRootToken']) {
      if (nonEmptyString(target[key]) && evidence.target[key] !== target[key]) {
        errors.push({ code: 'INHERITANCE_EVIDENCE_TARGET_MISMATCH', path: `$.target.${key}` });
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function evidenceShared(evidence) {
  return evidence?.sharedToken?.status === 'shared';
}

module.exports = {
  SHARED_TOKEN_STATUSES,
  createInheritanceEvidence,
  digestInheritanceEvidence,
  documentTokenFromLink,
  evidenceShared,
  trackInventoryDigest,
  validateInheritanceEvidence,
};

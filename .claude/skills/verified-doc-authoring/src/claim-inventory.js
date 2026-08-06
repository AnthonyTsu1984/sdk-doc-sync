'use strict';

const { canonicalize } = require('../../doc-ops-core/src/canonical-json');
const { digestSemantic } = require('../../doc-ops-core/src/digest');

const CLAIM_STATUSES = Object.freeze([
  'reference-only',
  'verified',
  'contradicted',
  'needs-verification',
]);

function nonEmpty(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`);
  return value;
}

function normalizeClaim(claim) {
  nonEmpty(claim?.claimId, 'claimId');
  if (!/^claim:[a-z0-9][a-z0-9._:-]*$/.test(claim.claimId)) throw new TypeError(`Invalid claimId: ${claim.claimId}`);
  nonEmpty(claim.text, `text for ${claim.claimId}`);
  if (!claim.sourceLocator || typeof claim.sourceLocator !== 'object' || Array.isArray(claim.sourceLocator)) {
    throw new TypeError(`sourceLocator is required for ${claim.claimId}`);
  }
  if (!Array.isArray(claim.apiShapeEvidence)) throw new TypeError(`apiShapeEvidence is required for ${claim.claimId}`);
  if (!Array.isArray(claim.behavioralEvidence)) throw new TypeError(`behavioralEvidence is required for ${claim.claimId}`);
  if (!CLAIM_STATUSES.includes(claim.status)) throw new TypeError(`Unsupported claim status for ${claim.claimId}: ${claim.status}`);
  if (typeof claim.notes !== 'string') throw new TypeError(`notes is required for ${claim.claimId}`);
  return canonicalize({
    claimId: claim.claimId,
    text: claim.text,
    sourceLocator: claim.sourceLocator,
    apiShapeEvidence: claim.apiShapeEvidence,
    behavioralEvidence: claim.behavioralEvidence,
    status: claim.status,
    notes: claim.notes,
  });
}

function buildClaimInventory({ inventoryId, target, claims = [] }) {
  nonEmpty(inventoryId, 'inventoryId');
  if (!target || typeof target !== 'object' || Array.isArray(target)) throw new TypeError('target is required');
  if (!Array.isArray(claims) || claims.length === 0) throw new TypeError('claims are required');
  const normalizedClaims = claims.map(normalizeClaim).sort((left, right) => left.claimId.localeCompare(right.claimId));
  const identifiers = normalizedClaims.map((claim) => claim.claimId);
  if (new Set(identifiers).size !== identifiers.length) throw new Error('Claim inventory contains duplicate claimId values');
  const semantic = canonicalize({
    schemaVersion: 1,
    artifactType: 'verified-doc-claim-inventory',
    inventoryId,
    target,
    claims: normalizedClaims,
    claimSetDigest: digestSemantic(normalizedClaims),
  });
  return Object.freeze({ ...semantic, inventoryDigest: digestSemantic(semantic) });
}

function buildDraftArtifact({ markdown, claimInventory, visibleUnresolvedClaimIds = [] }) {
  if (typeof markdown !== 'string' || markdown.trim() === '') throw new TypeError('markdown is required');
  if (!claimInventory?.inventoryDigest) throw new TypeError('claimInventory is required');
  const expected = claimInventory.claims
    .filter((claim) => claim.status === 'needs-verification' || claim.status === 'contradicted')
    .map((claim) => claim.claimId)
    .sort();
  const visible = [...new Set(visibleUnresolvedClaimIds)].sort();
  const missing = expected.filter((claimId) => !visible.includes(claimId));
  if (missing.length > 0) throw new Error(`Draft must keep unresolved or contradicted claims visible: ${missing.join(', ')}`);
  const unknown = visible.filter((claimId) => !expected.includes(claimId));
  if (unknown.length > 0) throw new Error(`Draft declares unknown visible unresolved claims: ${unknown.join(', ')}`);
  const semantic = canonicalize({
    schemaVersion: 1,
    artifactType: 'verified-doc-draft',
    claimInventoryDigest: claimInventory.inventoryDigest,
    markdownDigest: digestSemantic({ markdown }),
    visibleUnresolvedClaimIds: visible,
  });
  return Object.freeze({ ...semantic, semanticDigest: digestSemantic(semantic) });
}

module.exports = { CLAIM_STATUSES, buildClaimInventory, buildDraftArtifact };

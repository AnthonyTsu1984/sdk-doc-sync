'use strict';

const CLASSIFICATIONS = new Set(['standalone', 'method_owned', 'ambiguous']);
const AMBIGUOUS_KINDS = new Set(['class', 'struct', 'interface']);
const STANDALONE_KINDS = new Set(['method', 'function', 'command', 'enum']);

class DocumentationOwnershipError extends TypeError {
  constructor(code, message) {
    super(message);
    this.name = 'DocumentationOwnershipError';
    this.code = code;
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function owner(owner, index) {
  if (!owner || typeof owner !== 'object'
    || !nonEmptyString(owner.stableId)
    || !nonEmptyString(owner.canonicalSlug)
    || !nonEmptyString(owner.category)) {
    throw new TypeError(`Documentation owner at index ${index} requires stableId, canonicalSlug, and category`);
  }
  return {
    stableId: owner.stableId,
    canonicalSlug: owner.canonicalSlug,
    category: owner.category,
  };
}

function ownersFor(entry) {
  const ownership = entry?.documentationOwnership || {};
  const collections = [ownership.owners, ownership.targets, entry?.owners, entry?.targets]
    .filter((owners) => owners !== undefined);
  for (const owners of collections) {
    if (!Array.isArray(owners)) {
      throw new DocumentationOwnershipError('INVALID_DOCUMENTATION_OWNERS', 'Documentation owners must be an array');
    }
  }
  return collections.flat().map(owner);
}

function explicitClassification(entry) {
  return entry?.documentationOwnership?.classification || entry?.classification || null;
}

function classifyDocumentationOwnership({ identityMapEntry = null, symbol = null } = {}) {
  const entry = identityMapEntry || symbol?.documentationOwnership || null;
  const classification = explicitClassification(entry);
  if (classification && !CLASSIFICATIONS.has(classification)) {
    throw new TypeError(`Unsupported documentation ownership classification: ${classification}`);
  }

  const owners = ownersFor(entry);
  const kind = String(symbol?.kind || '').toLowerCase();
  if (classification === 'standalone' && owners.length > 0) {
    throw new DocumentationOwnershipError(
      'METHOD_OWNED_STANDALONE_FORBIDDEN',
      'Standalone documentation cannot retain known method owners',
    );
  }
  const resolvedClassification = classification
    || (owners.length > 0 ? 'method_owned' : null)
    || (identityMapEntry ? 'standalone' : null)
    || (AMBIGUOUS_KINDS.has(kind) ? 'ambiguous' : null)
    || (STANDALONE_KINDS.has(kind) ? 'standalone' : 'ambiguous');
  const result = { classification: resolvedClassification };
  if (resolvedClassification === 'method_owned') {
    if (owners.length === 0) {
      throw new TypeError('Method-owned documentation requires at least one owner');
    }
    result.owners = owners;
  }
  const evidence = entry?.documentationOwnership?.evidence || entry?.evidence;
  if (Array.isArray(evidence) && evidence.length > 0) result.evidence = clone(evidence);
  return result;
}

function ownershipFor(identityMapEntry, symbol) {
  return classifyDocumentationOwnership({ identityMapEntry, symbol });
}

module.exports = {
  CLASSIFICATIONS,
  AMBIGUOUS_KINDS,
  STANDALONE_KINDS,
  DocumentationOwnershipError,
  classifyDocumentationOwnership,
  ownershipFor,
};

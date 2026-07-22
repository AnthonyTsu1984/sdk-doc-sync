'use strict';

const PLATFORM_AUDIENCES = Object.freeze(['milvus', 'zilliz']);
const AUDIENCES = Object.freeze(['shared', ...PLATFORM_AUDIENCES]);

function normalizeAudience(value) {
  const audience = value == null || value === '' ? 'shared' : String(value);
  if (!AUDIENCES.includes(audience)) {
    throw new TypeError(`unsupported audience ${audience}`);
  }
  return audience;
}

function visibleToAudience(item, target) {
  const audience = normalizeAudience(item?.audience);
  return audience === 'shared' || audience === target;
}

function descriptionEntries(field) {
  if (field?.descriptions && typeof field.descriptions === 'object') {
    return PLATFORM_AUDIENCES
      .filter((audience) => typeof field.descriptions[audience] === 'string')
      .map((audience) => ({ audience, description: field.descriptions[audience] }));
  }
  return [{
    audience: normalizeAudience(field?.audience),
    description: String(field?.description || ''),
  }];
}

function collectDocumentAudiences(document) {
  const found = new Set();
  const add = (value) => {
    const audience = normalizeAudience(value);
    if (audience !== 'shared') found.add(audience);
  };
  const visitField = (field) => {
    add(field?.audience);
    for (const entry of descriptionEntries(field)) add(entry.audience);
    for (const child of field?.children || []) visitField(child);
  };
  for (const signature of document?.signatures || []) {
    for (const field of signature.inputs || []) visitField(field);
  }
  for (const variant of document?.requestVariants || []) {
    add(variant.audience);
    for (const field of variant.inputs || []) visitField(field);
  }
  for (const example of document?.examples || []) add(example.audience);
  return PLATFORM_AUDIENCES.filter((audience) => found.has(audience));
}

module.exports = {
  AUDIENCES,
  PLATFORM_AUDIENCES,
  normalizeAudience,
  visibleToAudience,
  descriptionEntries,
  collectDocumentAudiences,
};

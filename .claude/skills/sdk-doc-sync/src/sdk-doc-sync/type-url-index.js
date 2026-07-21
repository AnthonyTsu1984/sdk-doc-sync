'use strict';

const { isSafeUrl } = require('../document-ir/validate');
const { normalizeRecord } = require('./bitable-record-index');

const LINKABLE_TYPES = new Set(['Class', 'Enum']);

function aliasesForTitle(value) {
  const title = String(value || '').trim();
  if (!title) return [];
  const withoutCall = title.replace(/\(\)\s*$/, '').trim();
  return [...new Set([withoutCall, `${withoutCall}()`].filter(Boolean))];
}

function isDocumentUrl(value) {
  if (!isSafeUrl(value)) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      && /\/(?:docx|wiki)\/[^/]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

function recordDetails(record) {
  if (record?.metadata && typeof record.metadata === 'object') {
    return {
      title: record.metadata.title,
      link: record.metadata.link,
      type: record.metadata.type,
    };
  }
  const normalized = normalizeRecord(record || {});
  return {
    title: normalized.title,
    link: normalized.link,
    type: normalized.type,
  };
}

function freezeSorted(entries) {
  return Object.freeze(Object.fromEntries(
    [...entries].sort(([left], [right]) => left.localeCompare(right)),
  ));
}

function buildTypeUrlIndex(records) {
  const families = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const { title, link, type } = recordDetails(record);
    if (!LINKABLE_TYPES.has(String(type || '').trim()) || !isDocumentUrl(link)) continue;
    const aliases = aliasesForTitle(title);
    const familyKey = aliases.at(-1);
    const family = families.get(familyKey) || { aliases: new Set(), urls: new Set() };
    aliases.forEach((alias) => family.aliases.add(alias));
    family.urls.add(link);
    families.set(familyKey, family);
  }
  const resolved = [];
  for (const family of families.values()) {
    if (family.urls.size !== 1) continue;
    const url = [...family.urls][0];
    for (const alias of family.aliases) resolved.push([alias, url]);
  }
  return freezeSorted(resolved);
}

function withoutSelfTypeUrls(typeUrls, title) {
  const selfAliases = new Set(aliasesForTitle(title));
  return freezeSorted(Object.entries(typeUrls || {}).filter(([alias]) => !selfAliases.has(alias)));
}

module.exports = {
  buildTypeUrlIndex,
  withoutSelfTypeUrls,
};

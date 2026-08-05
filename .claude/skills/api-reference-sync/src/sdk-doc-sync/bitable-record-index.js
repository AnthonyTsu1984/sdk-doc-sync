'use strict';

function textFromCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(textFromCell).filter(Boolean).join('');
  if (value && typeof value === 'object') {
    for (const key of ['text', 'title', 'name', 'value']) {
      if (Object.hasOwn(value, key)) return textFromCell(value[key]);
    }
  }
  return '';
}

function tokenFromLink(link) {
  if (!link) return '';
  try {
    const url = new URL(link);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.pathname.match(/\/(?:docx|wiki)\/([^/]+)\/?$/)?.[1]
      || url.pathname.match(/\/drive\/folder\/([^/]+)\/?$/)?.[1]
      || '';
  } catch {
    return '';
  }
}

function linkFromCell(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const link = linkFromCell(item);
      if (link) return link;
    }
    return '';
  }
  if (!value || typeof value !== 'object') return '';
  if (Object.hasOwn(value, 'link')) return textFromCell(value.link).trim();
  return '';
}

function docsCell(value) {
  const title = textFromCell(value);
  const link = linkFromCell(value);
  const token = tokenFromLink(link) || textFromCell(value?.token);
  return { title, link, token };
}

function parentRecordIds(value) {
  const out = [];
  for (const item of Array.isArray(value) ? value : []) {
    if (Array.isArray(item?.record_ids)) out.push(...item.record_ids);
    else if (item?.record_id) out.push(item.record_id);
  }
  return out;
}

function normalizeRecord(record) {
  const fields = record.fields || {};
  const docs = docsCell(fields.Docs);
  const slug = textFromCell(fields.Slug);
  return {
    recordId: record.record_id,
    title: docs.title,
    link: docs.link,
    documentToken: docs.token,
    slug,
    type: textFromCell(fields.Type),
    parentRecordIds: parentRecordIds(fields['父记录']).concat(parentRecordIds(fields.Parent)),
    raw: record,
  };
}

function addIndex({ first, all, ambiguous }, key, value) {
  if (!key) return;
  if (!first.has(key)) first.set(key, value);
  const values = all.get(key) || [];
  values.push(value);
  all.set(key, values);
  if (values.length > 1) ambiguous.add(key);
}

function buildBitableRecordIndex(records) {
  const normalized = records.map(normalizeRecord);
  const bySlug = new Map();
  const byTitle = new Map();
  const byToken = new Map();
  const bySlugAll = new Map();
  const byTitleAll = new Map();
  const byTokenAll = new Map();
  const ambiguous = {
    slugs: new Set(),
    titles: new Set(),
    tokens: new Set(),
  };

  for (const record of normalized) {
    addIndex({ first: bySlug, all: bySlugAll, ambiguous: ambiguous.slugs }, record.slug, record);
    addIndex({ first: byTitle, all: byTitleAll, ambiguous: ambiguous.titles }, record.title, record);
    addIndex({ first: byToken, all: byTokenAll, ambiguous: ambiguous.tokens }, record.documentToken, record);
  }

  return {
    records: normalized,
    bySlug,
    byTitle,
    byToken,
    bySlugAll,
    byTitleAll,
    byTokenAll,
    ambiguous,
  };
}

module.exports = {
  buildBitableRecordIndex,
  docsCell,
  normalizeRecord,
  parentRecordIds,
};

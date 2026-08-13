'use strict';

const crypto = require('node:crypto');
const { digestSemantic } = require('../../doc-ops-core/src/digest');

const MARKER_PATTERN = /⟦LDS:[a-z-]+:\d{4}:[a-f0-9]{8}⟧/g;

function linesWithOffsets(source) {
  const records = [];
  let start = 0;
  for (const match of source.matchAll(/.*(?:\n|$)/g)) {
    if (!match[0]) continue;
    const end = start + match[0].length;
    records.push({ start, end, text: match[0], body: match[0].replace(/\r?\n$/, '') });
    start = end;
  }
  return records;
}

function marker(category, index, value) {
  const hash = crypto.createHash('sha256').update(value).digest('hex').slice(0, 8);
  return `⟦LDS:${category}:${String(index).padStart(4, '0')}:${hash}⟧`;
}

function protectedSpans(text) {
  const spans = [];
  const add = (pattern, category, capture = 0) => {
    for (const match of text.matchAll(pattern)) {
      const value = match[capture];
      if (!value) continue;
      const relative = capture === 0 ? 0 : match[0].indexOf(value);
      const start = match.index + relative;
      const end = start + value.length;
      if (!spans.some((span) => start < span.end && end > span.start)) spans.push({ start, end, category, value });
    }
  };
  add(/`+[^`\n]+`+/g, 'inline-code');
  add(/https?:\/\/[^\s)\]}>,]+/g, 'url');
  add(/\{#[A-Za-z0-9._:-]+\}/g, 'anchor');
  add(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, 'link-target', 1);
  add(/<!--\s*feishu-block:[\s\S]*?-->/g, 'feishu-block');
  add(/<Supademo\b[^>]*\/>/g, 'supademo');
  add(/<\/?[A-Za-z][^>]*>/g, 'html-jsx');
  add(/\$\{[^}]+\}|\{\{[^}]+\}\}/g, 'placeholder');
  return spans.sort((left, right) => left.start - right.start || left.end - right.end);
}

function protectUnit(text) {
  const spans = protectedSpans(text);
  const entries = spans.map((span, index) => ({ ...span, marker: marker(span.category, index + 1, span.value) }));
  let content = text;
  for (const entry of [...entries].sort((left, right) => right.start - left.start)) {
    content = `${content.slice(0, entry.start)}${entry.marker}${content.slice(entry.end)}`;
  }
  return { content, entries };
}

function tableCellRanges(record) {
  if (!record.body.includes('|')) return [];
  const indexes = [];
  for (let index = 0; index < record.body.length; index += 1) {
    if (record.body[index] === '|' && record.body[index - 1] !== '\\') indexes.push(index);
  }
  if (indexes.length < 2) return [];
  const ranges = [];
  for (let index = 0; index < indexes.length - 1; index += 1) {
    let start = indexes[index] + 1;
    let end = indexes[index + 1];
    while (start < end && /\s/.test(record.body[start])) start += 1;
    while (end > start && /\s/.test(record.body[end - 1])) end -= 1;
    if (start === end) continue;
    const value = record.body.slice(start, end);
    if (/^:?-{3,}:?$/.test(value)) continue;
    ranges.push({ start: record.start + start, end: record.start + end, text: value, kind: 'table-cell' });
  }
  return ranges;
}

function editableLineRange(record) {
  const body = record.body;
  if (!body.trim()) return null;
  const heading = body.match(/^(\s{0,3}#{1,6}\s+)(.+)$/);
  if (heading) {
    const start = record.start + heading[1].length;
    return { start, end: record.start + body.length, text: heading[2], kind: 'heading' };
  }
  if (/^\s*(?:```|~~~)/.test(body)) return null;
  if (/^\s*(?:import|export)\b/.test(body)) return null;
  if (/^\s*<!--/.test(body) || /^\s*<Supademo\b/.test(body)) return null;
  if (/^\s*<\/?[A-Za-z][^>]*>\s*$/.test(body)) return null;
  const prefix = body.match(/^(\s*(?:(?:[-+*]|\d+\.)\s+|>\s*))?/)[0].length;
  let start = prefix;
  let end = body.length;
  while (start < end && /\s/.test(body[start])) start += 1;
  while (end > start && /\s/.test(body[end - 1])) end -= 1;
  if (start === end) return null;
  return { start: record.start + start, end: record.start + end, text: body.slice(start, end), kind: 'paragraph' };
}

function collectRanges(source) {
  const records = linesWithOffsets(source);
  const ranges = [];
  let bodyStart = 0;
  if (records[0]?.body === '---') {
    const closingIndex = records.findIndex((record, index) => index > 0 && record.body === '---');
    if (closingIndex !== -1) {
      const humanFields = new Set(['title', 'sidebar_label', 'description', 'keywords']);
      for (const record of records.slice(1, closingIndex)) {
        const match = record.body.match(/^([A-Za-z0-9_-]+):(\s*)(.*)$/);
        if (!match || !humanFields.has(match[1]) || !match[3].trim()) continue;
        const rawValue = match[3];
        const leading = rawValue.length - rawValue.trimStart().length;
        const trimmed = rawValue.trim();
        let relativeStart = match[1].length + 1 + match[2].length + leading;
        let text = trimmed;
        if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
          relativeStart += 1;
          text = trimmed.slice(1, -1);
        }
        ranges.push({
          start: record.start + relativeStart,
          end: record.start + relativeStart + text.length,
          text,
          kind: 'frontmatter',
        });
      }
      bodyStart = records[closingIndex].end;
    }
  }
  let fence = null;
  for (const record of records) {
    if (record.start < bodyStart) continue;
    const fenceMatch = record.body.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }
    const cells = tableCellRanges(record);
    if (cells.length) ranges.push(...cells);
    else {
      const range = editableLineRange(record);
      if (range) ranges.push(range);
    }
  }
  return ranges;
}

function prepareTranslationContent(sourceContent, { idPrefix = 'document' } = {}) {
  if (typeof sourceContent !== 'string') throw new TypeError('sourceContent must be a string');
  const units = collectRanges(sourceContent).map((range, index) => {
    const id = `${idPrefix}.unit.${String(index + 1).padStart(4, '0')}`;
    const protection = protectUnit(range.text);
    return { ...range, id, protection, text: protection.content };
  });
  return Object.freeze({
    sourceContent,
    units: units.map(({ id, kind, text }) => Object.freeze({ id, kind, text })),
    manifest: units,
    semanticUnitsDigest: digestSemantic(units.map(({ id, kind, start, end, text, protection }) => ({
      id, kind, start, end, text, protectedMarkers: protection.entries.map((entry) => entry.marker),
    }))),
  });
}

function exactTranslations(response, units) {
  if (!response || typeof response !== 'object' || Array.isArray(response) || JSON.stringify(Object.keys(response).sort()) !== JSON.stringify(['translations'])) {
    throw new Error('Translation response must use the exact schema {translations:[{id,text}]}');
  }
  if (!Array.isArray(response.translations) || response.translations.length !== units.length) {
    throw new Error('Translation response must return every semantic unit ID exactly once');
  }
  const byId = new Map();
  for (const entry of response.translations) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(['id', 'text']) || typeof entry.id !== 'string' || typeof entry.text !== 'string' || byId.has(entry.id)) {
      throw new Error('Translation response must return every semantic unit ID exactly once');
    }
    byId.set(entry.id, entry.text);
  }
  for (const unit of units) if (!byId.has(unit.id)) throw new Error('Translation response must return every semantic unit ID exactly once');
  return byId;
}

function restoreUnit(unit, translatedText) {
  const expected = unit.protection.entries.map((entry) => entry.marker).sort();
  const actual = [...translatedText.matchAll(MARKER_PATTERN)].map((match) => match[0]).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Protected marker integrity failed for ${unit.id}`);
  let restored = translatedText;
  for (const entry of unit.protection.entries) restored = restored.replace(entry.marker, entry.value);
  if (MARKER_PATTERN.test(restored)) throw new Error(`Protected marker restoration failed for ${unit.id}`);
  return restored;
}

function applyTranslationResponse(prepared, response) {
  const translations = exactTranslations(response, prepared.manifest);
  let output = prepared.sourceContent;
  for (const unit of [...prepared.manifest].sort((left, right) => right.start - left.start)) {
    const restored = restoreUnit(unit, translations.get(unit.id));
    output = `${output.slice(0, unit.start)}${restored}${output.slice(unit.end)}`;
  }
  return output;
}

module.exports = { applyTranslationResponse, prepareTranslationContent };

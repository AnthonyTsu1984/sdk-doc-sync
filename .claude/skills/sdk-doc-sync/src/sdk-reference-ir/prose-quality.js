'use strict';

const ARTICLE_START = /^(?:The|A|An)\b/;
const PLURAL_PHRASE_START = /^(?:(?:Files|Paths|URLs|IDs|Keys|Options|Values|Items|Records|Entities|Parameters|Settings)\b|[A-Z][A-Za-z-]*(?:\s+[a-z][A-Za-z-]*)*\s+(?:files|paths|urls|ids|keys|options|values|items|records|entities|parameters|settings)\b)/;
const FRAGMENT_START = /^(?:url|uri|id|name|path|key|token|description)\s+of\b/i;

function descriptionDiagnostics(value) {
  const text = String(value || '').trim();
  const diagnostics = [];
  if (!/[.!?]$/.test(text)) diagnostics.push({ code: 'DESCRIPTION_PUNCTUATION' });
  if (FRAGMENT_START.test(text)) diagnostics.push({ code: 'DESCRIPTION_FRAGMENT' });
  if (!ARTICLE_START.test(text) && !PLURAL_PHRASE_START.test(text)) {
    diagnostics.push({ code: 'DESCRIPTION_START' });
  }
  if (/\w\(/.test(text) || /\)\w/.test(text)) diagnostics.push({ code: 'DESCRIPTION_SPACING' });
  if (/\(cloud\)/i.test(text)) diagnostics.push({ code: 'VAGUE_PLATFORM_MARKER' });
  return diagnostics;
}

module.exports = { descriptionDiagnostics };

'use strict';

const ARTICLE_START = /^(?:The|A|An)\b/;
const PLURAL_PHRASE_START = /^(?:(?:Files|Paths|URLs|IDs|Keys|Options|Values|Items|Records|Entities|Parameters|Settings)\b|[A-Z][A-Za-z-]*(?:\s+[a-z][A-Za-z-]*)*\s+(?:files|paths|urls|ids|keys|options|values|items|records|entities|parameters|settings)\b)/;
const FRAGMENT_START = /^(?:url|uri|id|name|path|key|token|description)\s+of\b/i;

function descriptionDiagnostics(value) {
  const text = String(value || '').trim();
  // Strip code tokens (backticks) and angle-bracket placeholders (<field>)
  // before the prose checks — function-call syntax like `avg(<field>)` is
  // legitimate python prose, not a missing-space defect.
  const proseText = text.replace(/`[^`]*`/g, '').replace(/<[^>]+>/g, '');
  const diagnostics = [];
  if (!/[.!?]$/.test(text)) diagnostics.push({ code: 'DESCRIPTION_PUNCTUATION' });
  if (FRAGMENT_START.test(text)) diagnostics.push({ code: 'DESCRIPTION_FRAGMENT' });
  if (!ARTICLE_START.test(text) && !PLURAL_PHRASE_START.test(text)) {
    diagnostics.push({ code: 'DESCRIPTION_START' });
  }
  // Function-call parens in prose (count(*), min(<field>), query(),
  // refresh_external_collection()) are legitimate — only flag word-( / )-word
  // spacing that is NOT a call form. Empty calls `name()` strip generically;
  // calls with arguments strip only for known function words (count/min/max/
  // sum/avg/len/...), so `project(cloud)` (a noun + parenthetical) still
  // flags as the missing-space defect.
  const spacingText = proseText
    .replace(/\b[A-Za-z_][A-Za-z0-9_]*\(\)/g, '')
    .replace(/\b(?:count|min|max|sum|avg|len|abs|round|floor|ceil|lower|upper|trim|concat|substr|replace|coalesce|nullif|cast|convert|sqrt|pow|exp|log)\s*\([^)\s]*\)/gi, '');
  if (/\w\(/.test(spacingText) || /\)\w/.test(spacingText)) diagnostics.push({ code: 'DESCRIPTION_SPACING' });
  if (/\(cloud\)/i.test(proseText)) diagnostics.push({ code: 'VAGUE_PLATFORM_MARKER' });
  return diagnostics;
}

module.exports = { descriptionDiagnostics };

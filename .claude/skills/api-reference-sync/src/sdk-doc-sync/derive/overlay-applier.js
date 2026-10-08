'use strict';

// Anchor-keyed patch application over base markdown (rust-overlay-pilot §2.2).
// Line-based: every anchor resolves to a concrete line region; a miss or a
// page-kind drift is a loud typed error, never a silent skip.

const crypto = require('node:crypto');

const SECTION_MARKERS = {
  'request-syntax': /^##\s+Request Syntax\s*$/,
  'request-fields': /^\*\*REQUEST FIELDS:\*\*\s*$/,
  'returns': /^\*\*RETURNS:\*\*\s*$/,
  'example': /^##\s+Example\s*$/,
  'parameters': /^\*\*PARAMETERS:\*\*\s*$/,
  'methods': /^\*\*METHODS:\*\*\s*$/,
  'variants': /^\*\*VARIANTS:\*\*\s*$/,
  'constructor': /^##\s+Constructor\s*$/,
  'runtime-configuration': /^##\s+Runtime configuration\s*$/,
  'method-index': /^##\s+Method index\s*$/,
};

// Any marker that can terminate a bullet region: a top-level bullet, a bold
// section marker, or a heading.
const REGION_TERMINATOR = /^(?:-\s+\S|\*\*[A-Z(][^*]*\*\*|#{1,6}\s)/;

function detectPageKind(markdown) {
  if (/^#\s*About\b/m.test(markdown) || (/^##\s+Installation\s*$/m.test(markdown) && /^##\s+Quick Start\s*$/m.test(markdown))) {
    return 'overview';
  }
  if (/^##\s+Constructor\s*$/m.test(markdown) && (/^##\s+Runtime configuration\s*$/m.test(markdown) || /^##\s+Method index\s*$/m.test(markdown))) {
    return 'container';
  }
  if (/^##\s+Request Syntax\s*$/m.test(markdown)) return 'method';
  if (/^\*\*VARIANTS:\*\*\s*$/m.test(markdown)) return 'enum';
  if (/^##\s+Constructor\s*$/m.test(markdown)) return 'module';
  if (SECTION_MARKERS.parameters.test(markdown) || SECTION_MARKERS.methods.test(markdown)) return 'struct';
  return 'struct';
}

class AnchorError extends Error {
  constructor(code, detail) {
    super(`${code}: ${JSON.stringify(detail)}`);
    this.code = code;
    this.detail = detail;
  }
}

function findLine(lines, regex) {
  const hits = [];
  lines.forEach((line, index) => {
    if (regex.test(line)) hits.push(index);
  });
  return hits;
}

// A bullet region = the `- \`key…\` line plus following indented lines until
// the next top-level construct.
function bulletRegion(lines, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Single-quoted pattern source keeps raw backticks painless: a top-level
  // bullet `- `key` followed by ':', '(', whitespace, backtick, or comma.
  const starts = findLine(lines, new RegExp('^\\s*-\\s+`' + escaped + '[:(\\s`,]'));
  if (starts.length === 0) return null;
  if (starts.length > 1) {
    throw new AnchorError('OVERLAY_ANCHOR_AMBIGUOUS', { key, matches: starts.length });
  }
  const start = starts[0];
  let end = start;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === '' ) { if (lines[i + 1] && /^\s{2,}\S/.test(lines[i + 1])) { end = i; continue; } break; }
    if (REGION_TERMINATOR.test(lines[i])) break;
    end = i;
  }
  return { start, end };
}

// A section region = the marker line through the line before the next marker
// (bold section, heading, or EOF).
function sectionRegion(lines, sectionKey) {
  const marker = SECTION_MARKERS[sectionKey];
  if (!marker) throw new AnchorError('OVERLAY_ANCHOR_MISS', { section: sectionKey, reason: 'unknown section key' });
  const starts = findLine(lines, marker);
  if (starts.length === 0) return null;
  const start = starts[0];
  let end = start;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^(?:\*\*[A-Z(][^*]*\*\*|#{1,6}\s)/.test(lines[i])) break;
    end = i;
  }
  return { start, end };
}

function proseRegion(lines, match) {
  const positions = [];
  lines.forEach((line, index) => {
    if (line.includes(match)) positions.push(index);
  });
  if (positions.length === 0) return null;
  if (positions.length > 1) {
    throw new AnchorError('OVERLAY_PROSE_ANCHOR_AMBIGUOUS', { match, matches: positions.length });
  }
  const start = positions[0];
  let end = start;
  for (let i = start + 1; i < lines.length; i++) {
    if (REGION_TERMINATOR.test(lines[i]) || lines[i].trim() === '') break;
    if (lines[i - 1].includes(match) || /^\s{2,}\S/.test(lines[i])) end = i;
    else break;
  }
  return { start, end };
}

function resolveAnchor(lines, anchor, pageKind) {
  if (anchor.kind === 'section') return sectionRegion(lines, anchor.section);
  if (anchor.kind === 'prose') return proseRegion(lines, anchor.match);
  return bulletRegion(lines, anchor.key);
}

function applyEntry(markdown, entry) {
  const lines = markdown.split('\n');
  const detected = detectPageKind(markdown);
  if (detected !== entry.expect) {
    throw new AnchorError('OVERLAY_PAGE_KIND_DRIFT', {
      id: entry.id,
      expect: entry.expect,
      detected,
    });
  }
  const region = resolveAnchor(lines, entry.anchor, detected);
  if (!region) {
    throw new AnchorError('OVERLAY_ANCHOR_MISS', {
      id: entry.id,
      anchor: entry.anchor,
      reason: 'anchor not found at this base revision',
    });
  }
  const contentLines = entry.content ? entry.content.replace(/\n$/, '').split('\n') : [];
  switch (entry.action) {
    case 'insert-before':
      lines.splice(region.start, 0, ...contentLines);
      break;
    case 'insert-after':
      lines.splice(region.end + 1, 0, ...contentLines);
      break;
    case 'replace':
      lines.splice(region.start, region.end - region.start + 1, ...contentLines);
      break;
    case 'remove':
      lines.splice(region.start, region.end - region.start + 1);
      break;
    case 'wrap-note': {
      const note = ['', '> 📘 **Notes**', ...contentLines.map((line) => (line.startsWith('>') ? line : `> ${line}`))];
      lines.splice(region.end + 1, 0, ...note);
      break;
    }
    default:
      throw new AnchorError('OVERLAY_SCHEMA_VIOLATION', { id: entry.id, action: entry.action });
  }
  return lines.join('\n');
}

// Apply every patch entry for one page, in file order. Deterministic: the
// entry order in the patch file is the application order.
function applyPatches(markdown, patches, pageIdentity) {
  let out = markdown;
  const applied = [];
  for (const patch of patches) {
    if (patch.page !== pageIdentity) continue;
    for (const entry of patch.entries) {
      out = applyEntry(out, entry);
      applied.push(entry.id);
    }
  }
  return { markdown: out, applied };
}

function digest(markdown) {
  return crypto.createHash('sha256').update(markdown).digest('hex');
}

module.exports = { detectPageKind, applyPatches, digest, AnchorError };

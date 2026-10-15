#!/usr/bin/env node
'use strict';
// Canonical candidate-spec composer for Reconcile intake waves
// (campaign-control batch 15, design §4). One CLI replaces the four bespoke
// per-campaign composers of 2026-10-15 (go/node/java/python) plus their
// per-wave patch-context scripts:
//
//   compose   default — assemble the canonical candidate-spec (the
//             build-reviewed-release-context.js --candidate-spec consumption
//             surface, unchanged) from pinned inputs: the of-record release
//             scope, the intake decisions (the review's semantic payload), the
//             PR page dumps (sha-bound), the Bitable snapshot, the placement
//             audit, the version-root walk and the identity map.
//   --sweep   additionally run the offline versioned-tree-policy precheck over
//             every composed candidate (§8.3) and emit the typed exception
//             queue entries CLONE_ID_SHARED_IN_PLACE (kernel) and
//             FEISHU_RECORD_ABSENT (report-only) into the spec (§7). Ruling
//             (review P2-8): FEISHU_RECORD_ABSENT is reported ONLY under
//             --sweep — a gate-bound compose without --sweep never emits it
//             (nor CLONE_ID_SHARED_IN_PLACE); SCANNER_TAXONOMY_ORPHAN is the
//             one always-on queue entry because it drives the per-unit
//             verbatim fallback switch (§4.4).
//   --sweep-spec <spec>  sweep an already-composed candidate-spec instead of
//             composing (presentation mode for foreign-wave specs).
//   --patch-context <context> --candidate-spec <spec>
//             apply the spec's verbatim overlay (entry.verbatimContent + entry
//             .pr, links resolved, bare-Notes adjusted) onto a
//             build-reviewed-release-context output — the canonical
//             replacement for the per-wave patch-context-*.js scripts (§4.4).
//
// Fail-closed (§4.5): every unrecognizable input is a typed rejection; the
// composer never makes live calls; missing inputs are rejections, not
// defaults. Route defaults and page grammars come from the language profile
// (config/pr-page-profiles.json — data, not code).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  parsePage,
  stripMdEscapes,
  REJECTION_CODES,
  typedError,
} = require('../src/sdk-doc-sync/pr-page-parser');
const { validateReleaseScope } = require('../src/sdk-doc-sync/release-scope/schema');
const { normalizeReferenceMultiset } = require('../src/sdk-doc-sync/reference-multiset');
// Slice 3-3 (§8.3 prerequisite fulfilled): the sweep consumes the builder's
// exported joinSharedUpdateReviews — the exact join the reviewed-context
// build runs, SHARED_UPDATE_REVIEW_* validations included. The read-only
// re-implementation this file carried before the export existed is gone.
const { joinSharedUpdateReviews } = require('./build-reviewed-release-context');

const PROFILES_PATH = path.join(__dirname, '..', 'config', 'pr-page-profiles.json');

const EXCEPTION_CODES = Object.freeze({
  CLONE_ID_SHARED_IN_PLACE: 'CLONE_ID_SHARED_IN_PLACE',
  SCANNER_TAXONOMY_ORPHAN: 'SCANNER_TAXONOMY_ORPHAN',
  FEISHU_RECORD_ABSENT: 'FEISHU_RECORD_ABSENT',
});

const EXCEPTION_REASON = Object.freeze({
  [EXCEPTION_CODES.CLONE_ID_SHARED_IN_PLACE]: {
    evidence: 'shared-token reference multiset carries the unit\'s own record id more than once (clone-ID fork rows kept the record ids); pointingRecordIds attribution would be self-referential, so the shared in-place patch is unclassifiable by versioned-tree-policy',
    prefill: {
      options: [
        'kernel ruling/fix: versioned-tree-policy others.length === 0 passes without reviews (clone-ID blind-spot intent)',
        'operator adjudication: exclude the units (--exclude-slug); the successor track\'s COPY_PATCH_AND_REPOINT plans own the successor side',
        're-key the sibling fork rows so the clone pair carries distinct ids (live Bitable write)',
      ],
    },
    disposition: 'kernel',
  },
  [EXCEPTION_CODES.SCANNER_TAXONOMY_ORPHAN]: {
    evidence: 'scope scannerDiagnostics carry PR_SYMBOL_FALLBACK_BIND for the unit\'s page: no category-derived scanner candidate matched, so the schema-first adapter has no scanned symbol at dry-run',
    prefill: { fallbackRoute: 'verbatim' },
    dispositionNote: 'unit switched to the verbatim route (content byte-faithful); register the new page family in the scanner category data to clear the orphan permanently',
    disposition: 'data',
  },
  [EXCEPTION_CODES.FEISHU_RECORD_ABSENT]: {
    evidence: 'decisions swept the live snapshot and found no Bitable row for the canonical slug (existingRecordLookup.absent channel)',
    prefillNote: 'CREATE/BACKFILL plan rides the mechanical absent-record evidence (anchor record is the create target\'s parent); review the anchor binding',
    disposition: 'data',
  },
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const VALUE_OPTIONS = new Set([
  '--language', '--track', '--release-scope', '--decisions', '--pages-dir',
  '--snapshot', '--placement-audit', '--root-walk', '--identity-map',
  '--audit-proposal', '--repository', '--base-token', '--table-id', '--route',
  '--output', '--sweep-spec', '--candidate-spec', '--patch-context',
  '--patch-context-output', '--patch-report', '--successor-track',
]);

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--sweep') { args.sweep = true; continue; }
    if (arg === '--help' || arg === '-h') { args.help = true; continue; }
    if (!arg.startsWith('--')) { args._.push(arg); continue; }
    if (!VALUE_OPTIONS.has(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    const key = arg.replace(/^--/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    args[key] = value;
    index += 1;
  }
  return args;
}

function usage() {
  return `Usage: compose-pr-reconcile-candidate-spec --language <lang> --track <vX.Y.x> \\
  --release-scope <of-record scope> --decisions <decisions.json> \\
  --pages-dir <pages-<track>> --snapshot <bitable-snapshot.json> \\
  --placement-audit <placement-audit.json> --root-walk <root-walk.json> \\
  --identity-map <identity/<track>.json> --output <candidate-spec.json> \\
  [--audit-proposal <file>] [--repository owner/repo] [--base-token t] [--table-id t] \\
  [--route verbatim|structured] [--successor-track <vX.Y.x>] [--sweep] \\
  | --sweep-spec <spec.json> [--output <report.json>]
  | --patch-context <reference-context.json> --candidate-spec <spec.json> \\
    [--patch-context-output <file>] [--patch-report <file>]

Modes: compose (default) | sweep-only (--sweep-spec) | verbatim overlay apply
(--patch-context). Zero live calls; every failure is a typed rejection.`;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function reject(code, message) {
  throw typedError(code, message);
}

function requireFile(args, key, label) {
  const value = args[key];
  if (!value) reject('MISSING_REQUIRED_INPUT', `${label} (--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}) is required`);
  if (!fs.existsSync(value)) reject('MISSING_REQUIRED_INPUT', `${label} not found: ${value}`);
  return value;
}

function loadProfile(language) {
  const profiles = readJson(PROFILES_PATH);
  const profile = profiles[language];
  if (!profile) {
    reject('NOT_REGISTERED_PROFILE', `language ${language} has no entry in ${path.basename(PROFILES_PATH)}; registering a language is a data change (add its profile), not a kernel change`);
  }
  return { profile, profileVersion: profiles.profileVersion };
}

// ---------------------------------------------------------------------------
// Plain-text shaping helpers (structured route)
// ---------------------------------------------------------------------------

function plainText(text) {
  return stripMdEscapes(String(text || ''))
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function toField(entry, profile) {
  const structured = profile.structured || {};
  const type = entry.type || entry.builderArgType || null;
  const field = {
    name: entry.name,
    type,
    required: entry.required === true,
    audience: 'shared',
    description: plainText((entry.descriptionLines || []).join(' ')),
    ...(entry.defaultValue != null ? { defaultValue: entry.defaultValue } : {}),
  };
  if (!field.description && type && structured.typedParamFallbackDescription) {
    field.description = structured.typedParamFallbackDescription.replace('{type}', type);
  }
  if (!type && structured.untypedTypeFromName) field.type = entry.name;
  if (Array.isArray(entry.children) && entry.children.length > 0) {
    field.children = entry.children.map((child) => toField(child, profile));
  }
  return field;
}

function getterToField(getter) {
  const field = {
    name: getter.name,
    type: getter.type || null,
    resultFieldKind: 'method',
    audience: 'shared',
    description: plainText((getter.descriptionLines || []).join(' ')),
  };
  if (Array.isArray(getter.children) && getter.children.length > 0) {
    field.children = getter.children.map(getterToField);
  }
  return field;
}

function ensureSentence(text) {
  const trimmed = String(text).replace(/\s+/g, ' ').trim();
  if (!trimmed) return trimmed;
  if (/[.!?:;,]$/.test(trimmed) && !/:$/.test(trimmed)) return trimmed.replace(/;$/, '.');
  return `${trimmed}.`;
}

// python N1: nested bullet children fold into the parent description as
// "name (type): text." sentences (deterministic, meaning-preserving).
function pythonFoldChildren(field) {
  if (!Array.isArray(field.children) || field.children.length === 0) return field;
  const nested = field.children.map((child) => {
    const type = child.type ? ` (${child.type})` : '';
    const childField = pythonFoldChildren(child);
    return `${childField.name}${type}: ${childField.description}`;
  });
  const folded = { ...field, children: undefined };
  delete folded.children;
  folded.description = `${field.description} ${nested.map((line) => ensureSentence(line)).join(' ')}`.replace(/\s+/g, ' ').trim();
  return folded;
}

// python N2/N3/N4: deterministic description-start normalization (ported from
// the 2026-10-15 python intake composer).
const PYTHON_N2_ARTICLE_START = /^(?:The|A|An)\b/;
const PYTHON_N2_PLURAL_START = /^(?:(?:Files|Paths|URLs|IDs|Keys|Options|Values|Items|Records|Entities|Parameters|Settings)\b|[A-Z][A-Za-z-]*(?:\s+[a-z][A-Za-z-]*)*\s+(?:files|paths|urls|ids|keys|options|values|items|records|entities|parameters|settings)\b)/;
const PYTHON_N2_FRAGMENT_START = /^(?:url|uri|id|name|path|key|token|description)\s+of\b/i;
const PYTHON_N2_START_RULES = [
  [/^Default: `([^`]+)`\s+(.*)$/i, (m) => `${normalizePythonStart(m[2])} Defaults to \`${m[1]}\`.`],
  [/^Optional (.*)$/i, (m) => `An optional ${m[1]}`],
  [/^Whether (.*?)([.!?]?$)/i, (m) => `A flag that indicates whether ${m[1]}${m[2]}`],
  [/^Temporarily (.*)$/i, (m) => `An option to temporarily ${m[1]}`],
  [/^Extract (.*)$/i, (m) => `An option to extract ${m[1]}`],
  [/^(Determines|Refines|Groups|Sets|Keeps|Returns|Filters|Limits|Controls|Applies|Instructs|Overrides|Specifies|Defines|Uses|Allows|Enables|Disables|Carries|Holds|Contains|Includes|Provides|Supports|Accepts|Reads|Waits|Streams|Dumps|Lists|Checks) (.*)$/i, (m) => `An option that ${m[1].toLowerCase()}${m[2] ? ` ${m[2]}` : ''}`],
  [/^This (?:param|parameter|option|value|field|argument|setting)s?(,.*)? (.*)$/i, (m) => `An option${m[1] || ''} ${m[2]}`],
  [/^This (?:param|parameter|option|value|field|argument|setting) (is|has|does|can|will|should|must|applies|works|behaves|takes|uses)( .*)$/i, (m) => `An option that ${m[1]}${m[2]}`],
  [/^Must be (.*)$/i, (m) => `An option that must be ${m[1]}`],
  [/^Required for (.*)$/i, (m) => `An option required for ${m[1]}`],
  [/^Required when (.*)$/i, (m) => `An option required when ${m[1]}`],
  [/^Timeout (.*)$/i, (m) => `The timeout ${m[1]}`],
  [/^Time (limit|window|period|interval) (.*)$/i, (m) => `The time ${m[1]} ${m[2]}`],
  [/^Name of (.*)$/i, (m) => `The name of ${m[1]}`],
  [/^Type of (.*)$/i, (m) => `The type of ${m[1]}`],
  [/^Number of (.*)$/i, (m) => `The number of ${m[1]}`],
  [/^List of (.*)$/i, (m) => `A list of ${m[1]}`],
  [/^Dictionary of (.*)$/i, (m) => `A dictionary of ${m[1]}`],
  [/^Collection name(.*)$/i, (m) => `The collection name${m[1]}`],
  [/^Field name(.*)$/i, (m) => `The field name${m[1]}`],
  [/^Index name(.*)$/i, (m) => `The index name${m[1]}`],
  [/^Partition names?(.*)$/i, (m) => `The partition name${m[1]}`],
  [/^Search results (.*)$/i, (m) => `Search results ${m[1]}`],
];

function normalizePythonStart(text) {
  let out = String(text).replace(/\s+/g, ' ').trim();
  out = out.replace(/\bbrief description\b/ig, 'short description'); // N3
  out = out.replace(/^Additional arguments\b/, 'Additional parameters'); // N4
  for (let guard = 0; guard < 8; guard += 1) {
    if (!out) break;
    if (PYTHON_N2_ARTICLE_START.test(out) || PYTHON_N2_PLURAL_START.test(out)) break;
    if (PYTHON_N2_FRAGMENT_START.test(out)) {
      out = `The ${out.charAt(0).toLowerCase()}${out.slice(1)}`.replace(/^The (url|uri|id|name|path|key|token|description) /i, (m, w) => `The ${w} `);
      if (PYTHON_N2_FRAGMENT_START.test(out)) out = `The value of ${out.charAt(0).toLowerCase()}${out.slice(1).replace(/^(\w+)\s+of\b/i, '$1 ')}`;
      continue;
    }
    const rule = PYTHON_N2_START_RULES.find(([pattern]) => pattern.test(out));
    if (!rule) {
      out = `An option that ${out.charAt(0).toLowerCase()}${out.slice(1)}`;
      break;
    }
    out = out.replace(rule[0], rule[1]);
  }
  return ensureSentence(out);
}

// python N6: reflow multi-argument keyword calls one argument per line.
function reflowPythonCalls(code, pythonExampleStyle) {
  if (!pythonExampleStyle) return code;
  let source = String(code);
  for (let pass = 0; pass < 60; pass += 1) {
    const diagnostics = pythonExampleStyle.pythonExampleCallLayoutDiagnostics(source);
    if (diagnostics.length === 0) break;
    const line = diagnostics[0].line;
    const lines = source.split('\n');
    const lineIndex = line - 1;
    const target = lines[lineIndex];
    const openLocal = target.indexOf('(');
    if (openLocal < 0) break;
    const openAbs = lines.slice(0, lineIndex).reduce((sum, l) => sum + l.length + 1, 0) + openLocal;
    const closeAbs = matchParen(source, openAbs);
    if (closeAbs < 0) break;
    const args = splitTopLevelArgs(source, openAbs, closeAbs);
    if (args.length < 2) break;
    const indentMatch = (/^[ \t]*/.exec(target));
    const baseIndent = indentMatch ? indentMatch[0] : '';
    const argIndent = `${baseIndent}    `;
    const inner = args.map((arg) => `${argIndent}${arg},`).join('\n');
    const closeLine = `${baseIndent})`;
    const after = source.slice(closeAbs + 1).split('\n')[0];
    const replacement = `(\n${inner}\n${closeLine}${after}`;
    source = source.slice(0, openAbs) + replacement + source.slice(closeAbs + 1 + after.length);
  }
  return source;
}

function skipString(source, start) {
  const quote = source[start];
  const triple = source.slice(start, start + 3) === quote.repeat(3);
  let cursor = start + (triple ? 3 : 1);
  while (cursor < source.length) {
    if (source[cursor] === '\\') { cursor += 2; continue; }
    if (triple ? source.slice(cursor, cursor + 3) === quote.repeat(3) : source[cursor] === quote) {
      return cursor + (triple ? 3 : 1);
    }
    cursor += 1;
  }
  return source.length;
}

function matchParen(source, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = ['('];
  for (let cursor = open + 1; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (char === '"' || char === "'") { cursor = skipString(source, cursor) - 1; continue; }
    if (char === '#') {
      const newline = source.indexOf('\n', cursor);
      if (newline === -1) return -1;
      cursor = newline;
      continue;
    }
    if (pairs[char]) stack.push(char);
    else if (Object.values(pairs).includes(char)) {
      if (char !== pairs[stack.at(-1)]) return -1;
      stack.pop();
      if (stack.length === 0) return cursor;
    }
  }
  return -1;
}

function splitTopLevelArgs(source, open, close) {
  const args = [];
  const stack = [];
  let start = open + 1;
  for (let cursor = open + 1; cursor < close; cursor += 1) {
    const char = source[cursor];
    if (char === '"' || char === "'") { cursor = skipString(source, cursor) - 1; continue; }
    if (char === '#') {
      const newline = source.indexOf('\n', cursor);
      cursor = (newline === -1 || newline > close) ? close : newline;
      continue;
    }
    if ('([{'.includes(char)) stack.push(char);
    else if (')]}'.includes(char)) stack.pop();
    else if (char === ',' && stack.length === 0) {
      args.push(source.slice(start, cursor).trim());
      start = cursor + 1;
    }
  }
  const tail = source.slice(start, close).trim();
  if (tail !== '') args.push(tail);
  return args;
}

// ---------------------------------------------------------------------------
// Verbatim route: link resolution + bare-Notes qualification (§4.2-6/7)
// ---------------------------------------------------------------------------

const RELATIVE_LINK_RE = /\[([^\]]+)\]\(([^)]+?\.md)(#[^)\s]*)?\)/g;

function isRelativeLink(target) {
  return !/^(https?:)?\/\//i.test(target) && !target.startsWith('/');
}

function buildLinkResolver(snapshot) {
  const docLinkBySlug = new Map();
  for (const row of snapshot.rows || []) {
    if (row.slug && row.docLink && row.docLink.includes('/docx/') && !docLinkBySlug.has(row.slug)) {
      docLinkBySlug.set(row.slug, row.docLink);
    }
  }
  return function resolve(rawTarget, prPath) {
    let target = rawTarget;
    try { target = decodeURIComponent(rawTarget); } catch { /* keep raw */ }
    if (!isRelativeLink(target)) return rawTarget;
    const baseDir = prPath.split('/').slice(0, -1).join('/');
    const segments = [...baseDir.split('/'), ...target.split('/')];
    const resolved = [];
    for (const segment of segments) {
      if (!segment || segment === '.') continue;
      if (segment === '..') resolved.pop();
      else resolved.push(segment);
    }
    const trackIdx = resolved.findIndex((segment, index) =>
      /^v\d+\.\d+/.test(segment) || (index > 0 && /-sdk-/.test(resolved[index - 1])));
    if (trackIdx < 0) return null;
    const treeSegments = resolved.slice(trackIdx + 1);
    if (treeSegments.length === 0) return null;
    const fileName = treeSegments[treeSegments.length - 1];
    if (!fileName.endsWith('.md')) return null;
    const dirs = treeSegments.slice(0, -1);
    const symbol = fileName.slice(0, -3);
    const slugs = [];
    if (dirs.length > 0 && dirs[dirs.length - 1] === symbol) {
      // Class-page form: Collection/Collection.md -> v2-Collection,
      // Management/Index/Index.md -> v2-Management-Index.
      slugs.push(`v2-${dirs.join('-')}`);
    }
    slugs.push(`v2-${[...dirs, symbol].join('-')}`);
    for (const slug of slugs) {
      const link = docLinkBySlug.get(slug);
      if (link) return link;
    }
    return null;
  };
}

// Bare "## Notes" qualification: the KB layout contract never renders Notes as
// a bare heading; qualify it with the page's leaf word so the section keeps
// its wording without impersonating the renderer's reserved Notes section
// (go v2-Collection-Schema precedent: "## Notes" -> "## Notes on schema
// behavior").
function qualifyBareNotes(pageText, slug) {
  const lines = pageText.split(/\r?\n/);
  const leafWord = (slug.split('-').pop() || 'page').toLowerCase();
  const adjustments = [];
  const out = lines.map((line) => {
    if (/^#{0,3}\s*notes:?\s*$/i.test(line.trim())) {
      const level = (line.match(/^#+/) || ['#'])[0];
      const to = `${level} Notes on ${leafWord} behavior`;
      adjustments.push({ from: line.trim(), to });
      return to;
    }
    return line;
  });
  return { text: out.join('\n'), adjustments };
}

function prepareVerbatimContent(pageText, { slug, prPath, resolveLink }) {
  const { text: qualified, adjustments } = qualifyBareNotes(pageText, slug);
  let linksResolved = 0;
  const linksDeLinked = [];
  const content = qualified.replace(RELATIVE_LINK_RE, (full, linkText, rawTarget, anchor = '') => {
    let decoded = rawTarget;
    try { decoded = decodeURIComponent(rawTarget); } catch { /* keep raw */ }
    if (!isRelativeLink(decoded)) return full;
    const url = resolveLink(rawTarget, prPath);
    if (url) {
      linksResolved += 1;
      return `[${linkText}](${url}${anchor})`;
    }
    // Sanctioned degradation (resolveRelativeLinks onUnresolved:'de-link'),
    // recorded per unit.
    linksDeLinked.push({ slug, target: rawTarget, page: prPath });
    return linkText;
  });
  return { content, adjustments, linksResolved, linksDeLinked };
}

// ---------------------------------------------------------------------------
// Planning evidence (shared by both routes; go/java/node/python precedents)
// ---------------------------------------------------------------------------

function parentsOfRow(row) {
  if (!row || !row.parent) return [];
  try {
    const parsed = JSON.parse(row.parent);
    const first = Array.isArray(parsed) ? parsed[0] : null;
    return (first && first.record_ids) || [];
  } catch {
    return [];
  }
}

function deriveTableId(snapshot) {
  for (const row of snapshot.rows || []) {
    try {
      const parsed = JSON.parse(row.parent || 'null');
      const first = Array.isArray(parsed) ? parsed[0] : null;
      if (first && first.table_id) return first.table_id;
    } catch { /* keep scanning */ }
  }
  return null;
}

function existingRecordFor({ decision, auditEntry, rowByRecordId }) {
  const existing = decision.existingBitable || {};
  const row = existing.recordId ? rowByRecordId.get(existing.recordId) : null;
  const placement = auditEntry.placement;
  const parents = auditEntry.parentRecordId ? [auditEntry.parentRecordId] : parentsOfRow(row);
  return {
    recordId: existing.recordId,
    documentToken: existing.currentDocumentToken,
    recordType: row ? row.type : (existing.currentType || existing.rowType || null),
    parentRecordId: parents[0] || null,
    parentRecordIds: parents,
    placement: {
      verified: true,
      version: placement.version,
      folderToken: placement.folderToken,
      versionRootToken: placement.versionRootToken,
    },
  };
}

function copySourceNeeded({ existingRecord, track, targetFolderToken }) {
  if (!existingRecord) return false;
  if (existingRecord.referencedByOlderVersions === true) return true;
  if (existingRecord.placement.version !== track) return true;
  if (targetFolderToken && existingRecord.placement.folderToken !== targetFolderToken) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Sweep (§8.3): offline versioned-tree-policy precheck
// ---------------------------------------------------------------------------

function isCloneIdSharedInPlace(evidence) {
  if (!evidence || evidence.sharedToken?.status !== 'shared') return false;
  const multiset = normalizeReferenceMultiset(evidence.sharedToken.referencedRecordIds || []);
  const own = evidence.current?.recordId;
  if (!own) return false;
  return multiset.filter((recordId) => recordId === own).length > 1;
}

function sweepSpec(spec, { evaluateVersionedTreeDelta }) {
  const version = spec.target?.version;
  const versionRootToken = spec.target?.versionRootToken;
  if (!version || !versionRootToken) {
    reject('SWEEP_SPEC_INVALID', 'candidate spec target.version / target.versionRootToken are required for the sweep');
  }
  const counts = {};
  const blocked = [];
  let ancestryDeclared = 0;
  let ancestrySwept = 0;
  for (const [slug, candidate] of Object.entries(spec.candidates || {})) {
    const actionType = candidate.reviewedActionType || candidate.actionIntent || 'UPDATE';
    if (!candidate.existingRecord || actionType === 'CREATE' || actionType === 'BACKFILL') continue; // absent-record units ride FEISHU_RECORD_ABSENT
    ancestrySwept += 1;
    // Review P2-2: ancestryVerified used to be hardcoded true — the sweep
    // claimed TARGET_ANCESTRY facts it never saw. The spec's own declared
    // value passes through (candidate.ancestryVerified, falling back to the
    // existing-record face); units that do not declare it sweep with false,
    // and the report says the TARGET_ANCESTRY family is not covered.
    const ancestryVerified = candidate.ancestryVerified === true
      || candidate.existingRecord.ancestryVerified === true;
    if (ancestryVerified) ancestryDeclared += 1;
    const current = {
      version: candidate.existingRecord.placement.version,
      recordId: candidate.existingRecord.recordId,
      documentToken: candidate.existingRecord.documentToken,
      folderToken: candidate.existingRecord.placement.folderToken,
      ancestryVerified,
    };
    const target = candidate.folderRef
      ? { version, folderRef: candidate.folderRef, versionRootToken }
      : { version, folderToken: candidate.folderToken, versionRootToken };
    // Planner-equivalent fact: the builder folds spec.folderAncestry into the
    // planning target for walk-bound copy placements.
    if (Array.isArray(candidate.folderAncestry)) target.folderAncestry = candidate.folderAncestry;
    const evidence = candidate.inheritanceEvidence || null;
    const sharedUpdateReviews = joinSharedUpdateReviews({
      identity: { stableId: candidate.docIdentity?.stableId || slug },
      evidence,
      inheritanceReview: candidate.inheritanceReview,
    });
    const verdict = evaluateVersionedTreeDelta({
      operation: 'UPDATE',
      stableId: candidate.docIdentity?.stableId || slug,
      sourceDiff: 'changed',
      inheritanceEvidence: evidence,
      current,
      target,
      category: candidate.treeDelta ? candidate.treeDelta.category : null,
      sharedUpdateReviews: sharedUpdateReviews ?? null,
    });
    const key = verdict.status === 'blocked' ? `BLOCKED:${verdict.blocker}` : verdict.decision;
    counts[key] = (counts[key] || 0) + 1;
    if (verdict.status === 'blocked') {
      blocked.push({
        slug,
        stableId: candidate.docIdentity?.stableId || slug,
        blocker: verdict.blocker,
        cloneIdSharedInPlace: isCloneIdSharedInPlace(evidence),
        detail: String(verdict.detail || '').slice(0, 200),
      });
    }
  }
  return {
    units: Object.keys(spec.candidates || {}).length,
    counts,
    blocked,
    // Review P2-2: honest coverage face for the TARGET_ANCESTRY family.
    targetAncestryCoverage: ancestrySwept === 0
      ? 'not-applicable (no sweepable UPDATE units)'
      : (ancestryDeclared === ancestrySwept
        ? `declared for all ${ancestryDeclared} swept unit(s)`
        : `not declared — only ${ancestryDeclared}/${ancestrySwept} swept unit(s) declare ancestryVerified; TARGET_ANCESTRY blockers are outside this sweep's verified facts`),
  };
}

// ---------------------------------------------------------------------------
// Audit-proposal derivation (§4.1: --audit-proposal may be omitted)
// ---------------------------------------------------------------------------

function auditProposalFromInputs({ decisions, walk, audit, reject }) {
  // Port of the 2026-10-15 go build-audit-proposal.js: UPDATE units bind the
  // LIVE parent folder of their existing docx per the walk (authoritative);
  // absent units bind their family folder by walk name.
  // Without a walk (java/python chain precedent): fall back to the decisions'
  // own targetFolderToken bindings, then to the placement audit's per-entry
  // targetFolderToken; absent units then need a walk or an explicit
  // --audit-proposal (family folders cannot be derived without one).
  const auditFolderByStableId = new Map((audit?.entries || [])
    .filter((entry) => entry.targetFolderToken || entry.placement?.folderToken)
    .map((entry) => [entry.stableId, entry.targetFolderToken || entry.placement?.folderToken]));
  const folderForUnit = (unit) => unit.decision.docIdentity.targetFolderToken
    || auditFolderByStableId.get(unit.sourceStableId)
    || null;
  if (!walk) {
    const missingFolders = decisions.units
      .filter((unit) => !folderForUnit(unit)
        && unit.decision.existingBitable?.status === 'present')
      .map((unit) => unit.sourceStableId);
    if (missingFolders.length > 0) {
      reject('AUDIT_PROPOSAL_REQUIRED', `no root walk and no --audit-proposal: ${missingFolders.length} present unit(s) carry no decisions/audit targetFolderToken (e.g. ${missingFolders.slice(0, 5).join(', ')})`);
    }
    const absentWithoutWalk = decisions.units
      .filter((unit) => unit.decision.existingBitable?.status !== 'present');
    if (absentWithoutWalk.length > 0) {
      reject('AUDIT_PROPOSAL_REQUIRED', `no root walk: ${absentWithoutWalk.length} absent unit(s) cannot derive their family folder — pass --audit-proposal or --root-walk (e.g. ${absentWithoutWalk.slice(0, 5).map((u) => u.sourceStableId).join(', ')})`);
    }
    return {
      schemaVersion: 1,
      proposals: decisions.units
        .filter((unit) => unit.decision.existingBitable?.status === 'present')
        .map((unit) => ({
          id: unit.id,
          docIdentity: {
            stableId: unit.sourceStableId,
            canonicalSlug: unit.decision.docIdentity.canonicalSlug,
            title: unit.decision.docIdentity.title,
            targetFolderToken: folderForUnit(unit),
          },
        })),
      absentUnits: [],
      notes: ['derived from decisions/audit targetFolderToken (no root walk provided)'],
      derived: true,
      writesPerformed: false,
    };
  }
  const folderByName = new Map(walk.nodes.filter((node) => node.type === 'folder').map((node) => [node.name, node]));
  const folderByToken = new Map(walk.nodes.filter((node) => node.type === 'folder').map((node) => [node.token, node]));
  const familyFolderToken = (canonicalSlug) => {
    const familyWord = canonicalSlug.split('-').slice(1, -1).pop() || canonicalSlug.split('-')[1];
    const byName = folderByName.get(familyWord)
      || [...folderByName.values()].find((folder) => folder.name.toLowerCase() === familyWord.toLowerCase());
    if (!byName) reject('FAMILY_FOLDER_UNRESOLVED', `no walk folder for family ${familyWord} (${canonicalSlug})`);
    return byName.token;
  };
  const proposals = [];
  const notes = [];
  for (const unit of decisions.units) {
    const identity = unit.decision.docIdentity;
    const existing = unit.decision.existingBitable || {};
    if (existing.status !== 'present') continue;
    const docNode = existing.currentDocumentToken
      ? walk.nodes.find((node) => node.token === existing.currentDocumentToken)
      : null;
    let targetFolderToken;
    if (docNode) {
      if (docNode.parentFolderToken === walk.rootToken) {
        reject('AUDIT_PROPOSAL_UNRESOLVABLE', `UPDATE unit ${identity.canonicalSlug} docx sits directly in the version root (no family folder)`);
      }
      if (!folderByToken.has(docNode.parentFolderToken)) {
        reject('AUDIT_PROPOSAL_UNRESOLVABLE', `UPDATE unit ${identity.canonicalSlug} docx parent ${docNode.parentFolderToken} is not a walk folder`);
      }
      targetFolderToken = docNode.parentFolderToken;
    } else {
      targetFolderToken = familyFolderToken(identity.canonicalSlug);
      notes.push(`${identity.canonicalSlug}: docx absent from the walk (inherited; target folder bound by family name ${folderByToken.get(targetFolderToken)?.name})`);
    }
    proposals.push({
      id: unit.id,
      docIdentity: {
        stableId: unit.sourceStableId,
        canonicalSlug: identity.canonicalSlug,
        title: identity.title,
        targetFolderToken,
      },
    });
  }
  return {
    schemaVersion: 1,
    proposals,
    absentUnits: decisions.units
      .filter((unit) => unit.decision.existingBitable?.status !== 'present')
      .map((unit) => ({
        id: unit.id,
        canonicalSlug: unit.decision.docIdentity.canonicalSlug,
        actionIntent: unit.actionIntent,
        targetFolderToken: familyFolderToken(unit.decision.docIdentity.canonicalSlug),
      })),
    notes,
    derived: true,
    writesPerformed: false,
  };
}

function scannerOrphanSlugs(releaseScope) {
  const slugs = new Set();
  for (const diagnostic of releaseScope.scannerDiagnostics || []) {
    if (diagnostic.code !== 'PR_SYMBOL_FALLBACK_BIND') continue;
    const match = String(diagnostic.message || '').match(/^(\S+\.md): /);
    if (match) slugs.add(match[1].split('/').pop().replace(/\.md$/, ''));
  }
  return slugs;
}

// Split a Request Syntax fence into include-marker variants (java profile).
function splitIncludeVariants(fenceText, includeMarkers) {
  const lines = fenceText.split('\n');
  const segments = [];
  let current = null;
  const markerNames = includeMarkers.map((marker) => ({ marker, name: marker.replace(/^include-start\s+/, '') }));
  for (const line of lines) {
    const matched = markerNames.find(({ marker }) => line.includes(marker));
    if (matched) {
      current = { name: matched.name, lines: [] };
      segments.push(current);
      continue;
    }
    if (/include-end/.test(line)) { current = null; continue; }
    if (current) current.lines.push(line);
  }
  return segments
    .map((segment) => ({
      name: segment.name,
      firstLine: segment.lines.map((l) => l.trim()).filter(Boolean)[0] || '',
    }))
    .filter((segment) => segment.firstLine !== '');
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

function compose(args) {
  const language = args.language;
  const { profile, profileVersion } = loadProfile(language);
  const track = args.track;
  const effectiveRoute = args.route || profile.route;
  if (effectiveRoute !== 'verbatim' && effectiveRoute !== 'structured') {
    reject('ROUTE_INVALID', `--route must be verbatim|structured (got ${effectiveRoute})`);
  }

  const scopePath = requireFile(args, 'releaseScope', 'of-record release scope');
  const decisionsPath = requireFile(args, 'decisions', 'intake decisions');
  const pagesDir = requireFile(args, 'pagesDir', 'PR page dump directory');
  const snapshotPath = requireFile(args, 'snapshot', 'Bitable snapshot');
  const auditPath = requireFile(args, 'placementAudit', 'placement audit');
  const walkPath = args.rootWalk ? requireFile(args, 'rootWalk', 'version-root walk') : null;
  const identityMapPath = requireFile(args, 'identityMap', 'identity map');

  const releaseScope = readJson(scopePath);
  const scopeValidation = validateReleaseScope(releaseScope);
  if (!scopeValidation.valid) {
    reject('RELEASE_SCOPE_INVALID', `release scope failed validateReleaseScope: ${JSON.stringify(scopeValidation.errors.slice(0, 4))}`);
  }
  if (releaseScope.language !== language || releaseScope.track !== track) {
    reject('TRACK_LANGUAGE_MISMATCH', `release scope is ${releaseScope.language}/${releaseScope.track}; composer asked for ${language}/${track}`);
  }
  const decisions = readJson(decisionsPath);
  if (!Array.isArray(decisions.units) || decisions.units.length === 0) {
    reject('DECISIONS_INVALID', 'decisions.units[] is empty or missing — the review semantic payload is the composer\'s identity source');
  }
  const units = decisions.units;
  const audit = readJson(auditPath);
  const snapshot = readJson(snapshotPath);
  const walk = walkPath ? readJson(walkPath) : null;
  const identityMap = readJson(identityMapPath);
  const auditProposal = args.auditProposal
    ? readJson(args.auditProposal)
    : auditProposalFromInputs({ decisions, walk, audit, reject });

  if (identityMap.language !== language || identityMap.track !== track) {
    reject('IDENTITY_MAP_TRACK_MISMATCH', `identity map is ${identityMap.language}/${identityMap.track}; expected ${language}/${track}`);
  }
  // Review P1-3 ruling: the audit-level gate is the OVERALL readiness face
  // only. The 2026-10-15 audit producer computes inheritanceEvidenceStatus
  // per-set ('evidence_complete' | 'evidence_blocked') independently of
  // status, so a placement_audit_ready audit can honestly carry partial
  // per-entry evidence; the per-entry logic below owns that case — an entry
  // whose live placement folder IS the target re-mints its evidence
  // (mintedEvidence ledger), anything else is a typed
  // INHERITANCE_EVIDENCE_MISSING. Rejecting those audits up front made the
  // mint branch unreachable.
  if (audit.status !== 'placement_audit_ready') {
    reject('PLACEMENT_AUDIT_NOT_READY', `placement audit ${path.basename(auditPath)} is not ready (status ${audit.status})`);
  }

  const repository = args.repository
    || (releaseScope.actions.find((action) => action.source?.repository) || {}).source?.repository
    || releaseScope.sdkName;
  const baseToken = args.baseToken || snapshot.baseToken || null;
  const tableId = args.tableId || deriveTableId(snapshot);
  const successorTrack = args.successorTrack || null;

  const scopeBySlug = new Map(releaseScope.actions.map((action) => [action.canonicalSlug, action]));
  const auditByStableId = new Map((audit.entries || []).map((entry) => [entry.stableId, entry]));
  const targetFolderByStableId = new Map(auditProposal.proposals.map((p) => [p.docIdentity.stableId, p.docIdentity.targetFolderToken]));
  const absentFolderBySlug = new Map((auditProposal.absentUnits || []).map((u) => [u.canonicalSlug, u.targetFolderToken]));
  const rowByRecordId = new Map((snapshot.rows || []).map((row) => [row.recordId, row]));
  const resolveLink = buildLinkResolver(snapshot);
  const orphanSlugs = effectiveRoute === 'structured' ? scannerOrphanSlugs(releaseScope) : new Set();
  const isPython = Boolean(profile.normalizations);
  const pythonExampleStyle = isPython && profile.structured?.exampleCallReflow
    ? require('../src/sdk-reference-ir/python-example-style')
    : null;

  const WALK_DIGEST = audit.walkDigest;
  const COLLECTED_AT = audit.collectedAt;
  const VERSION_ROOT = audit.versionRootToken;

  const prEv = (pr) => ({ kind: 'pr', locator: pr.path, revision: pr.revision, confidence: 'reviewed' });
  const srcEv = (source) => ({
    kind: 'source', locator: `${source.file}:${source.line}`, revision: source.revision, confidence: 'reviewed',
  });

  const candidates = {};
  const composerNotes = [];
  const exceptions = [];
  const contentAdjustments = [];
  const linkStats = { resolved: 0, deLinked: 0, deLinkedUnits: new Set() };
  const identityCoverage = { mapped: 0, unmapped: [] };
  const parseStats = { bulletForms: {}, tailModifiers: { required: 0, default: 0 }, sections: {}, pages: 0, routes: { verbatim: 0, structured: 0 } };
  const verbatimOverlay = {};
  const absentUnits = [];
  const mintedEvidence = [];

  let sharedCount = 0;
  let inheritedCount = 0;

  // dump-pr-pages manifest cross-check face (review P2-4): present only when
  // the dump was produced by the canonical dumper; absence (older dumps)
  // skips the check silently.
  const manifestBySlug = fs.existsSync(path.join(pagesDir, 'manifest.json'))
    ? new Map((readJson(path.join(pagesDir, 'manifest.json')).pages || [])
      .filter((page) => page && page.slug)
      .map((page) => [page.slug, page]))
    : null;
  const manifestH1Drift = [];

  for (const unit of units) {
    const decision = unit.decision;
    const identity = decision.docIdentity;
    const existing = decision.existingBitable || {};
    const pr = decision.pr;
    const slug = identity.canonicalSlug;
    const scopeAction = scopeBySlug.get(slug)
      || releaseScope.actions.find((action) => action.stableId === unit.sourceStableId);
    if (!scopeAction) reject('SCOPE_ACTION_MISSING', `${unit.sourceStableId}: no release-scope action for ${slug}`);

    // identity map coverage (report-only: decisions are the binding authority)
    const identityKey = unit.sourceStableId.split(':').slice(1).join('.');
    if (identityMap.symbols && identityMap.symbols[identityKey]) identityCoverage.mapped += 1;
    else identityCoverage.unmapped.push(unit.sourceStableId);

    // PR pin gate (review P1-4): decisions are the binding authority for
    // provenance. A unit without a decision.pr.path pin has no reviewed
    // PR page to verify against — typed rejection, never an upstream
    // fallback to unreviewed sources.
    if (!pr || !pr.path) {
      reject(REJECTION_CODES.PR_PIN_MISSING, `${slug}: decisions carry no decision.pr.path pin (decision.pr ${pr ? 'has no path' : 'is absent'}); the composer does not fall back to unreviewed provenance`);
    }

    // page dump + sha gate (§4.1-3, fail-closed)
    const pagePath = path.join(pagesDir, `${slug}.md`);
    if (!fs.existsSync(pagePath)) reject('PAGE_DUMP_MISSING', `${slug}: no page dump at ${pagePath}`);
    const pageText = fs.readFileSync(pagePath, 'utf8');
    const actualSha = sha256(pageText);
    // A missing or malformed digest is its own typed rejection (review
    // P1-4): the old `if (pr.pageSha256 && ...)` silently skipped the
    // verification when the pin was absent.
    if (!pr.pageSha256 || !/^[0-9a-f]{64}$/.test(String(pr.pageSha256))) {
      reject(REJECTION_CODES.PAGE_DIGEST_REQUIRED, `${slug}: decision.pr.pageSha256 is missing or not a 64-hex digest (${JSON.stringify(pr.pageSha256 ?? null)}); refuse the unverified page (${pr.path})`);
    }
    if (actualSha !== pr.pageSha256) {
      reject(REJECTION_CODES.PAGE_DUMP_DIGEST_MISMATCH, `${slug}: page dump sha256 ${actualSha} != decisions.pr.pageSha256 ${pr.pageSha256} (${pr.path})`);
    }
    // Byte-length cross-check (review P2-9): the decisions record the pinned
    // page's byte length next to its digest. When the pin is present it must
    // match the dump — a disagreement means the bytes under review are not
    // the bytes on disk (e.g. an export re-encoding), so the page is refused
    // instead of composed with self-contradicting provenance. Older
    // decisions without pageBytes skip the check.
    if (pr.pageBytes != null && Number(pr.pageBytes) !== Buffer.byteLength(pageText, 'utf8')) {
      reject(REJECTION_CODES.PAGE_DUMP_BYTES_MISMATCH, `${slug}: page dump is ${Buffer.byteLength(pageText, 'utf8')} bytes but decisions.pr.pageBytes recorded ${pr.pageBytes} (${pr.path})`);
    }

    // per-unit route: scanner-taxonomy orphans on the structured route fall
    // back to verbatim (§4.4 fallback bridge, node 8-unit precedent).
    const unitRoute = effectiveRoute === 'structured' && orphanSlugs.has(slug)
      ? 'verbatim'
      : effectiveRoute;
    parseStats.routes[unitRoute] += 1;

    const row = existing.recordId ? rowByRecordId.get(existing.recordId) : null;
    // Computed once and shared by parsePage's register decision and the
    // candidate kind (review P2-9: the expression used to be duplicated).
    const isTypePage = Boolean(row && row.type !== 'Function') || !/\(\)$/.test(identity.title);
    const parsed = parsePage(pageText, { ...profile, route: unitRoute }, pagePath, { isTypePage });
    // Dumper manifest cross-check (review P2-4): when the pages dir carries
    // dump-pr-pages' manifest.json, its H1 face must agree with the parsed
    // title — disagreement is upstream identity drift, reported per unit in
    // composerNotes (report-only: the digest gate already owns byte truth).
    if (manifestBySlug) {
      const manifestPage = manifestBySlug.get(slug);
      if (manifestPage && manifestPage.h1 && manifestPage.h1 !== parsed.title) {
        manifestH1Drift.push(`${slug}: manifest H1 ${JSON.stringify(manifestPage.h1)} != parsed title ${JSON.stringify(parsed.title)}`);
      }
    }
    parseStats.pages += 1;
    for (const [form, count] of Object.entries(parsed.stats.bulletForms)) {
      parseStats.bulletForms[form] = (parseStats.bulletForms[form] || 0) + count;
    }
    for (const [key, count] of Object.entries(parsed.stats.tailModifiers)) {
      parseStats.tailModifiers[key] += count;
    }
    for (const [key, hit] of Object.entries(parsed.stats.sections)) {
      parseStats.sections[key] = (parseStats.sections[key] || 0) + (hit ? 1 : 0);
    }

    const sidCategory = unit.sourceStableId.split(':')[1];
    const isCreateLike = unit.actionIntent === 'CREATE' || unit.actionIntent === 'BACKFILL';
    const structuredSymbol = unit.sourceStableId.split(':').slice(2).join(':');
    const symbol = unitRoute === 'verbatim' ? scopeAction.symbol : structuredSymbol;

    const candidate = {
      docIdentity: {
        category: sidCategory,
        stableId: unit.sourceStableId,
        canonicalSlug: slug,
        symbol,
        title: identity.title,
      },
      category: sidCategory,
      kind: profile.kindRule === 'method' ? 'method' : (isTypePage ? 'class' : 'method'),
      symbol,
      title: unitRoute === 'verbatim' ? identity.title : (parsed.title || identity.title),
      // structured route serves the summary through the reference-IR plain
      // register (java/node precedent); verbatim keeps the page register.
      summary: unitRoute === 'verbatim'
        ? parsed.summary
        : (profile.structured && profile.structured.ensureSentences
          ? ensureSentence(plainText(parsed.summary))
          : plainText(parsed.summary)),
      summaryCallouts: unitRoute === 'verbatim' ? [] : parsed.summaryCallouts,
      examples: [],
      notes: [],
      reasons: unitRoute === 'verbatim'
        ? [
          scopeAction.reason || 'pr-doc-update',
          `PR #${pr.number} ${pr.changeType} ${pr.path} @ ${pr.revision.slice(0, 7)} (page sha256 ${pr.pageSha256.slice(0, 12)}, ${pr.pageBytes} bytes)`,
        ]
        : [scopeAction.reason || 'pr-doc-update'],
      reviewedActionType: unit.actionIntent,
      placementWalk: { digest: WALK_DIGEST, collectedAt: COLLECTED_AT },
      treeDelta: null,
      dependencies: [],
    };

    if (unitRoute === 'verbatim') {
      // summary + example satisfy the builder + strict registers; the page
      // bytes ride the verbatim overlay (applied onto the reference context by
      // --patch-context, §4.4).
      let exampleCode = null;
      if (parsed.exampleFences.length > 0) {
        exampleCode = parsed.exampleFences[0];
      } else if (profile.exampleFallbackFirstSignatureFence !== false && parsed.signatureFences.length > 0) {
        exampleCode = parsed.signatureFences[0].trim(); // type-page precedent
      }
      if (!exampleCode) reject('EXAMPLE_FENCE_MISSING', `${slug}: no example fence and no ${profile.signatureFenceLang} fence on the page`);
      candidate.examples = [{
        title: `${identity.title.replace(/\(\)$/, '')} example`,
        description: '',
        audience: 'shared',
        language: profile.exampleFenceLang,
        code: exampleCode,
        evidence: [prEv(pr)],
      }];
      candidate.sourceVariants = [{
        stableId: unit.sourceStableId,
        canonicalSlug: slug,
        symbol: scopeAction.symbol,
        source: {
          file: scopeAction.source.file,
          line: scopeAction.source.line,
          repository: scopeAction.source.repository,
          revision: scopeAction.source.revision,
        },
        reason: scopeAction.reason,
        evidence: [prEv(pr), srcEv(scopeAction.source)],
      }];
      candidate.styleMirrors = [];
      const prepared = prepareVerbatimContent(pageText, { slug, prPath: pr.path, resolveLink });
      contentAdjustments.push(...prepared.adjustments.map((adjustment) => ({ slug, ...adjustment, reason: 'bareNotesSectionForbidden intake gate; section content unchanged' })));
      linkStats.resolved += prepared.linksResolved;
      linkStats.deLinked += prepared.linksDeLinked.length;
      for (const deLink of prepared.linksDeLinked) linkStats.deLinkedUnits.add(`${deLink.slug}: ${deLink.target}`);
      verbatimOverlay[unit.sourceStableId] = {
        canonicalSlug: slug,
        verbatimContent: prepared.content,
        pr: {
          number: pr.number,
          path: pr.path,
          changeType: pr.changeType,
          revision: pr.revision,
          verifyTier: pr.verifyTier,
          pageBytes: pr.pageBytes,
          pageSha256: pr.pageSha256,
        },
      };
    } else {
      // structured route (java/node/python template, §4.4)
      const structured = profile.structured || {};
      let params = parsed.params.map((entry) => toField(entry, profile));
      const dedupeNotes = [];
      if (structured.dedupeRepeatedParams) {
        const seen = new Set();
        const deduped = [];
        for (const field of params) {
          if (seen.has(field.name)) { dedupeNotes.push(field.name); continue; }
          seen.add(field.name);
          deduped.push(field);
        }
        params = deduped;
      }
      if (isPython) {
        params = params.map((field) => {
          let shaped = pythonFoldChildren(field); // N1
          if (!shaped.description && /^kwargs$/.test(shaped.name) && profile.normalizations.N5) {
            shaped = { ...shaped, description: structured.kwargsFallbackDescription }; // N5
          }
          if (profile.normalizations.N2) {
            shaped = { ...shaped, description: normalizePythonStart(shaped.description) }; // N2/N3/N4
          }
          return shaped;
        });
      }
      candidate.params = params;
      if (parsed.signature) candidate.signature = parsed.signature;

      // request variants: include-marker split (java) or single variant
      const requestClass = parsed.signature
        ? ((parsed.signature.match(new RegExp(profile.requestClassFromSignature || '\\((\\w+Req) \\w+\\)')) || [])[1] || null)
        : null;
      const includeMarkers = profile.includeMarkers || [];
      const fenceHasIncludeMarkers = parsed.requestFenceText
        && includeMarkers.some((marker) => parsed.requestFenceText.includes(marker));
      let requestVariants = [];
      if (fenceHasIncludeMarkers && structured.requestVariantsFromIncludeMarkers) {
        requestVariants = splitIncludeVariants(parsed.requestFenceText, includeMarkers).map((segment) => ({
          id: segment.name,
          title: segment.name,
          description: plainText(parsed.requestIntro),
          signature: segment.firstLine,
          inputs: params,
        }));
      } else {
        let requestDisplay = parsed.requestDisplay;
        if (requestDisplay && structured.requestDisplayStripAwaitPrefix) {
          requestDisplay = requestDisplay.replace(/^await\s+/, '').replace(/\s+/g, ' ').trim();
        }
        if (!requestDisplay && params.length > 0 && requestClass) {
          requestDisplay = `${unit.sourceStableId.split(':').pop()}(${requestClass}.builder()`;
        }
        requestVariants = requestDisplay
          ? [{
            id: requestClass || 'request',
            title: requestClass || '',
            description: plainText(parsed.requestIntro),
            signature: requestDisplay,
            inputs: params,
          }]
          : [];
      }
      candidate.requestVariants = requestVariants;

      // result
      const resultType = profile.returnsTypeInline
        ? (parsed.returnsTypeLine || structured.resultFallbackType || 'void')
        : parsed.returnType;
      const resultDescription = structured.ensureSentences
        ? ensureSentence(plainText(parsed.returnsDescription))
        : plainText(parsed.returnsDescription);
      const result = {
        type: resultType || null,
        description: resultDescription || (structured.resultFallbackDescription
          ? structured.resultFallbackDescription.replace('{symbol}', candidate.symbol)
          : ''),
      };
      if (profile.returnsSchemaFence && parsed.returnsSchemaFence) result.schemaCode = parsed.returnsSchemaFence;
      if (parsed.getters.length > 0) result.fields = parsed.getters.map(getterToField);
      candidate.result = result;

      // exceptions
      const exceptionDefaults = structured.exceptionDefaults || {};
      candidate.exceptions = parsed.exceptions.map((entry) => ({
        name: entry.name,
        condition: entry.description || exceptionDefaults.condition || 'Raised when the server rejects the request or the RPC fails.',
        description: entry.description || exceptionDefaults.description || 'Inspect the server error message for the exact failure reason.',
      }));

      // examples
      let exampleCodes = parsed.exampleFences;
      if (structured.exampleMinCodeLength) {
        exampleCodes = exampleCodes.filter((code) => code.length >= structured.exampleMinCodeLength);
      }
      if (exampleCodes.length === 0 && structured.exampleFallbackFirstPageFence && parsed.signatureFences.length > 0) {
        exampleCodes = [parsed.signatureFences[0]];
      }
      if (isPython && pythonExampleStyle) {
        exampleCodes = exampleCodes.map((code) => reflowPythonCalls(code, pythonExampleStyle)); // N6
      }
      if (exampleCodes.length === 0) {
        reject('EXAMPLE_FENCE_MISSING', `${slug}: no example fence on a structured-route page`);
      }
      candidate.examples = exampleCodes.map((code, index) => ({
        title: `${candidate.symbol} example${exampleCodes.length > 1 ? ` ${index + 1}` : ''}`,
        description: index === 0 ? plainText(parsed.exampleIntro) : '',
        audience: 'shared',
        language: profile.exampleFenceLang,
        code,
      }));
      candidate.reviewedEvidence = scopeAction.evidence || [];
      if (dedupeNotes.length > 0) {
        candidate.summaryNormalizations = [
          `repeated PARAMETERS entries folded to their first occurrence (union-typed page lists one field per request shape): ${[...new Set(dedupeNotes)].join(', ')}`,
        ];
      }
    }

    // ---- placement / record evidence (both routes) ----
    if (isCreateLike) {
      const anchorRecordId = identity.anchorRecordId;
      if (!anchorRecordId) reject('ANCHOR_RECORD_MISSING', `absent unit ${slug} has no docIdentity.anchorRecordId in decisions`);
      absentUnits.push({ slug, actionIntent: unit.actionIntent, anchorRecordId });
      candidate.existingRecordLookup = {
        checked: true,
        absent: true,
        baseToken,
        tableId,
        parentRecordId: anchorRecordId,
        criteria: { canonicalSlugs: [slug], title: identity.title },
      };
      const absentFolder = absentFolderBySlug.get(slug);
      if (!absentFolder) reject('TARGET_FOLDER_MISSING', `${slug}: absent unit has no audit-proposal family folder`);
      candidate.folderToken = absentFolder;
      if (successorTrack) {
        // Create-like units carry the same successor review as updates (go
        // BACKFILL precedent).
        candidate.inheritanceReview = {
          reviewed: true,
          successors: [{
            track: successorTrack,
            status: unitRoute === 'verbatim' ? 'inherited' : 'not_applicable',
            decision: 'no_successor_action',
          }],
        };
      }
    } else {
      const auditEntry = auditByStableId.get(unit.sourceStableId);
      if (!auditEntry) reject('AUDIT_ENTRY_MISSING', `${unit.sourceStableId}: no placement-audit entry`);
      const placement = auditEntry.placement;
      if (placement.verified !== true) reject('PLACEMENT_UNVERIFIED', `${slug}: placement unverified in the audit`);
      const targetFolderToken = targetFolderByStableId.get(unit.sourceStableId) || identity.targetFolderToken
        || (targetFolderByStableId.size === 0 && !walk ? placement.folderToken : null);
      if (!targetFolderToken) {
        reject('TARGET_FOLDER_MISSING', `${slug}: no target folder token (audit proposal + decisions.docIdentity.targetFolderToken both empty)`);
      }
      const shared = auditEntry.sharedToken.status === 'shared';
      if (shared) sharedCount += 1;
      if (placement.version !== track) inheritedCount += 1;
      const existingRecord = existingRecordFor({ decision, auditEntry, rowByRecordId });
      candidate.existingRecord = existingRecord;
      if (auditEntry.inheritanceEvidence) {
        candidate.inheritanceEvidence = auditEntry.inheritanceEvidence;
      } else if (targetFolderToken === placement.folderToken) {
        // Re-mint against this campaign's target when the audit's own target
        // binding was unverified but the live placement folder IS the target
        // (python v30 5-unit precedent: in-place re-bind, node mintEvidence
        // precedent). Anything else stays a typed rejection.
        const { createInheritanceEvidence } = require('../src/sdk-doc-sync/inheritance-evidence');
        candidate.inheritanceEvidence = createInheritanceEvidence({
          stableId: unit.sourceStableId,
          current: {
            recordId: existingRecord.recordId,
            documentToken: existingRecord.documentToken,
            version: placement.version,
            folderToken: placement.folderToken,
            versionRootToken: placement.versionRootToken,
            ancestryVerified: true,
            placementVerified: true,
          },
          target: {
            version: track,
            folderToken: targetFolderToken,
            folderRef: null,
            versionRootToken: VERSION_ROOT,
            ancestryVerified: true,
          },
          sharedTokenStatus: auditEntry.sharedToken.status,
          referencedRecordIds: auditEntry.sharedToken.referencedRecordIds,
          trackInventoryDigests: audit.trackInventoryDigests,
          collectedAt: audit.collectedAt,
        });
        mintedEvidence.push(unit.sourceStableId);
      } else {
        reject('INHERITANCE_EVIDENCE_MISSING', `${unit.sourceStableId}: no audit inheritance evidence and the target folder differs from the live placement (folder-ref create contracts are decisions-level adjudications, not composer derivations)`);
      }
      if (copySourceNeeded({ existingRecord: { ...existingRecord, referencedByOlderVersions: shared }, track, targetFolderToken })) {
        candidate.copySource = {
          documentToken: existingRecord.documentToken,
          link: `https://zilliverse.feishu.cn/docx/${existingRecord.documentToken}`,
          title: row ? row.title : identity.title,
          placement: {
            versionRootToken: placement.versionRootToken,
            folderToken: placement.folderToken,
          },
        };
      }
      candidate.folderToken = targetFolderToken;
      if (unitRoute === 'structured') {
        candidate.folderAncestry = audit.folderChains ? audit.folderChains[targetFolderToken] || null : null;
        // Review P2-2 passthrough face: a folder chain from the audited walk
        // is the declared ancestry fact; verbatim-route specs stay undeclared
        // and the sweep report says the TARGET_ANCESTRY family is not covered.
        candidate.ancestryVerified = candidate.folderAncestry != null;
        candidate.parentRecordId = existingRecord.parentRecordId;
      }
      candidate.dependencies = [];

      // inheritance review: required successor track (CLI data input) +
      // pointing-record attribution for every OTHER referencing record.
      const successors = [];
      const requiredTracks = successorTrack ? [successorTrack] : [];
      const pointingByTrack = new Map();
      if (shared) {
        for (const reference of auditEntry.sharedToken.references || []) {
          if (reference.recordId === auditEntry.recordId) continue;
          const list = pointingByTrack.get(reference.version) || [];
          if (!list.includes(reference.recordId)) list.push(reference.recordId);
          pointingByTrack.set(reference.version, list);
        }
      }
      for (const requiredTrackValue of requiredTracks) {
        const pointing = pointingByTrack.get(requiredTrackValue) || [];
        successors.push({
          track: requiredTrackValue,
          // verbatim route (go precedent): the successor inherits the
          // pre-campaign state -> 'inherited'; structured route (java
          // precedent): the sibling fork is independent -> 'not_applicable'.
          status: unitRoute === 'verbatim' ? 'inherited' : 'not_applicable',
          decision: 'no_successor_action',
          ...(pointing.length > 0 ? { pointingRecordIds: pointing } : {}),
        });
        pointingByTrack.delete(requiredTrackValue);
      }
      for (const [pointingTrack, pointing] of pointingByTrack) {
        successors.push({
          track: pointingTrack,
          status: 'inherited',
          decision: 'no_successor_action',
          pointingRecordIds: pointing,
        });
      }
      if (successors.length > 0) {
        candidate.inheritanceReview = {
          reviewed: true,
          successors: successors.sort((a, b) => (a.track < b.track ? -1 : 1)),
        };
      }
    }

    if (!candidate.folderToken && !candidate.folderRef && !candidate.existingRecordLookup) {
      reject('TARGET_FOLDER_MISSING', `${slug}: no folder token, folder ref, or absent-record lookup`);
    }
    candidates[slug] = candidate;
  }

  // ---- exception queue (§7) ----
  // SCANNER_TAXONOMY_ORPHAN always reports (it drives the per-unit verbatim
  // fallback switch); CLONE_ID_SHARED_IN_PLACE and FEISHU_RECORD_ABSENT are
  // sweep products (--sweep) so a gate-bound compose keeps an empty queue when
  // the wave has none (design §10.2).
  if (effectiveRoute === 'structured' && orphanSlugs.size > 0) {
    const orphanUnits = units
      .filter((unit) => orphanSlugs.has(unit.decision.docIdentity.canonicalSlug))
      .map((unit) => unit.decision.docIdentity.canonicalSlug);
    if (orphanUnits.length > 0) {
      exceptions.push({
        code: EXCEPTION_CODES.SCANNER_TAXONOMY_ORPHAN,
        units: orphanUnits,
        evidence: EXCEPTION_REASON[EXCEPTION_CODES.SCANNER_TAXONOMY_ORPHAN].evidence,
        prefill: orphanUnits.map((orphanSlug) => ({ canonicalSlug: orphanSlug, ...EXCEPTION_REASON[EXCEPTION_CODES.SCANNER_TAXONOMY_ORPHAN].prefill })),
        dispositionNote: EXCEPTION_REASON[EXCEPTION_CODES.SCANNER_TAXONOMY_ORPHAN].dispositionNote,
        disposition: EXCEPTION_REASON[EXCEPTION_CODES.SCANNER_TAXONOMY_ORPHAN].disposition,
      });
    }
  }

  // ---- sweep (§8.3, optional) ----
  let sweepReport = null;
  if (args.sweep) {
    const { evaluateVersionedTreeDelta } = require('../src/sdk-doc-sync/versioned-tree-policy');
    sweepReport = sweepSpec({ target: { version: track, versionRootToken: VERSION_ROOT }, candidates }, { evaluateVersionedTreeDelta });
    const cloneUnits = sweepReport.blocked.filter((entry) => entry.cloneIdSharedInPlace).map((entry) => entry.slug);
    const otherBlocked = sweepReport.blocked.filter((entry) => !entry.cloneIdSharedInPlace);
    if (cloneUnits.length > 0) {
      exceptions.push({
        code: EXCEPTION_CODES.CLONE_ID_SHARED_IN_PLACE,
        units: cloneUnits,
        evidence: EXCEPTION_REASON[EXCEPTION_CODES.CLONE_ID_SHARED_IN_PLACE].evidence,
        prefill: {
          ...EXCEPTION_REASON[EXCEPTION_CODES.CLONE_ID_SHARED_IN_PLACE].prefill,
          blockedDetail: sweepReport.blocked.filter((entry) => entry.cloneIdSharedInPlace).map((entry) => ({ slug: entry.slug, blocker: entry.blocker })),
        },
        disposition: EXCEPTION_REASON[EXCEPTION_CODES.CLONE_ID_SHARED_IN_PLACE].disposition,
      });
    }
    if (absentUnits.length > 0) {
      exceptions.push({
        code: EXCEPTION_CODES.FEISHU_RECORD_ABSENT,
        units: absentUnits.map((unit) => unit.slug),
        evidence: EXCEPTION_REASON[EXCEPTION_CODES.FEISHU_RECORD_ABSENT].evidence,
        prefill: absentUnits.map((unit) => ({
          canonicalSlug: unit.slug,
          actionIntent: unit.actionIntent,
          anchorRecordId: unit.anchorRecordId,
          existingRecordLookup: candidates[unit.slug].existingRecordLookup,
        })),
        dispositionNote: EXCEPTION_REASON[EXCEPTION_CODES.FEISHU_RECORD_ABSENT].prefillNote,
        disposition: EXCEPTION_REASON[EXCEPTION_CODES.FEISHU_RECORD_ABSENT].disposition,
      });
    }
    if (otherBlocked.length > 0) {
      composerNotes.push(`sweep: ${otherBlocked.length} unit(s) blocked by non-clone blockers: ${otherBlocked.map((entry) => `${entry.slug}:${entry.blocker}`).join(', ')}`);
    }
    composerNotes.push(`sweep verdict counts: ${JSON.stringify(sweepReport.counts)} over ${sweepReport.units} sweepable UPDATE units.`);
  }

  // ---- target folders ----
  // With a root walk: the walk's root-level folders {name: token} (go
  // precedent). Without one (java chain precedent — the audit carries the
  // folder chains): {category: targetFolderToken} from the audited entries.
  const folders = {};
  if (walk) {
    for (const node of walk.nodes) {
      if (node.type === 'folder' && node.parentFolderToken === walk.rootToken) {
        folders[node.name] = node.token;
      }
    }
  } else {
    for (const entry of audit.entries || []) {
      const entryCategory = entry.stableId.split(':')[1];
      if (entry.targetFolderToken && !folders[entryCategory]) folders[entryCategory] = entry.targetFolderToken;
    }
  }

  // ---- coverage report (§4.5-3: template-drift signal) ----
  const bulletTotal = Object.values(parseStats.bulletForms).reduce((sum, count) => sum + count, 0);
  composerNotes.unshift(
    `walkDigest ${WALK_DIGEST} (collectedAt ${COLLECTED_AT}); ${audit.entries.length} audited UPDATE entries, ${sharedCount} shared, ${inheritedCount} inherited-placement.`,
  );
  composerNotes.push(
    `profile ${language} v${profileVersion} route ${effectiveRoute} (per-unit: ${parseStats.routes.verbatim} verbatim / ${parseStats.routes.structured} structured); parsed ${parseStats.pages} pages; bullet forms hit ${JSON.stringify(parseStats.bulletForms)} (total ${bulletTotal}); tail modifiers ${JSON.stringify(parseStats.tailModifiers)}; section hits ${JSON.stringify(parseStats.sections)}.`,
    `identity map coverage: ${identityCoverage.mapped}/${units.length} units mapped${identityCoverage.unmapped.length > 0 ? ` (unmapped: ${identityCoverage.unmapped.join(', ')})` : ''}.`,
  );
  if (mintedEvidence.length > 0) {
    composerNotes.push(`inheritance evidence minted in-place for ${mintedEvidence.length} unit(s) whose live placement folder IS the target (audit evidence absent, re-bind precedent): ${mintedEvidence.join(', ')}.`);
  }
  if (manifestH1Drift.length > 0) {
    composerNotes.push(`dumper manifest H1 drift (${manifestH1Drift.length} unit(s); manifest.json h1 != parsed title): ${manifestH1Drift.join('; ')}.`);
  }
  if (effectiveRoute === 'structured' && orphanSlugs.size > 0) {
    composerNotes.push(`SCANNER_TAXONOMY_ORPHAN: ${orphanSlugs.size} scope slug(s) matched PR_SYMBOL_FALLBACK_BIND diagnostics; affected units were switched to the verbatim fallback route (design §4.4).`);
  }
  if (linkStats.resolved > 0 || linkStats.deLinked > 0) {
    composerNotes.push(`verbatim overlay: ${Object.keys(verbatimOverlay).length} entries; links resolved ${linkStats.resolved}, de-linked ${linkStats.deLinked}${linkStats.deLinkedUnits.size > 0 ? ` (${[...linkStats.deLinkedUnits].slice(0, 10).join('; ')})` : ''}; content adjustments ${contentAdjustments.length}.`);
  }

  const targetBlock = {
    version: track,
    versionRootToken: VERSION_ROOT,
    folders,
    resources: [],
  };
  if (profile.structured?.releasePlacement) {
    // java precedent: the release-root placement review rides the target
    // (actual root == configured release folder, verified by the audit walk).
    targetBlock.releasePlacement = {
      configuredRootKind: 'release_folder',
      configuredRootToken: VERSION_ROOT,
      actualReleaseFolderToken: VERSION_ROOT,
      actualReleaseFolderName: track,
      targetVersion: track,
      verified: true,
    };
  }
  const spec = {
    language,
    track,
    repository,
    defaults: { language },
    notes: [],
    placementWalk: { digest: WALK_DIGEST, collectedAt: COLLECTED_AT },
    target: targetBlock,
    organizations: [],
    composerNotes,
    exceptions,
    contentAdjustments,
    candidates,
  };
  if (successorTrack) {
    spec.inheritance = { requiredSuccessorTracks: [successorTrack] };
  }
  // The verbatim overlay rides the spec (downstream-inert extra key) so
  // --patch-context can apply it onto the reference context deterministically.
  if (Object.keys(verbatimOverlay).length > 0) {
    spec.verbatimOverlay = verbatimOverlay;
  }

  return { spec, sweepReport, linkStats };
}

// ---------------------------------------------------------------------------
// Sweep-only mode (--sweep-spec)
// ---------------------------------------------------------------------------

function sweepOnly(args) {
  const specPath = requireFile(args, 'sweepSpec', 'candidate spec to sweep');
  const spec = readJson(specPath);
  const { evaluateVersionedTreeDelta } = require('../src/sdk-doc-sync/versioned-tree-policy');
  const report = sweepSpec(spec, { evaluateVersionedTreeDelta });
  const cloneUnits = report.blocked.filter((entry) => entry.cloneIdSharedInPlace).map((entry) => entry.slug);
  const exceptions = [];
  if (cloneUnits.length > 0) {
    exceptions.push({
      code: EXCEPTION_CODES.CLONE_ID_SHARED_IN_PLACE,
      units: cloneUnits,
      evidence: EXCEPTION_REASON[EXCEPTION_CODES.CLONE_ID_SHARED_IN_PLACE].evidence,
      prefill: EXCEPTION_REASON[EXCEPTION_CODES.CLONE_ID_SHARED_IN_PLACE].prefill,
      disposition: EXCEPTION_REASON[EXCEPTION_CODES.CLONE_ID_SHARED_IN_PLACE].disposition,
    });
  }
  const output = {
    sweptSpec: specPath,
    language: spec.language,
    track: spec.track,
    units: report.units,
    counts: report.counts,
    blocked: report.blocked,
    exceptions,
    // Batch 15 slice 3-3: the sweep consumes the builder's exported
    // joinSharedUpdateReviews directly — the same join the reviewed-context
    // build runs, with its SHARED_UPDATE_REVIEW_INVALID/AMBIGUOUS validations
    // live: a malformed attribution fails the sweep typed instead of silently
    // sweeping the unit unclassified.
    joinSharedUpdateReviewsVerification: 'builder-export reuse — joinSharedUpdateReviews is imported from build-reviewed-release-context.js; its SHARED_UPDATE_REVIEW_* validations apply to every swept shared unit (no read-only copy, no drift gap)',
    writesPerformed: false,
  };
  if (args.output) {
    fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    fs.writeFileSync(args.output, `${JSON.stringify(output, null, 2)}\n`);
  }
  console.log(JSON.stringify({
    sweptSpec: specPath,
    units: report.units,
    counts: report.counts,
    blocked: report.blocked.length,
    cloneIdUnits: cloneUnits.length,
    targetAncestryCoverage: report.targetAncestryCoverage,
    output: args.output || null,
  }, null, 2));
  return 0;
}

// ---------------------------------------------------------------------------
// Patch-context mode (--patch-context): verbatim overlay application (§4.4)
// ---------------------------------------------------------------------------

function patchContext(args) {
  const specPath = requireFile(args, 'candidateSpec', 'composed candidate spec (verbatim overlay source)');
  const contextPath = requireFile(args, 'patchContext', 'reference context to patch');
  const spec = readJson(specPath);
  const overlay = spec.verbatimOverlay || {};
  if (Object.keys(overlay).length === 0) {
    reject('VERBATIM_OVERLAY_EMPTY', `candidate spec ${path.basename(specPath)} carries no verbatimOverlay (compose with the verbatim route first)`);
  }
  const contextDoc = readJson(contextPath);
  const contexts = contextDoc.contexts || {};
  const report = {
    spec: specPath,
    context: contextPath,
    patchedEntries: 0,
    skippedEntries: [],
    // Review P2-9 rename: this counts ABSOLUTE links already present in the
    // patched verbatim bytes — a different metric from compose()'s
    // linkStats.resolved (relative links resolved against the snapshot).
    absoluteLinksPresent: 0,
    contentAdjustments: spec.contentAdjustments || [],
  };
  const patched = {};
  for (const [stableId, entry] of Object.entries(contexts)) {
    const overlayEntry = overlay[stableId];
    if (!overlayEntry) {
      // structured-route or non-verbatim entries pass through untouched
      report.skippedEntries.push(stableId);
      patched[stableId] = entry;
      continue;
    }
    entry.verbatimContent = overlayEntry.verbatimContent;
    entry.pr = { ...overlayEntry.pr };
    report.patchedEntries += 1;
    report.absoluteLinksPresent += countAbsoluteLinks(overlayEntry.verbatimContent);
    patched[stableId] = entry;
  }
  const missing = Object.keys(overlay).filter((stableId) => !contexts[stableId]);
  if (missing.length > 0) {
    reject('VERBATIM_OVERLAY_UNMATCHED', `${missing.length} overlay entries have no reference-context entry: ${missing.slice(0, 8).join(', ')}`);
  }
  contextDoc.contexts = patched;
  const outputPath = args.patchContextOutput || contextPath;
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(contextDoc, null, 2)}\n`);
  if (args.patchReport) {
    fs.mkdirSync(path.dirname(path.resolve(args.patchReport)), { recursive: true });
    fs.writeFileSync(args.patchReport, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify({
    context: outputPath,
    patchedEntries: report.patchedEntries,
    skippedEntries: report.skippedEntries.length,
    absoluteLinksPresent: report.absoluteLinksPresent,
    contentAdjustments: report.contentAdjustments.length,
    patchReport: args.patchReport || null,
  }, null, 2));
  return 0;
}

function countAbsoluteLinks(content) {
  let count = 0;
  for (const match of String(content).matchAll(/\]\((https?:\/\/[^)]+)\)/g)) count += 1;
  return count;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  if (args.patchContext) return patchContext(args);
  if (args.sweepSpec) return sweepOnly(args);
  if (!args.output) throw new Error('Missing required --output');
  const { spec, sweepReport } = compose(args);
  fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(spec, null, 2)}\n`);
  console.log(JSON.stringify({
    output: args.output,
    language: spec.language,
    track: spec.track,
    route: spec.verbatimOverlay ? 'verbatim(+overlay)' : 'structured',
    candidates: Object.keys(spec.candidates).length,
    createLike: Object.values(spec.candidates).filter((c) => c.existingRecordLookup).length,
    copySources: Object.values(spec.candidates).filter((c) => c.copySource).length,
    exceptions: spec.exceptions.map((entry) => `${entry.code}×${entry.units.length}`),
    walkDigest: spec.placementWalk.digest,
    ...(sweepReport ? { sweep: { units: sweepReport.units, blocked: sweepReport.blocked.length } } : {}),
  }, null, 2));
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv);
  } catch (error) {
    console.error(error.message);
    if (error.code) console.error(`code: ${error.code}`);
    process.exitCode = 1;
  }
}

module.exports = {
  EXCEPTION_CODES,
  buildLinkResolver,
  compose,
  deriveTableId,
  joinSharedUpdateReviews,
  main,
  normalizePythonStart,
  parseArgs,
  patchContext,
  prepareVerbatimContent,
  qualifyBareNotes,
  reflowPythonCalls,
  sweepOnly,
  sweepSpec,
};

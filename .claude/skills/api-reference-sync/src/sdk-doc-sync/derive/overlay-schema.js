'use strict';

// Executable authority for the overlay contract (rust-overlay-pilot §2.2/§2.3).
// Closed vocabulary, strict keys, fail-closed: any violation loads as a typed
// error and the derive refuses to run. The declarative mirror lives at
// overlay/schema/overlay.schema.json and changes in the same PR.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA_VERSION = 1;

const PAGE_KINDS = ['method', 'struct', 'enum', 'container', 'module', 'overview'];
const ANCHOR_KINDS = ['requestField', 'parameter', 'variant', 'method', 'section', 'prose'];
const ACTIONS = ['insert-before', 'insert-after', 'replace', 'remove', 'wrap-note'];
const SECTION_KEYS = [
  'request-syntax', 'request-fields', 'returns', 'example', 'parameters',
  'methods', 'variants', 'constructor', 'runtime-configuration', 'method-index',
];
const ANCHOR_BY_PAGE_KIND = Object.freeze({
  method: new Set(['requestField', 'section', 'prose']),
  struct: new Set(['parameter', 'method', 'section', 'prose']),
  enum: new Set(['variant', 'section', 'prose']),
  container: new Set(['section', 'prose']),
  module: new Set(['parameter', 'method', 'section', 'prose']),
  overview: new Set(['section', 'prose']),
});
const TARGETS_VALUES = ['shared', 'zilliz-only', 'milvus-only'];

const PAGE_IDENTITY_RE = /^[A-Za-z][\w]*(\.[A-Za-z][\w]*)*$/;
const ENTRY_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const IDENT_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function violation(errors, where, message) {
  errors.push({ code: 'OVERLAY_SCHEMA_VIOLATION', path: where, message });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Strict-key object check: rejects unknown fields instead of ignoring them.
function checkKeys(doc, allowed, where, errors) {
  if (!isPlainObject(doc)) {
    violation(errors, where, 'expected an object');
    return;
  }
  for (const key of Object.keys(doc)) {
    if (!allowed.includes(key)) violation(errors, `${where}.${key}`, 'unknown field');
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

// Content-shape checks (§2.3): inserted bullets must look like the position
// they land in, so a malformed patch fails at load, never mid-compile.
const FIELD_BULLET_RE = /^-\s+`[A-Za-z_][A-Za-z0-9_]*\s*:[^`]*`\s*$/m;
const VARIANT_BULLET_RE = /^-\s+`[A-Za-z_][A-Za-z0-9_]*`\s*$/m;
const METHOD_BULLET_RE = /^-\s+`[^`\n]+`\s*-\s*\S/m;
const NOTE_RE = /^>\s/m;

function checkContentShape(entry, where, errors) {
  if (!('content' in entry)) return;
  const content = entry.content;
  if (typeof content !== 'string') {
    violation(errors, `${where}.content`, 'must be a string');
    return;
  }
  if (entry.action === 'remove') {
    violation(errors, `${where}.content`, 'remove entries carry no content');
    return;
  }
  if (!content.trim()) {
    violation(errors, `${where}.content`, 'empty content');
    return;
  }
  const kind = entry.anchor.kind;
  const inserting = entry.action === 'insert-before' || entry.action === 'insert-after';
  if (inserting && (kind === 'requestField' || kind === 'parameter') && !FIELD_BULLET_RE.test(content)) {
    violation(errors, `${where}.content`, 'must start with a `- \\`name: Type\\`` bullet');
  }
  if (inserting && kind === 'variant' && !VARIANT_BULLET_RE.test(content)) {
    violation(errors, `${where}.content`, 'must start with a `- \\`Variant\\`` bullet');
  }
  if (inserting && kind === 'method' && !METHOD_BULLET_RE.test(content)) {
    violation(errors, `${where}.content`, 'must start with a compact `- \\`signature\\` - description` bullet');
  }
  if (entry.action === 'wrap-note' && !NOTE_RE.test(content)) {
    violation(errors, `${where}.content`, 'wrap-note content must be callout lines starting with "> "');
  }
}

function validatePatchEntries(doc, where, errors) {
  if (!isPlainObject(doc)) {
    violation(errors, where, 'expected an object');
    return;
  }
  checkKeys(doc, ['page', 'entries'], where, errors);
  if (!isPlainObject(doc)) return;
  const page = doc.page;
  if (!isNonEmptyString(page) || !PAGE_IDENTITY_RE.test(page)) {
    violation(errors, `${where}.page`, `invalid page identity: ${JSON.stringify(page)}`);
  }
  const entries = doc.entries;
  if (!Array.isArray(entries)) {
    violation(errors, `${where}.entries`, 'expected an array');
    return;
  }
  const seenIds = new Set();
  entries.forEach((entry, index) => {
    const entryWhere = `${where}.entries[${index}]`;
    checkKeys(entry, ['id', 'expect', 'anchor', 'action', 'content', 'targets', 'upstream-candidate', 'note'], entryWhere, errors);
    if (!isPlainObject(entry)) return;
    if (!isNonEmptyString(entry.id) || !ENTRY_ID_RE.test(entry.id)) {
      violation(errors, `${entryWhere}.id`, `invalid id: ${JSON.stringify(entry.id)}`);
    } else if (seenIds.has(entry.id)) {
      violation(errors, `${entryWhere}.id`, `duplicate id ${entry.id}`);
    } else {
      seenIds.add(entry.id);
    }
    if (!PAGE_KINDS.includes(entry.expect)) {
      violation(errors, `${entryWhere}.expect`, `unknown pageKind: ${JSON.stringify(entry.expect)}`);
    }
    const anchor = entry.anchor;
    checkKeys(anchor, ['kind', 'key', 'match', 'section'], `${entryWhere}.anchor`, errors);
    if (!isPlainObject(anchor)) return;
    if (!ANCHOR_KINDS.includes(anchor.kind)) {
      violation(errors, `${entryWhere}.anchor.kind`, `unknown anchor kind: ${JSON.stringify(anchor.kind)}`);
    } else {
      if (PAGE_KINDS.includes(entry.expect) && !ANCHOR_BY_PAGE_KIND[entry.expect].has(anchor.kind)) {
        violation(errors, `${entryWhere}.anchor.kind`, `anchor ${anchor.kind} is not legal for pageKind ${entry.expect}`);
      }
      if (anchor.kind === 'section') {
        if (!SECTION_KEYS.includes(anchor.section)) {
          violation(errors, `${entryWhere}.anchor.section`, `unknown section key: ${JSON.stringify(anchor.section)}`);
        }
      } else if (anchor.kind === 'prose') {
        if (!isNonEmptyString(anchor.match) || anchor.match.length < 8) {
          violation(errors, `${entryWhere}.anchor.match`, 'prose anchors need a match substring (>= 8 chars)');
        }
      } else if (!isNonEmptyString(anchor.key) || !IDENT_KEY_RE.test(anchor.key)) {
        violation(errors, `${entryWhere}.anchor.key`, `invalid identifier key: ${JSON.stringify(anchor.key)}`);
      }
    }
    if (!ACTIONS.includes(entry.action)) {
      violation(errors, `${entryWhere}.action`, `unknown action: ${JSON.stringify(entry.action)}`);
    }
    if (entry.action !== 'remove' && !isNonEmptyString(entry.content)) {
      violation(errors, `${entryWhere}.content`, `${entry.action} requires content`);
    }
    checkContentShape(entry, entryWhere, errors);
    if ('targets' in entry) {
      const targets = entry.targets;
      if (!Array.isArray(targets) || !targets.length || !targets.every((t) => t === 'zilliz' || t === 'milvus')) {
        violation(errors, `${entryWhere}.targets`, 'targets must be a non-empty array of "zilliz"/"milvus"');
      }
    }
    if ('upstream-candidate' in entry && typeof entry.upstreamCandidate !== 'boolean') {
      violation(errors, `${entryWhere}.upstream-candidate`, 'must be a boolean');
    }
  });
}

function validateRules(doc, where, errors) {
  checkKeys(doc, ['urlRewrites', 'terminology'], where, errors);
  if (!isPlainObject(doc)) return;
  for (const [listName, list] of [['urlRewrites', doc.urlRewrites], ['terminology', doc.terminology]]) {
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      violation(errors, `${where}.${listName}`, 'expected an array');
      continue;
    }
    list.forEach((item, index) => {
      const itemWhere = `${where}.${listName}[${index}]`;
      checkKeys(item, ['from', 'to', 'scope'], itemWhere, errors);
      if (!isPlainObject(item)) return;
      if (!isNonEmptyString(item.from)) violation(errors, `${itemWhere}.from`, 'must be a non-empty string');
      if (typeof item.to !== 'string') violation(errors, `${itemWhere}.to`, 'must be a string');
      if ('scope' in item && !['prose', 'all'].includes(item.scope)) {
        violation(errors, `${itemWhere}.scope`, 'scope must be "prose" or "all"');
      }
    });
  }
}

function validateTargets(doc, where, errors) {
  if (!Array.isArray(doc)) {
    violation(errors, where, 'expected an array');
    return;
  }
  doc.forEach((item, index) => {
    const itemWhere = `${where}[${index}]`;
    checkKeys(item, ['symbol', 'page', 'kind', 'targets', 'evidence', 'decidedAt'], itemWhere, errors);
    if (!isPlainObject(item)) return;
    if (!isNonEmptyString(item.symbol)) violation(errors, `${itemWhere}.symbol`, 'must be a non-empty string');
    if (!['param', 'page', 'variant'].includes(item.kind)) {
      violation(errors, `${itemWhere}.kind`, `kind must be param|page|variant, got ${JSON.stringify(item.kind)}`);
    }
    if (!TARGETS_VALUES.includes(item.targets)) {
      violation(errors, `${itemWhere}.targets`, `targets must be one of ${TARGETS_VALUES.join('|')}`);
    }
  });
}

// Load + validate the whole overlay tree for one track directory.
// Layout: manifest.json, rules.json, patches/*.json, targets.json, pages/**/*.md
function loadOverlayTree(overlayDir) {
  const errors = [];
  const dir = path.resolve(overlayDir);
  if (!fs.existsSync(dir)) {
    return { ok: false, errors: [{ code: 'OVERLAY_SCHEMA_VIOLATION', path: dir, message: 'overlay directory not found' }] };
  }
  const readJson = (name) => {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      violation(errors, name, `invalid JSON: ${error.message}`);
      return null;
    }
  };

  const manifest = readJson('manifest.json');
  if (manifest !== undefined) {
    checkKeys(manifest, ['schemaVersion', 'language', 'track'], 'manifest.json', errors);
    if (isPlainObject(manifest)) {
      if (manifest.schemaVersion !== SCHEMA_VERSION) violation(errors, 'manifest.json.schemaVersion', `must be ${SCHEMA_VERSION}`);
      if (!isNonEmptyString(manifest.language)) violation(errors, 'manifest.json.language', 'must be a non-empty string');
      if (!/^v\d+\.\d+\.x$/.test(String(manifest.track))) violation(errors, 'manifest.json.track', 'must look like v3.0.x');
    }
  } else {
    violation(errors, 'manifest.json', 'missing');
  }

  const rules = readJson('rules.json');
  if (rules === undefined) {
    violation(errors, 'rules.json', 'missing');
  } else if (rules !== null) {
    validateRules(rules, 'rules.json', errors);
  }

  const patches = [];
  const patchesDir = path.join(dir, 'patches');
  if (fs.existsSync(patchesDir)) {
    for (const file of fs.readdirSync(patchesDir).filter((name) => name.endsWith('.json')).sort()) {
      let doc;
      try {
        doc = JSON.parse(fs.readFileSync(path.join(patchesDir, file), 'utf8'));
      } catch (error) {
        violation(errors, `patches/${file}`, `invalid JSON: ${error.message}`);
        continue;
      }
      validatePatchEntries(doc, `patches/${file}`, errors);
      if (isPlainObject(doc)) patches.push({ source: `patches/${file}`, ...doc });
    }
  }

  const targets = readJson('targets.json');
  if (targets === undefined) {
    violation(errors, 'targets.json', 'missing');
  } else if (targets !== null) {
    validateTargets(targets, 'targets.json', errors);
  }

  const pages = [];
  const pagesDir = path.join(dir, 'pages');
  if (fs.existsSync(pagesDir)) {
    const walk = (sub) => {
      for (const entry of fs.readdirSync(path.join(pagesDir, sub), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const rel = sub ? `${sub}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(rel);
        else if (entry.name.endsWith('.md')) {
          const identity = rel.slice(0, -3).replace(/\//g, '.');
          pages.push({ identity, path: rel, content: fs.readFileSync(path.join(pagesDir, rel), 'utf8') });
        }
      }
    };
    walk('');
  }

  if (errors.length > 0) return { ok: false, errors };

  const tree = {
    schemaVersion: SCHEMA_VERSION,
    language: manifest.language,
    track: manifest.track,
    rules: rules || {},
    patches,
    targets: targets || [],
    pages,
  };
  tree.overlayDigest = crypto.createHash('sha256')
    .update(JSON.stringify({ ...tree, overlayDigest: undefined }))
    .digest('hex');
  return { ok: true, tree, errors: [] };
}

module.exports = {
  SCHEMA_VERSION,
  PAGE_KINDS,
  ANCHOR_KINDS,
  ACTIONS,
  SECTION_KEYS,
  ANCHOR_BY_PAGE_KIND,
  loadOverlayTree,
};

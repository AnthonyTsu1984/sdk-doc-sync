'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CLASSIFICATIONS = new Set([
  'read-only',
  'canonical-governed',
  'legacy-live',
  'test-only',
  'deprecated',
]);

const ENTRYPOINT_PATTERNS = [
  /^\.claude\/agent-team\/bin\/[^/]+\.js$/,
  /^\.claude\/skills\/[^/]+\/(?:bin|scripts)\/.*\.js$/,
  /^scripts\/[^/]+\.js$/,
];

const WRITE_SIGNATURES = [
  { pattern: /\bwriter\.updateRecord\s*\(/, evidence: 'writer.updateRecord' },
  { pattern: /\bwriter\.createRecord\s*\(/, evidence: 'writer.createRecord' },
  { pattern: /\bwriter\.deleteRecord\s*\(/, evidence: 'writer.deleteRecord' },
  { pattern: /\b(?:bitableWriter|recordWriter)\.(?:create|update|delete)Record\s*\(/, evidence: 'record-writer mutation' },
  { pattern: /\b(?:docWriter|documentWriter)\.(?:create|update|patch|delete)Document\s*\(/, evidence: 'document-writer mutation' },
  { pattern: /\b(?:driveWriter|wikiWriter)\.(?:create|update|move|delete)(?:Folder|Node|Document)\s*\(/, evidence: 'drive-writer mutation' },
  { pattern: /\.(?:appTableRecord|document|wikiNode)\.(?:create|update|patch|delete)\s*\(/, evidence: 'Feishu SDK mutation' },
  { pattern: /\blark-cli\b[^\n]{0,160}\b(?:create|update|patch|delete|move|copy)\b/, evidence: 'lark-cli mutation' },
];

function normalizePath(value) {
  return String(value).split(path.sep).join('/').replace(/^\.\//, '');
}

function walkJavaScriptFiles(root, directory, results) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walkJavaScriptFiles(root, absolute, results);
    else if (entry.isFile() && entry.name.endsWith('.js')) results.push(normalizePath(path.relative(root, absolute)));
  }
}

function discoverEntrypoints(repoRoot) {
  const root = path.resolve(repoRoot);
  const candidates = [];
  walkJavaScriptFiles(root, path.join(root, '.claude', 'agent-team', 'bin'), candidates);
  walkJavaScriptFiles(root, path.join(root, '.claude', 'skills'), candidates);
  walkJavaScriptFiles(root, path.join(root, 'scripts'), candidates);
  return [...new Set(candidates.filter((filePath) => ENTRYPOINT_PATTERNS.some((pattern) => pattern.test(filePath))))].sort();
}

function detectWriteCapability(source) {
  const evidence = WRITE_SIGNATURES
    .filter(({ pattern }) => pattern.test(String(source)))
    .map(({ evidence: label }) => label);
  return { writeCapable: evidence.length > 0, evidence };
}

function loadWriteEntrypointRegistry({ repoRoot, registryPath = null }) {
  const filePath = registryPath || path.join(repoRoot, '.claude', 'skills', 'doc-ops-core', 'write-entrypoints.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function repositoryFile(repoRoot, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) return null;
  const root = path.resolve(repoRoot);
  const absolute = path.resolve(root, relativePath);
  if (absolute === root || !absolute.startsWith(`${root}${path.sep}`)) return null;
  return fs.existsSync(absolute) && fs.statSync(absolute).isFile() ? absolute : null;
}

function validLegacyException(expectedChanges, entrypointPath, now) {
  const current = Date.parse(now);
  return expectedChanges.some((change) => (
    change?.entrypointPath === entrypointPath
    && Number.isFinite(Date.parse(change.expiresAt))
    && Date.parse(change.expiresAt) > current
  ));
}

function validateRegistryEntries({
  repoRoot,
  registry,
  discoveredPaths = discoverEntrypoints(repoRoot),
  expectedChanges = [],
  now = new Date().toISOString(),
}) {
  const errors = [];
  const entries = Array.isArray(registry?.entries) ? registry.entries : [];
  if (registry?.schemaVersion !== 1) errors.push({ code: 'ENTRYPOINT_REGISTRY_SCHEMA_INVALID', path: '$.schemaVersion' });
  if (!Array.isArray(registry?.entries)) errors.push({ code: 'ENTRYPOINT_REGISTRY_ENTRIES_REQUIRED', path: '$.entries' });
  const byPath = new Map();
  for (const [index, entry] of entries.entries()) {
    const entryPath = `$.entries[${index}]`;
    const normalized = normalizePath(entry?.path || '');
    if (!normalized || byPath.has(normalized)) {
      errors.push({ code: normalized ? 'ENTRYPOINT_PATH_DUPLICATE' : 'ENTRYPOINT_PATH_REQUIRED', path: `${entryPath}.path` });
      continue;
    }
    byPath.set(normalized, entry);
    const absolute = repositoryFile(repoRoot, normalized);
    if (!absolute) errors.push({ code: 'ENTRYPOINT_FILE_MISSING', path: `${entryPath}.path`, entrypointPath: normalized });
    if (!CLASSIFICATIONS.has(entry.classification)) {
      errors.push({ code: 'ENTRYPOINT_CLASSIFICATION_INVALID', path: `${entryPath}.classification`, entrypointPath: normalized });
      continue;
    }
    if (absolute) {
      const detection = detectWriteCapability(fs.readFileSync(absolute, 'utf8'));
      if (detection.writeCapable && entry.classification === 'read-only') {
        errors.push({ code: 'WRITE_CAPABILITY_MISCLASSIFIED', path: `${entryPath}.classification`, entrypointPath: normalized, evidence: detection.evidence });
      }
    }
    if (entry.classification === 'canonical-governed') {
      for (const field of ['skill', 'operation', 'approval', 'journal', 'reconciliation']) {
        if (typeof entry[field] !== 'string' || !entry[field]) {
          errors.push({ code: 'CANONICAL_ENTRYPOINT_FIELD_REQUIRED', path: `${entryPath}.${field}`, entrypointPath: normalized });
        }
      }
      if (!Array.isArray(entry.tests) || entry.tests.length === 0) {
        errors.push({ code: 'CANONICAL_ENTRYPOINT_TEST_REQUIRED', path: `${entryPath}.tests`, entrypointPath: normalized });
      } else {
        for (const testPath of entry.tests) {
          if (!repositoryFile(repoRoot, testPath)) {
            errors.push({ code: 'CANONICAL_ENTRYPOINT_TEST_MISSING', path: `${entryPath}.tests`, entrypointPath: normalized, testPath });
          }
        }
      }
    }
    if (entry.classification === 'legacy-live') {
      if (entry.quarantineFlag !== 'DOC_OPS_ALLOW_LEGACY_LIVE') {
        errors.push({ code: 'LEGACY_LIVE_QUARANTINE_REQUIRED', path: `${entryPath}.quarantineFlag`, entrypointPath: normalized });
      }
      if (typeof entry.canonicalReplacement !== 'string' || !entry.canonicalReplacement) {
        errors.push({ code: 'LEGACY_LIVE_REPLACEMENT_REQUIRED', path: `${entryPath}.canonicalReplacement`, entrypointPath: normalized });
      }
      if (entry.admittedAtBaseline !== true && !validLegacyException(expectedChanges, normalized, now)) {
        errors.push({ code: 'LEGACY_LIVE_EXCEPTION_REQUIRED', path: entryPath, entrypointPath: normalized });
      }
    }
    if (entry.classification === 'test-only' && entry.sandboxOnly !== true && !/(^|\/)tests?\//.test(normalized)) {
      errors.push({ code: 'TEST_ONLY_ENTRYPOINT_SCOPE_INVALID', path: entryPath, entrypointPath: normalized });
    }
  }
  for (const discoveredPath of discoveredPaths.map(normalizePath)) {
    if (!byPath.has(discoveredPath)) {
      errors.push({ code: 'ENTRYPOINT_UNREGISTERED', path: '$.entries', entrypointPath: discoveredPath });
    }
  }
  errors.sort((left, right) => left.code.localeCompare(right.code)
    || String(left.entrypointPath || '').localeCompare(String(right.entrypointPath || ''))
    || left.path.localeCompare(right.path));
  return { valid: errors.length === 0, errors };
}

function validateWriteEntrypointRegistry({ repoRoot = process.cwd(), now = new Date().toISOString() } = {}) {
  const registry = loadWriteEntrypointRegistry({ repoRoot });
  const expectedChangesPath = path.join(repoRoot, '.claude', 'skills', 'doc-ops-core', 'expected-changes.json');
  const expectedChanges = fs.existsSync(expectedChangesPath)
    ? JSON.parse(fs.readFileSync(expectedChangesPath, 'utf8'))
    : [];
  return validateRegistryEntries({ repoRoot, registry, expectedChanges, now });
}

module.exports = {
  CLASSIFICATIONS,
  detectWriteCapability,
  discoverEntrypoints,
  loadWriteEntrypointRegistry,
  validateRegistryEntries,
  validateWriteEntrypointRegistry,
};

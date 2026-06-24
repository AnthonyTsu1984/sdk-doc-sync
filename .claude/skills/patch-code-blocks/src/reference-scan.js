const fs = require('node:fs');
const path = require('node:path');

const VALID_STATUSES = new Set(['supported', 'missing', 'unclear']);

function normalizeEntry(entry) {
  const operationKey = String(entry.operationKey || '').trim();
  const language = String(entry.language || '').trim().toLowerCase();
  const rawStatus = String(entry.status || 'unclear').trim().toLowerCase();
  const status = VALID_STATUSES.has(rawStatus) ? rawStatus : 'unclear';

  if (!operationKey || !language) {
    return null;
  }

  return { operationKey, language, status };
}

function loadReferenceIndex(filePath) {
  let payload;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    payload = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to load reference index at ${filePath}: ${error.message}`, { cause: error });
  }

  const entries = Array.isArray(payload.entries)
    ? payload.entries.map(normalizeEntry).filter(Boolean)
    : [];

  return {
    entries,
    sourcePath: filePath,
  };
}

function buildMatrix(referenceIndex, options = {}) {
  const languages = Array.isArray(options.languages) ? options.languages : [];
  const entries = Array.isArray(referenceIndex?.entries) ? referenceIndex.entries : [];
  const matrix = {};
  const seenPairs = new Set();

  for (const entry of entries) {
    const pairKey = `${entry.operationKey}|${entry.language}`;
    if (seenPairs.has(pairKey)) {
      throw new Error(`Duplicate reference entry detected: ${pairKey}`);
    }
    seenPairs.add(pairKey);

    if (!matrix[entry.operationKey]) {
      matrix[entry.operationKey] = Object.fromEntries(languages.map((language) => [language, 'unclear']));
    }

    if (languages.includes(entry.language)) {
      matrix[entry.operationKey][entry.language] = entry.status;
    }
  }

  return matrix;
}

function resolveReferenceIndexPath(referenceRoot, product) {
  const candidates = [
    path.join(referenceRoot, 'reference-index.json'),
    path.join(referenceRoot, product, 'reference-index.json'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function loadReferenceIndexFromRoot(referenceRoot, product) {
  const indexPath = resolveReferenceIndexPath(referenceRoot, product);
  if (!indexPath) {
    return {
      entries: [],
      sourcePath: null,
    };
  }

  return loadReferenceIndex(indexPath);
}

module.exports = {
  buildMatrix,
  loadReferenceIndex,
  loadReferenceIndexFromRoot,
  resolveReferenceIndexPath,
};

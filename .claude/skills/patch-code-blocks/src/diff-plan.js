function buildCandidates(matrix) {
  const candidates = [];
  const operationKeys = Object.keys(matrix).sort();

  for (const operationKey of operationKeys) {
    const byLanguage = matrix[operationKey];
    const languages = Object.keys(byLanguage).sort();

    for (const language of languages) {
      if (byLanguage[language] === 'supported') {
        candidates.push({ operationKey, language });
      }
    }
  }

  return candidates;
}

function assertIdempotentCandidates(candidates) {
  const seen = new Set();

  for (const candidate of candidates) {
    const key = `${candidate.operationKey}|${candidate.language}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate candidate detected: ${key}`);
    }
    seen.add(key);
  }
}

const assertNoDuplicateCandidates = assertIdempotentCandidates;

module.exports = {
  buildCandidates,
  assertIdempotentCandidates,
  assertNoDuplicateCandidates,
};

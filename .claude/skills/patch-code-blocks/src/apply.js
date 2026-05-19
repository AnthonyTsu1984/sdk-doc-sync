const FEISHU_LABEL_MAP = {
  python: 'Python',
  java: 'Java',
  go: 'Go',
  node: 'JavaScript',
  rest: 'Bash',
  cli: 'Shell',
};

const LABEL_ALIASES = {
  python: new Set(['python']),
  java: new Set(['java']),
  go: new Set(['go', 'golang']),
  node: new Set(['javascript', 'js', 'node']),
  rest: new Set(['bash', 'http', 'rest', 'curl']),
  cli: new Set(['shell', 'zsh', 'sh', 'cli']),
};

function normalizeLabel(value) {
  return String(value || '').trim().toLowerCase();
}

function languageFromLabel(label) {
  const normalized = normalizeLabel(label);
  if (!normalized) {
    return null;
  }

  for (const [language, aliases] of Object.entries(LABEL_ALIASES)) {
    if (aliases.has(normalized)) {
      return language;
    }
  }

  return null;
}

function summarizeApplyResults(results = []) {
  const summary = {
    patched: 0,
    skipped: 0,
    failed: 0,
    unknown: 0,
  };

  for (const result of results) {
    if (result.status === 'patched') {
      summary.patched += 1;
    } else if (result.status === 'skipped') {
      summary.skipped += 1;
    } else if (result.status === 'failed') {
      summary.failed += 1;
    } else {
      summary.unknown += 1;
    }
  }

  return summary;
}

function findSectionByOperation(sections, operationKey) {
  return sections.find((section) => section.operationKey === operationKey) || null;
}

function findExistingBlock(section, language) {
  return (section.codeBlocks || []).find((block) => languageFromLabel(block.languageLabel) === language) || null;
}

function findInsertAnchor(section, language, orderIndex, fallbackLanguageOrder) {
  const ranked = fallbackLanguageOrder
    .map((lang, idx) => ({ language: lang, index: idx }))
    .filter((item) => item.index < orderIndex)
    .sort((a, b) => b.index - a.index);

  for (const candidate of ranked) {
    const existing = findExistingBlock(section, candidate.language);
    if (existing) {
      return { relation: 'after', blockId: existing.blockId };
    }
  }

  if (section.codeBlocks?.[0]?.blockId) {
    return { relation: 'before', blockId: section.codeBlocks[0].blockId };
  }

  return null;
}

function planApplyOperations({ sections = [], candidates = [], languageOrder = [] }) {
  const order = Array.isArray(languageOrder) && languageOrder.length > 0
    ? languageOrder
    : Object.keys(FEISHU_LABEL_MAP);

  const results = [];

  for (const candidate of candidates) {
    const targetLanguageLabel = FEISHU_LABEL_MAP[candidate.language] || 'Plain Text';
    const section = findSectionByOperation(sections, candidate.operationKey);

    if (!section) {
      results.push({
        status: 'skipped',
        reason: 'section_not_found',
        operationKey: candidate.operationKey,
        language: candidate.language,
        targetLanguageLabel,
      });
      continue;
    }

    const existingBlock = findExistingBlock(section, candidate.language);
    if (existingBlock) {
      results.push({
        status: 'patched',
        type: 'replace',
        operationKey: candidate.operationKey,
        language: candidate.language,
        sectionHeading: section.heading,
        blockId: existingBlock.blockId,
        targetLanguageLabel,
      });
      continue;
    }

    const orderIndex = order.indexOf(candidate.language);
    const anchor = findInsertAnchor(section, candidate.language, orderIndex === -1 ? order.length : orderIndex, order);

    if (!anchor) {
      results.push({
        status: 'failed',
        reason: 'insert_anchor_not_found',
        operationKey: candidate.operationKey,
        language: candidate.language,
        sectionHeading: section.heading,
        targetLanguageLabel,
      });
      continue;
    }

    const anchorField = anchor.relation === 'before' ? 'beforeBlockId' : 'afterBlockId';

    results.push({
      status: 'patched',
      type: 'insert',
      operationKey: candidate.operationKey,
      language: candidate.language,
      sectionHeading: section.heading,
      [anchorField]: anchor.blockId,
      targetLanguageLabel,
    });
  }

  return {
    results,
    summary: summarizeApplyResults(results),
  };
}

module.exports = {
  FEISHU_LABEL_MAP,
  planApplyOperations,
  summarizeApplyResults,
};

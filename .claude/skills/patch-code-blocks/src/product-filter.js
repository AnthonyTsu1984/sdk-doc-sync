function normalizeTarget(target) {
  const normalized = String(target || '').trim().toLowerCase();
  if (normalized === 'zilliz:saas') return 'zilliz-saas';
  if (normalized === 'zilliz:paas') return 'zilliz-paas';
  return normalized;
}

function parseTargets(text, directive) {
  const source = String(text || '');
  const pattern = new RegExp(`(?:\\\\<|\\|<|<)${directive}\\b[^>]*\\btarget\\s*=\\s*(["'])([^"']+)\\1`, 'gim');
  const targets = [];

  for (const match of source.matchAll(pattern)) {
    targets.push(normalizeTarget(match[2]));
  }

  return targets;
}

function shouldKeep(text, product) {
  const normalizedProduct = normalizeTarget(product);
  const includes = parseTargets(text, 'include');
  const excludes = parseTargets(text, 'exclude');

  if (excludes.includes(normalizedProduct)) {
    return false;
  }

  if (includes.length > 0 && !includes.includes(normalizedProduct)) {
    return false;
  }

  return true;
}

function filterSectionsForProduct(sections, product) {
  if (!Array.isArray(sections)) {
    return [];
  }

  return sections.filter((section) => {
    const directiveText = section.directiveText || section.heading || '';
    return shouldKeep(directiveText, product);
  });
}

module.exports = {
  normalizeTarget,
  shouldKeep,
  filterSectionsForProduct,
};

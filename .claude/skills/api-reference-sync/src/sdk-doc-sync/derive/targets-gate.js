'use strict';

// Targets gate (rust-overlay-pilot §2.2/批3): every request field / parameter /
// variant a compiled page declares must have a targets.json entry; unknown
// keys land on the artifact's mustAsk list so the write gate forces the
// shared-vs-zilliz-only question once, then the registry locks it.

const DECLARED_KEY_RE = /^-\s+`([A-Za-z_][A-Za-z0-9_]*)/;

function declaredKeysForPage(markdown) {
  const keys = [];
  let section = null;
  for (const line of markdown.split('\n')) {
    const bold = line.match(/^\*\*([A-Z][A-Z /]+):\*\*/);
    if (bold) { section = bold[1].trim(); continue; }
    if (line.startsWith('#')) { section = null; continue; }
    if (section === 'REQUEST FIELDS' || section === 'PARAMETERS' || section === 'VARIANTS') {
      if (/^-\s+`/.test(line)) {
        const m = line.match(DECLARED_KEY_RE);
        if (m) keys.push({ symbol: m[1], kind: section === 'VARIANTS' ? 'variant' : 'param' });
      }
    }
  }
  return keys;
}

function gateTargets({ pages, targets }) {
  const registered = new Set(targets.map((entry) => `${entry.kind}:${entry.symbol}`));
  const mustAsk = [];
  const seen = new Set();
  for (const page of pages) {
    for (const { symbol, kind } of declaredKeysForPage(page.markdown)) {
      const key = `${kind}:${symbol}`;
      if (registered.has(key) || seen.has(key)) continue;
      seen.add(key);
      mustAsk.push({ page: page.identity, symbol, kind });
    }
  }
  return {
    mustAsk,
    registered: registered.size,
    summary: mustAsk.length === 0
      ? 'all declared keys are registered in targets.json'
      : `${mustAsk.length} declared key(s) have no targets.json entry — the write gate must ask shared-vs-zilliz-only for each`,
  };
}

module.exports = { gateTargets, declaredKeysForPage };

'use strict';

// Target-side rewrites (§2 形态三): URL prefix maps apply everywhere;
// terminology with scope "prose" applies only outside code fences.

function splitFences(markdown) {
  const lines = markdown.split('\n');
  let inFence = false;
  return lines.map((line) => {
    const isDelimiter = /^\s*```/.test(line);
    let zone = 'prose';
    if (isDelimiter) {
      zone = 'fence';
      // The delimiter line itself is never rewritten; toggling happens around it.
      inFence = !inFence;
      return { line, zone: 'delimiter' };
    }
    zone = inFence ? 'fence' : 'prose';
    return { line, zone };
  });
}

function applyRules(markdown, rules) {
  const urlRewrites = (rules && rules.urlRewrites) || [];
  const terminology = (rules && rules.terminology) || [];
  let out = markdown;
  for (const { from, to } of urlRewrites) {
    out = out.split(from).join(to);
  }
  if (terminology.length > 0) {
    const zoned = splitFences(out).map(({ line, zone }) => {
      if (zone !== 'prose') return line;
      let rewritten = line;
      for (const { from, to, scope } of terminology) {
        if (scope === 'all') continue; // "all" was already handled on the raw text below
        rewritten = rewritten.split(from).join(to);
      }
      return rewritten;
    });
    out = zoned.join('\n');
    for (const { from, to, scope } of terminology) {
      if (scope === 'all') out = out.split(from).join(to);
    }
  }
  return out;
}

module.exports = { applyRules };

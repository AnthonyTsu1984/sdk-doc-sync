'use strict';

const { marked } = require('marked');

const { canonicalize } = require('../src/canonical-json');

const FIXTURE_COMMENT = /^\s*<!--\s*DOC_OPS_SYNTHETIC_FIXTURE_V\d+\s*-->\s*$/;
const LARK_IMPORT_TRANSPORT_SCHEMA_VERSION = 1;
const MAX_SEQUENCE_DIFF_CELLS = 1_000_000;
const MAX_SEQUENCE_DIFF_ITEMS = 10_000;

function decodeMarkerText(value) {
  return String(value || '').trim()
    .replace(/\\</g, '<')
    .replace(/\\>/g, '>')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function parseAudienceMarker(line) {
  const indentation = String(line || '').match(/^[ \t]*/)?.[0] || '';
  if (indentation.includes('\t') || indentation.length >= 4) return null;
  const decoded = decodeMarkerText(line);
  const opening = decoded.match(/^<(include|exclude)\s+target\s*=\s*(["'])([^"']+)\2\s*>$/i);
  if (opening) {
    return {
      closing: false,
      indentation,
      marker: opening[1].toLowerCase(),
      target: opening[3],
    };
  }
  const closing = decoded.match(/^<\/(include|exclude)\s*>$/i);
  if (closing) return { closing: true, indentation, marker: closing[1].toLowerCase() };
  return null;
}

function withoutFixtureComment(markdown) {
  const lines = String(markdown || '').split('\n');
  const firstContentIndex = lines.findIndex(line => line.trim() !== '');
  if (firstContentIndex >= 0 && FIXTURE_COMMENT.test(lines[firstContentIndex])) {
    lines[firstContentIndex] = '';
  }
  return lines.join('\n');
}

function openingFence(line) {
  const match = String(line || '').match(/^ {0,3}(`{3,}|~{3,})/);
  return match ? { character: match[1][0], length: match[1].length } : null;
}

function closesFence(line, fence) {
  const match = String(line || '').match(/^ {0,3}(`+|~+)[ \t]*$/);
  return Boolean(match)
    && match[1][0] === fence.character
    && match[1].length >= fence.length;
}

function findAudienceRegionClosing(lines, openingIndex, opening) {
  let fence = null;
  for (let index = openingIndex + 1; index < lines.length; index += 1) {
    if (fence) {
      if (closesFence(lines[index], fence)) fence = null;
      continue;
    }
    const openedFence = openingFence(lines[index]);
    if (openedFence) {
      fence = openedFence;
      continue;
    }
    const closing = parseAudienceMarker(lines[index]);
    if (closing?.closing && closing.marker === opening.marker) return index;
  }
  return -1;
}

function normalizeAudienceBody(body) {
  return String(body || '').replace(/[ \t]+$/u, '');
}

function extractAudienceRegions(markdown) {
  const lines = withoutFixtureComment(markdown).split('\n');
  const regions = [];
  const output = [];
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    if (fence) {
      output.push(lines[index]);
      if (closesFence(lines[index], fence)) fence = null;
      continue;
    }
    const openedFence = openingFence(lines[index]);
    if (openedFence) {
      fence = openedFence;
      output.push(lines[index]);
      continue;
    }
    const opening = parseAudienceMarker(lines[index]);
    if (!opening || opening.closing) {
      output.push(lines[index]);
      continue;
    }
    const closingIndex = findAudienceRegionClosing(lines, index, opening);
    if (closingIndex < 0) {
      output.push(lines[index]);
      continue;
    }
    const regionIndex = regions.length;
    const sentinel = `DOC_OPS_AUDIENCE_REGION_SENTINEL_${String(regionIndex).padStart(6, '0')}`;
    regions.push({
      body: normalizeAudienceBody(lines.slice(index + 1, closingIndex).join('\n')),
      indentation: opening.indentation.length,
      marker: opening.marker,
      sentinel,
      target: opening.target,
    });
    if (output.length > 0 && output.at(-1) !== '') output.push('');
    output.push(`${opening.indentation}${sentinel}`);
    output.push('');
    index = closingIndex;
  }
  return { markdown: output.join('\n'), regions };
}

function inlineLinks(tokens, blockIndex, output) {
  for (const token of tokens || []) {
    if (token.type === 'link') {
      output.push({
        blockIndex,
        destination: token.href,
        kind: 'link',
        label: token.text,
        title: token.title || null,
      });
    }
    inlineLinks(token.tokens, blockIndex, output);
  }
}

function inlineMarkdown(tokens) {
  return (tokens || [])
    .filter(token => token.type !== 'list' && token.type !== 'checkbox')
    .map(token => token.raw ?? token.text ?? '')
    .join('')
    .replace(/\n+$/g, '');
}

function inventoryMarkdown(markdown) {
  const extracted = extractAudienceRegions(markdown);
  const regionBySentinel = new Map(extracted.regions.map(region => [region.sentinel, region]));
  const blocks = [];
  const links = [];

  function addBlock(block, tokens = []) {
    const blockIndex = blocks.length;
    blocks.push(block);
    inlineLinks(tokens, blockIndex, links);
  }

  function regionForToken(token) {
    if (token?.type !== 'paragraph' && token?.type !== 'text') return null;
    return regionBySentinel.get(String(token.text || '').trim()) || null;
  }

  function addAudienceRegion(region, { listDepth, listPath }) {
    region.listDepth = listDepth;
    region.listPath = [...listPath];
    addBlock({
      body: region.body,
      kind: 'audience_region',
      listDepth,
      listPath: [...listPath],
      marker: region.marker,
      target: region.target,
    });
  }

  function visitList(token, depth = 0, parentPath = []) {
    const start = token.ordered === true ? Number(token.start ?? 1) : null;
    for (const [itemIndex, item] of (token.items || []).entries()) {
      const itemPath = [...parentPath, itemIndex];
      const contentTokens = (item.tokens || [])
        .filter(child => child.type !== 'list' && !regionForToken(child));
      addBlock({
        checked: item.task === true ? item.checked === true : null,
        depth,
        kind: 'list_item',
        ordinal: start === null ? null : start + itemIndex,
        ordered: token.ordered === true,
        start,
        task: item.task === true,
        text: inlineMarkdown(contentTokens),
      }, contentTokens);
      for (const child of item.tokens || []) {
        const region = regionForToken(child);
        if (region) addAudienceRegion(region, { listDepth: depth, listPath: itemPath });
        if (child.type === 'list') visitList(child, depth + 1, itemPath);
      }
    }
  }

  for (const token of marked.lexer(extracted.markdown)) {
    if (token.type === 'space') continue;
    if (token.type === 'paragraph' && regionBySentinel.has(token.text.trim())) {
      const region = regionBySentinel.get(token.text.trim());
      addAudienceRegion(region, { listDepth: null, listPath: [] });
      continue;
    }
    if (token.type === 'heading') {
      addBlock({ depth: token.depth, kind: 'heading', text: token.text }, token.tokens);
      continue;
    }
    if (token.type === 'paragraph' || token.type === 'text') {
      addBlock({ kind: 'paragraph', text: token.text }, token.tokens);
      continue;
    }
    if (token.type === 'code') {
      addBlock({ kind: 'code', language: token.lang || '', text: token.text });
      continue;
    }
    if (token.type === 'list') {
      visitList(token);
      continue;
    }
    if (token.type === 'table') {
      const blockIndex = blocks.length;
      const header = (token.header || []).map(cell => cell.text);
      const rows = (token.rows || []).map(row => row.map(cell => cell.text));
      blocks.push({ header, kind: 'table', rows });
      for (const cell of [...(token.header || []), ...(token.rows || []).flat()]) {
        inlineLinks(cell.tokens, blockIndex, links);
      }
      continue;
    }
    addBlock({
      kind: token.type || 'unknown',
      text: String(token.raw ?? token.text ?? '').replace(/\n$/g, ''),
    }, token.tokens);
  }

  return canonicalize({
    audienceRegions: extracted.regions.map(region => ({
      body: region.body,
      listDepth: region.listDepth ?? null,
      listPath: [...(region.listPath || [])],
      marker: region.marker,
      target: region.target,
    })),
    blocks,
    links,
    schemaVersion: 3,
  });
}

function comparableInventory(inventory, expected = null) {
  const value = {
    blocks: [...(inventory?.blocks || [])],
    links: [...(inventory?.links || [])],
  };
  const first = value.blocks[0];
  const expectedFirst = expected?.blocks?.[0];
  if (first?.kind === 'heading' && first.depth === 1
    && JSON.stringify(first) !== JSON.stringify(expectedFirst)) {
    value.blocks.shift();
    value.links = value.links
      .filter(link => link.blockIndex !== 0)
      .map(link => ({ ...link, blockIndex: link.blockIndex - 1 }));
  }
  return value;
}

function sequenceDiff(expected, observed) {
  const expectedKeys = expected.map(item => JSON.stringify(item));
  const observedKeys = observed.map(item => JSON.stringify(item));
  if (expectedKeys.length === observedKeys.length
    && expectedKeys.every((key, index) => key === observedKeys[index])) {
    return { limitExceeded: false, missing: [], unexpected: [] };
  }
  if (expected.length > MAX_SEQUENCE_DIFF_ITEMS || observed.length > MAX_SEQUENCE_DIFF_ITEMS) {
    return { limitExceeded: true, missing: [], unexpected: [] };
  }
  const rows = expected.length + 1;
  const columns = observed.length + 1;
  if (rows > Math.floor(MAX_SEQUENCE_DIFF_CELLS / columns)) {
    return { limitExceeded: true, missing: [], unexpected: [] };
  }
  const lengths = Array.from({ length: rows }, () => new Uint32Array(columns));
  for (let left = expected.length - 1; left >= 0; left -= 1) {
    for (let right = observed.length - 1; right >= 0; right -= 1) {
      lengths[left][right] = expectedKeys[left] === observedKeys[right]
        ? lengths[left + 1][right + 1] + 1
        : Math.max(lengths[left + 1][right], lengths[left][right + 1]);
    }
  }
  const missing = [];
  const unexpected = [];
  let left = 0;
  let right = 0;
  while (left < expected.length && right < observed.length) {
    if (expectedKeys[left] === observedKeys[right]) {
      left += 1;
      right += 1;
    } else if (lengths[left + 1][right] >= lengths[left][right + 1]) {
      missing.push(expected[left]);
      left += 1;
    } else {
      unexpected.push(observed[right]);
      right += 1;
    }
  }
  missing.push(...expected.slice(left));
  unexpected.push(...observed.slice(right));
  return { limitExceeded: false, missing, unexpected };
}

function compareMarkdownInventory(expectedInventory, observedInventory) {
  const expected = comparableInventory(expectedInventory);
  const observed = comparableInventory(observedInventory, expected);
  const blockDiff = sequenceDiff(expected.blocks, observed.blocks);
  const linkDiff = sequenceDiff(expected.links, observed.links);
  const missing = [...blockDiff.missing, ...linkDiff.missing];
  const unexpected = [...blockDiff.unexpected, ...linkDiff.unexpected];
  const limitExceeded = blockDiff.limitExceeded || linkDiff.limitExceeded;
  return canonicalize({
    limitExceeded: limitExceeded ? {
      blocks: blockDiff.limitExceeded,
      links: linkDiff.limitExceeded,
      maxCells: MAX_SEQUENCE_DIFF_CELLS,
      maxItems: MAX_SEQUENCE_DIFF_ITEMS,
    } : undefined,
    missing,
    ok: !limitExceeded && missing.length === 0 && unexpected.length === 0,
    unexpected,
  });
}

function encodeAudienceMarker(line) {
  const marker = parseAudienceMarker(line);
  if (!marker) return line;
  if (marker.closing) return `${marker.indentation}&lt;/${marker.marker}&gt;`;
  return `${marker.indentation}&lt;${marker.marker} target="${marker.target}"&gt;`;
}

function prepareMarkdownForLarkImport(markdown) {
  const lines = String(markdown || '').split('\n');
  const output = [...lines];
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    if (fence) {
      if (closesFence(lines[index], fence)) fence = null;
      continue;
    }
    const openedFence = openingFence(lines[index]);
    if (openedFence) {
      fence = openedFence;
      continue;
    }
    const opening = parseAudienceMarker(lines[index]);
    if (!opening || opening.closing) continue;
    const closingIndex = findAudienceRegionClosing(lines, index, opening);
    if (closingIndex < 0) continue;
    output[index] = encodeAudienceMarker(lines[index]);
    output[closingIndex] = encodeAudienceMarker(lines[closingIndex]);
    index = closingIndex;
  }
  return output.join('\n');
}

module.exports = {
  LARK_IMPORT_TRANSPORT_SCHEMA_VERSION,
  compareMarkdownInventory,
  inventoryMarkdown,
  prepareMarkdownForLarkImport,
};

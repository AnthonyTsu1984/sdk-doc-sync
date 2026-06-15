#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import * as cheerio from 'cheerio';

const args = parseArgs(process.argv.slice(2));
const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const mapPath = resolve(repoRoot, args.map ?? 'sync/wiki-node-map.json');
const outputPath = resolve(repoRoot, args.output ?? 'tmp/wiki-sync/static-synced-block-report.json');
const sectionFilter = args.section ? new Set(args.section.split(',').map((s) => s.trim()).filter(Boolean)) : null;
const titleFilter = args.title ? new Set(args.title.split(',').map((s) => s.trim()).filter(Boolean)) : null;

const mappingFile = JSON.parse(readFileSync(mapPath, 'utf8'));
const replacements = buildTokenReplacements(mappingFile);
const mappings = mappingFile.mappings.filter((mapping) => {
  if (mapping.status !== 'synced') return false;
  if (mapping.sync_scope !== 'content') return false;
  if (sectionFilter && !sectionFilter.has(mapping.section)) return false;
  if (titleFilter && !titleFilter.has(mapping.source.title) && !titleFilter.has(mapping.target.title)) return false;
  return mapping.source.obj_type === 'docx' && mapping.target.obj_type === 'docx';
});

const xmlCache = new Map();

const report = {
  generated_at: new Date().toISOString(),
  mode: args.apply ? 'apply' : 'dry-run',
  note: 'Expands source_synced and reference_synced blocks to static XML content. Output is not live-synced.',
  totals: {
    mapped_docs_considered: mappings.length,
    docs_with_synced_blocks: 0,
    source_synced_blocks: 0,
    reference_synced_blocks: 0,
    expanded_reference_blocks: 0,
    unresolved_reference_blocks: 0,
    overwritten_docs: 0,
    errors: 0,
  },
  docs: [],
};

for (const mapping of mappings) {
  const docReport = {
    section: mapping.section,
    source: mapping.source,
    target: mapping.target,
    source_synced_blocks: 0,
    reference_synced_blocks: 0,
    expanded_reference_blocks: 0,
    unresolved_reference_blocks: [],
    status: 'skipped-no-synced-blocks',
    errors: [],
  };

  try {
    const sourceXml = fetchXml(mapping.source.obj_token);
    const counts = countSyncedTags(sourceXml);

    if (counts.sourceSynced === 0 && counts.syncedReference === 0) {
      continue;
    }

    report.totals.docs_with_synced_blocks += 1;
    report.totals.source_synced_blocks += counts.sourceSynced;
    report.totals.reference_synced_blocks += counts.syncedReference;
    docReport.source_synced_blocks = counts.sourceSynced;
    docReport.reference_synced_blocks = counts.syncedReference;

    const targetXml = fetchXml(mapping.target.obj_token);
    const transformed = transformDocXml(sourceXml, {
      targetTitleXml: extractTitleXml(targetXml),
      stack: [`${mapping.source.obj_token}:document`],
      docReport,
    });

    if (!args.apply) {
      docReport.status = 'dry-run';
      docReport.transformed_preview = summarizeXml(transformed);
      report.docs.push(docReport);
      continue;
    }

    overwriteDoc(mapping.target.obj_token, transformed);
    docReport.status = 'overwritten-static-expanded';
    report.totals.overwritten_docs += 1;
  } catch (error) {
    docReport.status = 'error';
    docReport.errors.push(error.message);
    report.totals.errors += 1;
  }

  report.docs.push(docReport);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  ok: report.totals.errors === 0,
  mode: report.mode,
  output: outputPath,
  totals: report.totals,
}, null, 2));

function parseArgs(argv) {
  const parsed = {};
  const booleanFlags = new Set(['apply']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const name = arg.slice(2);
    if (booleanFlags.has(name)) {
      parsed[name] = true;
      continue;
    }
    if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`missing value for ${arg}`);
    parsed[name] = argv[index + 1];
    index += 1;
  }
  return parsed;
}

function fetchXml(docToken) {
  if (xmlCache.has(docToken)) return xmlCache.get(docToken);
  const raw = execFileSync('lark-cli', [
    'docs', '+fetch', '--api-version', 'v2', '--as', 'user', '--doc', docToken,
    '--doc-format', 'xml', '--detail', 'full', '--format', 'json',
  ], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  const payload = JSON.parse(raw);
  if (!payload.ok) throw new Error(`fetch XML failed for ${docToken}: ${payload.error?.message ?? raw}`);
  xmlCache.set(docToken, payload.data.document.content);
  return payload.data.document.content;
}

function fetchRangeXml(docToken, blockId) {
  const cacheKey = `${docToken}:${blockId}`;
  if (xmlCache.has(cacheKey)) return xmlCache.get(cacheKey);
  const raw = execFileSync('lark-cli', [
    'docs', '+fetch', '--api-version', 'v2', '--as', 'user', '--doc', docToken,
    '--doc-format', 'xml', '--detail', 'full', '--scope', 'range',
    '--start-block-id', blockId, '--end-block-id', blockId, '--format', 'json',
  ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const payload = JSON.parse(raw);
  if (!payload.ok) throw new Error(`fetch range failed for ${docToken}/${blockId}: ${payload.error?.message ?? raw}`);
  xmlCache.set(cacheKey, payload.data.document.content);
  return payload.data.document.content;
}

function overwriteDoc(docToken, xml) {
  const raw = execFileSync('lark-cli', [
    'docs', '+update', '--api-version', 'v2', '--as', 'user', '--doc', docToken,
    '--command', 'overwrite', '--content', xml, '--format', 'json',
  ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const payload = JSON.parse(raw);
  if (!payload.ok) throw new Error(`overwrite failed for ${docToken}: ${payload.error?.message ?? raw}`);
}

function countSyncedTags(xml) {
  const $ = cheerio.load(`<root>${xml}</root>`, { xmlMode: true, decodeEntities: false });
  return {
    sourceSynced: $('synced-source').length,
    syncedReference: $('synced_reference').length,
  };
}

function transformDocXml(xml, options) {
  const $ = cheerio.load(`<root>${xml}</root>`, { xmlMode: true, decodeEntities: false });

  $('synced_reference').each((_, node) => {
    const attrs = node.attribs ?? {};
    const sourceDoc = attrs['src-token'];
    const sourceBlock = attrs['src-block-id'];
    const key = `${sourceDoc}:${sourceBlock}`;

    if (!sourceDoc || !sourceBlock || options.stack.includes(key)) {
      options.docReport.unresolved_reference_blocks.push({
        source_doc: sourceDoc ?? null,
        source_block: sourceBlock ?? null,
        reason: options.stack.includes(key) ? 'cycle-detected' : 'missing source token or block id',
      });
      report.totals.unresolved_reference_blocks += 1;
      $(node).replaceWith('');
      return;
    }

    try {
      const rangeXml = fetchRangeXml(sourceDoc, sourceBlock);
      const expanded = expandFragmentXml(rangeXml, {
        ...options,
        stack: [...options.stack, key],
      });
      $(node).replaceWith(expanded);
      options.docReport.expanded_reference_blocks += 1;
      report.totals.expanded_reference_blocks += 1;
    } catch (error) {
      options.docReport.unresolved_reference_blocks.push({
        source_doc: sourceDoc,
        source_block: sourceBlock,
        reason: error.message,
      });
      report.totals.unresolved_reference_blocks += 1;
      $(node).replaceWith('');
    }
  });

  $('synced-source').each((_, node) => {
    $(node).replaceWith($(node).contents());
  });

  if (options.targetTitleXml) {
    const title = $('root').children('title').first();
    if (title.length) title.replaceWith(options.targetTitleXml);
    else $('root').prepend(options.targetTitleXml);
  }

  const output = $('root').children().toArray().map((node) => $.xml(node)).join('');
  return rewriteTokens(output);
}

function expandFragmentXml(fragmentXml, options) {
  const $ = cheerio.load(`<root>${fragmentXml}</root>`, { xmlMode: true, decodeEntities: false });
  const fragment = $('fragment').first();
  const content = fragment.length
    ? fragment.children().toArray().map((node) => $.xml(node)).join('')
    : $('root').children().toArray().map((node) => $.xml(node)).join('');
  const expanded = transformDocXml(content, { ...options, targetTitleXml: null });
  return stripTitle(expanded);
}

function extractTitleXml(xml) {
  const $ = cheerio.load(`<root>${xml}</root>`, { xmlMode: true, decodeEntities: false });
  const title = $('root').children('title').first();
  return title.length ? $.xml(title[0]) : null;
}

function stripTitle(xml) {
  const $ = cheerio.load(`<root>${xml}</root>`, { xmlMode: true, decodeEntities: false });
  $('root').children('title').remove();
  return $('root').children().toArray().map((node) => $.xml(node)).join('');
}

function rewriteTokens(xml) {
  let output = xml;
  for (const [from, to] of replacements) output = output.split(from).join(to);
  return output;
}

function buildTokenReplacements(file) {
  const pairs = [];
  for (const mapping of file.mappings) {
    if (mapping.source?.node_token && mapping.target?.node_token) pairs.push([mapping.source.node_token, mapping.target.node_token]);
    if (mapping.source?.obj_token && mapping.target?.obj_token) pairs.push([mapping.source.obj_token, mapping.target.obj_token]);
  }
  return pairs;
}

function summarizeXml(xml) {
  const counts = countSyncedTags(xml);
  return {
    length: xml.length,
    remaining_source_synced: counts.sourceSynced,
    remaining_synced_reference: counts.syncedReference,
    snippet: xml.replace(/\s+/g, ' ').slice(0, 500),
  };
}

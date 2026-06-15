#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import * as cheerio from 'cheerio';

const FIGMA_IFRAME_COMPONENT_TYPE = 8;
const SUPADEMO_BLOCK_TYPE_ID = 'blk_682093ba9580c002363b9dc3';

const args = parseArgs(process.argv.slice(2));
const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const mapPath = resolve(repoRoot, args.map ?? 'sync/wiki-node-map.json');
const outputPath = resolve(repoRoot, args.output ?? 'tmp/wiki-sync/embed-block-sync-report.json');
const sectionFilter = args.section ? new Set(args.section.split(',').map((s) => s.trim()).filter(Boolean)) : null;
const titleFilter = args.title ? new Set(args.title.split(',').map((s) => s.trim()).filter(Boolean)) : null;

const mappingFile = JSON.parse(readFileSync(mapPath, 'utf8'));
const replacements = buildTokenReplacements(mappingFile);
const mappings = mappingFile.mappings.filter((mapping) => {
  if (mapping.sync_scope !== 'content') return false;
  if (mapping.status !== 'synced') return false;
  if (sectionFilter && !sectionFilter.has(mapping.section)) return false;
  if (titleFilter && !titleFilter.has(mapping.target.title) && !titleFilter.has(mapping.source.title)) return false;
  return mapping.source.obj_type === 'docx' && mapping.target.obj_type === 'docx';
});

const report = {
  generated_at: new Date().toISOString(),
  mode: args.apply ? 'apply' : 'dry-run',
  constants: {
    figma_iframe_component_type: FIGMA_IFRAME_COMPONENT_TYPE,
    supademo_block_type_id: SUPADEMO_BLOCK_TYPE_ID,
  },
  totals: {
    mapped_docs_considered: mappings.length,
    docs_with_source_embeds: 0,
    source_embeds: 0,
    target_missing_embeds: 0,
    repaired_embeds: 0,
    unsupported_embeds: 0,
    errors: 0,
  },
  docs: [],
};

for (const mapping of mappings) {
  const docReport = {
    section: mapping.section,
    source: mapping.source,
    target: mapping.target,
    embeds: [],
    errors: [],
  };

  try {
    const sourceXml = fetchXml(mapping.source.obj_token);
    const sourceBlocks = topLevelBlocks(sourceXml);
    const sourceEmbeds = sourceBlocks
      .map((block, index) => ({ ...block, top_level_index: index }))
      .filter((block) => block.name === 'readonly-block' && isSupportedEmbed(block.attrs));

    if (sourceEmbeds.length === 0) continue;

    report.totals.docs_with_source_embeds += 1;
    report.totals.source_embeds += sourceEmbeds.length;

    const targetXml = fetchXml(mapping.target.obj_token);
    const targetBlocks = topLevelBlocks(targetXml);

    for (const sourceEmbed of sourceEmbeds) {
      const targetBlock = targetBlocks[sourceEmbed.top_level_index];
      const embedReport = buildEmbedReport(mapping, sourceEmbed, targetBlock);
      docReport.embeds.push(embedReport);

      if (!targetBlock || targetBlock.name !== 'p' || targetBlock.text.trim() !== '') {
        embedReport.status = 'target-slot-not-empty-placeholder';
        report.totals.unsupported_embeds += 1;
        continue;
      }

      report.totals.target_missing_embeds += 1;

      if (args.probeRaw) {
        const sourceBlock = fetchRawBlock(mapping.source.obj_token, sourceEmbed.attrs.id);
        embedReport.raw_source_block = sourceBlock;
        embedReport.create_child_preview = toCreateChild(sourceBlock, embedReport.kind, embedReport.href);
      }

      if (!args.apply) {
        embedReport.status = 'dry-run';
        continue;
      }

      try {
        const sourceBlock = fetchRawBlock(mapping.source.obj_token, sourceEmbed.attrs.id);
        const createChild = toCreateChild(sourceBlock, embedReport.kind, embedReport.href);
        deleteBlock(mapping.target.obj_token, targetBlock.attrs.id);
        createChildAt(mapping.target.obj_token, mapping.target.obj_token, sourceEmbed.top_level_index, createChild);
        embedReport.status = 'repaired';
        report.totals.repaired_embeds += 1;
      } catch (error) {
        embedReport.status = 'repair-failed';
        embedReport.error = error.message;
        report.totals.errors += 1;
      }
    }
  } catch (error) {
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
  const booleanFlags = new Set(['apply', 'probeRaw']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      if (booleanFlags.has(name)) {
        parsed[name] = true;
        continue;
      }
      if (!argv[index + 1] || argv[index + 1].startsWith('--')) {
        throw new Error(`missing value for ${arg}`);
      }
      parsed[name] = argv[index + 1];
      index += 1;
    }
  }
  return parsed;
}

function fetchXml(docToken) {
  const raw = execFileSync('lark-cli', [
    'docs',
    '+fetch',
    '--api-version',
    'v2',
    '--as',
    'user',
    '--doc',
    docToken,
    '--doc-format',
    'xml',
    '--detail',
    'full',
    '--format',
    'json',
  ], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  const payload = JSON.parse(raw);
  if (!payload.ok) throw new Error(`fetch XML failed for ${docToken}: ${payload.error?.message ?? raw}`);
  return payload.data.document.content;
}

function fetchRawBlock(docToken, blockId) {
  const raw = execFileSync('lark-cli', [
    'api',
    'GET',
    `/open-apis/docx/v1/documents/${docToken}/blocks/${blockId}`,
    '--as',
    'user',
    '--format',
    'json',
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const payload = JSON.parse(raw);
  if (payload.ok === false || (typeof payload.code === 'number' && payload.code !== 0)) {
    throw new Error(`fetch raw block failed for ${docToken}/${blockId}: ${payload.error?.message ?? payload.msg ?? raw}`);
  }
  return payload.data?.block ?? payload.data;
}

function deleteBlock(docToken, blockId) {
  const raw = execFileSync('lark-cli', [
    'docs',
    '+update',
    '--api-version',
    'v2',
    '--as',
    'user',
    '--doc',
    docToken,
    '--command',
    'block_delete',
    '--block-id',
    blockId,
    '--format',
    'json',
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const payload = JSON.parse(raw);
  if (!payload.ok) throw new Error(`delete placeholder failed for ${docToken}/${blockId}: ${payload.error?.message ?? raw}`);
}

function createChildAt(docToken, parentBlockId, index, child) {
  const body = JSON.stringify({ index, children: [child] });
  const raw = execFileSync('lark-cli', [
    'api',
    'POST',
    `/open-apis/docx/v1/documents/${docToken}/blocks/${parentBlockId}/children`,
    '--as',
    'user',
    '--params',
    '{"document_revision_id":-1}',
    '--data',
    body,
    '--format',
    'json',
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const payload = JSON.parse(raw);
  if (payload.ok === false || (typeof payload.code === 'number' && payload.code !== 0)) {
    throw new Error(`create embed failed for ${docToken} at ${index}: ${payload.error?.message ?? payload.msg ?? raw}`);
  }
}

function topLevelBlocks(xml) {
  const $ = cheerio.load(`<root>${xml}</root>`, { xmlMode: true, decodeEntities: false });
  return $('root')
    .children()
    .toArray()
    .map((node) => ({
      name: node.name,
      attrs: node.attribs ?? {},
      text: $(node).text(),
      xml: $.xml(node),
    }));
}

function isSupportedEmbed(attrs) {
  const href = attrs.href ?? '';
  const type = attrs.type ?? '';
  return href.includes('figma.com') || href.includes('supademo.com') || type === 'iframe' || type === 'isv';
}

function classifyEmbed(attrs) {
  const href = attrs.href ?? '';
  if (href.includes('figma.com')) return 'figma';
  if (href.includes('supademo.com')) return 'supademo';
  if ((attrs.type ?? '') === 'iframe') return 'figma';
  if ((attrs.type ?? '') === 'isv') return 'supademo';
  return 'unknown';
}

function buildEmbedReport(mapping, sourceEmbed, targetBlock) {
  const kind = classifyEmbed(sourceEmbed.attrs);
  const href = rewriteHref(sourceEmbed.attrs.href ?? '', replacements);
  return {
    kind,
    href,
    source_block_id: sourceEmbed.attrs.id,
    source_top_level_index: sourceEmbed.top_level_index,
    target_placeholder_block_id: targetBlock?.attrs?.id ?? null,
    target_block_at_index: targetBlock ? { name: targetBlock.name, text: targetBlock.text.trim() } : null,
    intended_api: {
      delete_placeholder: targetBlock?.attrs?.id
        ? `docs +update --api-version v2 --doc ${mapping.target.obj_token} --command block_delete --block-id ${targetBlock.attrs.id}`
        : null,
      create_embed: `POST /open-apis/docx/v1/documents/${mapping.target.obj_token}/blocks/${mapping.target.obj_token}/children?document_revision_id=-1 index=${sourceEmbed.top_level_index}`,
    },
  };
}

function rewriteHref(href, tokenReplacements) {
  let rewritten = href;
  for (const [from, to] of tokenReplacements) rewritten = rewritten.split(from).join(to);
  return rewritten;
}

function buildTokenReplacements(mappingFile) {
  const pairs = [];
  for (const mapping of mappingFile.mappings) {
    if (mapping.source?.node_token && mapping.target?.node_token) pairs.push([mapping.source.node_token, mapping.target.node_token]);
    if (mapping.source?.obj_token && mapping.target?.obj_token) pairs.push([mapping.source.obj_token, mapping.target.obj_token]);
  }
  return pairs;
}

function toCreateChild(sourceBlock, kind, href) {
  const child = stripReadOnlyBlockFields(sourceBlock);

  if (kind === 'figma') {
    child.block_type = child.block_type ?? 26;
    child.iframe = child.iframe ?? {};
    child.iframe.component = child.iframe.component ?? {};
    child.iframe.component.iframe_type = child.iframe.component.iframe_type ?? FIGMA_IFRAME_COMPONENT_TYPE;
    if (href) child.iframe.component.url = child.iframe.component.url ?? href;
    return child;
  }

  if (kind === 'supademo') {
    child.block_type = child.block_type ?? 40;
    child.add_ons = child.add_ons ?? {};
    child.add_ons.component_type_id = child.add_ons.component_type_id ?? SUPADEMO_BLOCK_TYPE_ID;
    if (href) {
      child.url = child.url ?? href;
      child.href = child.href ?? href;
    }
    return child;
  }

  throw new Error(`unsupported embed kind: ${kind}`);
}

function stripReadOnlyBlockFields(value) {
  if (Array.isArray(value)) return value.map(stripReadOnlyBlockFields);
  if (!value || typeof value !== 'object') return value;

  const blockedKeys = new Set([
    'block_id',
    'parent_id',
    'children',
    'page_token',
    'revision_id',
    'created_time',
    'updated_time',
    'created_by',
    'updated_by',
  ]);
  const result = {};
  for (const [key, childValue] of Object.entries(value)) {
    if (blockedKeys.has(key)) continue;
    result[key] = stripReadOnlyBlockFields(childValue);
  }
  return result;
}

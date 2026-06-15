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
const outputPath = resolve(repoRoot, args.output ?? 'tmp/wiki-sync/embed-block-placement-report.json');
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
  totals: {
    mapped_docs_considered: mappings.length,
    docs_with_source_embeds: 0,
    source_embeds: 0,
    already_correct: 0,
    moved_embeds: 0,
    created_embeds: 0,
    deleted_placeholders: 0,
    needs_action: 0,
    skipped: 0,
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
    const sourceBlocks = topLevelBlocks(fetchXml(mapping.source.obj_token));
    const targetBlocks = topLevelBlocks(fetchXml(mapping.target.obj_token));
    const sourceEmbeds = sourceBlocks
      .map((block, index) => ({ ...block, top_level_index: index }))
      .filter((block) => block.name === 'readonly-block' && isSupportedEmbed(block.attrs));

    if (sourceEmbeds.length === 0) continue;

    report.totals.docs_with_source_embeds += 1;
    report.totals.source_embeds += sourceEmbeds.length;

    const targetEmbeds = targetBlocks
      .map((block, index) => ({ ...block, top_level_index: index }))
      .filter((block) => block.name === 'readonly-block');

    let sourceSupademoOrdinal = 0;

    for (const sourceEmbed of sourceEmbeds) {
      const kind = classifyEmbed(sourceEmbed.attrs);
      if (kind === 'supademo') sourceSupademoOrdinal += 1;

      const sourceAnchor = sourceBlocks[sourceEmbed.top_level_index - 1];
      const targetAnchor = findTargetAnchor(sourceAnchor, targetBlocks);
      const targetEmbed = findTargetEmbed(kind, sourceEmbed, targetEmbeds, sourceSupademoOrdinal);
      const embedReport = {
        kind,
        source_block_id: sourceEmbed.attrs.id,
        source_top_level_index: sourceEmbed.top_level_index,
        source_anchor_text: sourceAnchor?.text ?? '',
        target_anchor_block_id: targetAnchor?.attrs?.id ?? null,
        target_anchor_index: targetAnchor?.top_level_index ?? null,
        target_embed_block_id: targetEmbed?.attrs?.id ?? null,
        target_embed_index: targetEmbed?.top_level_index ?? null,
        status: null,
      };
      docReport.embeds.push(embedReport);

      if (!targetAnchor?.attrs?.id) {
        embedReport.status = 'skipped-no-anchor';
        report.totals.skipped += 1;
        continue;
      }

      const blockAfterAnchor = targetBlocks[targetAnchor.top_level_index + 1];
      const blockTwoAfterAnchor = targetBlocks[targetAnchor.top_level_index + 2];
      const emptyPlaceholderAfterAnchor = blockAfterAnchor && isEmptyParagraph(blockAfterAnchor) ? blockAfterAnchor : null;

      if (targetEmbed) {
        if (targetEmbed.top_level_index === targetAnchor.top_level_index + 1) {
          embedReport.status = 'already-correct';
          report.totals.already_correct += 1;
          continue;
        }

        report.totals.needs_action += 1;
        if (!args.apply) {
          embedReport.status = 'would-move';
          continue;
        }

        if (emptyPlaceholderAfterAnchor?.attrs?.id && blockTwoAfterAnchor?.attrs?.id === targetEmbed.attrs.id) {
          deleteBlock(mapping.target.obj_token, emptyPlaceholderAfterAnchor.attrs.id);
          embedReport.status = 'deleted-placeholder-before-embed';
          report.totals.deleted_placeholders += 1;
          continue;
        }

        moveBlockAfter(mapping.target.obj_token, targetAnchor.attrs.id, targetEmbed.attrs.id);
        embedReport.status = 'moved';
        report.totals.moved_embeds += 1;
        continue;
      }

      report.totals.needs_action += 1;
      if (!args.apply) {
        embedReport.status = 'would-create';
        embedReport.target_placeholder_block_id = emptyPlaceholderAfterAnchor?.attrs?.id ?? null;
        continue;
      }

      if (emptyPlaceholderAfterAnchor?.attrs?.id) {
        deleteBlock(mapping.target.obj_token, emptyPlaceholderAfterAnchor.attrs.id);
        embedReport.target_placeholder_block_id = emptyPlaceholderAfterAnchor.attrs.id;
        report.totals.deleted_placeholders += 1;
      }

      const sourceRawBlock = fetchRawBlock(mapping.source.obj_token, sourceEmbed.attrs.id);
      createChildAt(mapping.target.obj_token, mapping.target.obj_token, targetAnchor.top_level_index, toCreateChild(sourceRawBlock, kind));
      embedReport.status = 'created';
      report.totals.created_embeds += 1;
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
  const raw = execFileSync('lark-cli', [
    'docs', '+fetch', '--api-version', 'v2', '--as', 'user', '--doc', docToken,
    '--doc-format', 'xml', '--detail', 'full', '--format', 'json',
  ], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  const payload = JSON.parse(raw);
  if (!payload.ok) throw new Error(`fetch XML failed for ${docToken}: ${payload.error?.message ?? raw}`);
  return payload.data.document.content;
}

function topLevelBlocks(xml) {
  const $ = cheerio.load(`<root>${xml}</root>`, { xmlMode: true, decodeEntities: false });
  return $('root').children().toArray().map((node, index) => ({
    name: node.name,
    attrs: node.attribs ?? {},
    text: normalizeText($(node).text()),
    xml: $.xml(node),
    top_level_index: index,
  }));
}

function findTargetAnchor(sourceAnchor, targetBlocks) {
  if (!sourceAnchor) return null;
  const sourceText = normalizeText(sourceAnchor.text);
  if (!sourceText) return null;
  const matches = targetBlocks.filter((block) => block.name === sourceAnchor.name && normalizeText(block.text) === sourceText);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return matches[0];
  return targetBlocks.find((block) => normalizeText(block.text) === sourceText) ?? null;
}

function findTargetEmbed(kind, sourceEmbed, targetEmbeds, supademoOrdinal) {
  if (kind === 'figma') {
    const href = rewriteHref(sourceEmbed.attrs.href ?? '', replacements);
    const normalizedHref = normalizeFigmaHref(href);
    return targetEmbeds.find((block) => normalizeFigmaHref(block.attrs.href ?? '') === normalizedHref) ?? null;
  }
  if (kind === 'supademo') {
    return targetEmbeds.filter((block) => block.attrs.type === 'isv')[supademoOrdinal - 1] ?? null;
  }
  return null;
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

function isEmptyParagraph(block) {
  return block.name === 'p' && normalizeText(block.text) === '';
}

function normalizeText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeFigmaHref(href) {
  let value = String(href ?? '').replace(/&amp;amp;/g, '&').replace(/&amp;/g, '&');
  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep the original value when it is not URI-encoded.
  }
  try {
    const url = new URL(value);
    const embedded = url.searchParams.get('url');
    if (embedded) return normalizeFigmaHref(embedded);
    url.searchParams.delete('t');
    url.searchParams.delete('mode');
    url.searchParams.sort();
    return url.toString();
  } catch {
    return value;
  }
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

function moveBlockAfter(docToken, anchorBlockId, movingBlockId) {
  const raw = execFileSync('lark-cli', [
    'docs', '+update', '--api-version', 'v2', '--as', 'user', '--doc', docToken,
    '--command', 'block_move_after', '--block-id', anchorBlockId, '--src-block-ids', movingBlockId,
    '--format', 'json',
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const payload = JSON.parse(raw);
  if (!payload.ok) throw new Error(`move failed for ${docToken}/${movingBlockId}: ${payload.error?.message ?? raw}`);
}

function deleteBlock(docToken, blockId) {
  const raw = execFileSync('lark-cli', [
    'docs', '+update', '--api-version', 'v2', '--as', 'user', '--doc', docToken,
    '--command', 'block_delete', '--block-id', blockId, '--format', 'json',
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const payload = JSON.parse(raw);
  if (!payload.ok) throw new Error(`delete failed for ${docToken}/${blockId}: ${payload.error?.message ?? raw}`);
}

function fetchRawBlock(docToken, blockId) {
  const raw = execFileSync('lark-cli', [
    'api', 'GET', `/open-apis/docx/v1/documents/${docToken}/blocks/${blockId}`,
    '--as', 'user', '--format', 'json',
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const payload = JSON.parse(raw);
  if (payload.ok === false || (typeof payload.code === 'number' && payload.code !== 0)) {
    throw new Error(`fetch raw block failed for ${docToken}/${blockId}: ${payload.error?.message ?? payload.msg ?? raw}`);
  }
  return payload.data?.block ?? payload.data;
}

function createChildAt(docToken, parentBlockId, index, child) {
  const raw = execFileSync('lark-cli', [
    'api', 'POST', `/open-apis/docx/v1/documents/${docToken}/blocks/${parentBlockId}/children`,
    '--as', 'user', '--params', '{"document_revision_id":-1}', '--data',
    JSON.stringify({ index, children: [child] }), '--format', 'json',
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const payload = JSON.parse(raw);
  if (payload.ok === false || (typeof payload.code === 'number' && payload.code !== 0)) {
    throw new Error(`create failed for ${docToken} at ${index}: ${payload.error?.message ?? payload.msg ?? raw}`);
  }
}

function toCreateChild(sourceBlock, kind) {
  const child = stripReadOnlyBlockFields(sourceBlock);
  if (kind === 'figma') {
    child.block_type = child.block_type ?? 26;
    child.iframe = child.iframe ?? {};
    child.iframe.component = child.iframe.component ?? {};
    child.iframe.component.iframe_type = child.iframe.component.iframe_type ?? FIGMA_IFRAME_COMPONENT_TYPE;
    return child;
  }
  if (kind === 'supademo') {
    child.block_type = child.block_type ?? 40;
    child.add_ons = child.add_ons ?? {};
    child.add_ons.component_type_id = child.add_ons.component_type_id ?? SUPADEMO_BLOCK_TYPE_ID;
    return child;
  }
  throw new Error(`unsupported embed kind: ${kind}`);
}

function stripReadOnlyBlockFields(value) {
  if (Array.isArray(value)) return value.map(stripReadOnlyBlockFields);
  if (!value || typeof value !== 'object') return value;
  const blockedKeys = new Set(['block_id', 'parent_id', 'children', 'page_token', 'revision_id', 'created_time', 'updated_time', 'created_by', 'updated_by']);
  const result = {};
  for (const [key, childValue] of Object.entries(value)) {
    if (blockedKeys.has(key)) continue;
    result[key] = stripReadOnlyBlockFields(childValue);
  }
  return result;
}

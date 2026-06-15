#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import * as cheerio from 'cheerio';

const args = parseArgs(process.argv.slice(2));
const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const mapPath = resolve(repoRoot, args.map ?? 'sync/wiki-node-map.json');
const outputPath = resolve(repoRoot, args.output ?? 'tmp/wiki-sync/reference-synced-workbook.json');
const tsvPath = resolve(repoRoot, args.tsv ?? 'tmp/wiki-sync/reference-synced-workbook.tsv');
const sectionFilter = args.section ? new Set(args.section.split(',').map((s) => s.trim()).filter(Boolean)) : null;

const mappingFile = JSON.parse(readFileSync(mapPath, 'utf8'));
const sourceDocMap = new Map(mappingFile.mappings.map((mapping) => [mapping.source?.obj_token, mapping]));
const mappings = mappingFile.mappings.filter((mapping) => {
  if (mapping.status !== 'synced') return false;
  if (mapping.sync_scope !== 'content') return false;
  if (sectionFilter && !sectionFilter.has(mapping.section)) return false;
  return mapping.source.obj_type === 'docx' && mapping.target.obj_type === 'docx';
});

const xmlCache = new Map();
const parsedCache = new Map();

const report = {
  generated_at: new Date().toISOString(),
  mode: 'manual-ui-workbook',
  note: 'ReferenceSynced blocks are read-only in the server API. Recreate these manually in Feishu UI, using target_source_doc and target_source_block_id where resolved.',
  totals: {
    mapped_docs_considered: mappings.length,
    docs_with_source_refs: 0,
    source_refs: 0,
    target_refs: 0,
    target_source_doc_mapped: 0,
    target_source_block_resolved: 0,
    unresolved_source_doc: 0,
    unresolved_source_block: 0,
    errors: 0,
  },
  references: [],
  errors: [],
};

for (const mapping of mappings) {
  try {
    const sourceParsed = parseDoc(mapping.source.obj_token);
    const targetParsed = parseDoc(mapping.target.obj_token);
    const sourceRefs = sourceParsed.nodes.filter((node) => node.name === 'synced_reference');
    const targetRefs = targetParsed.nodes.filter((node) => node.name === 'synced_reference');

    if (sourceRefs.length === 0) continue;

    report.totals.docs_with_source_refs += 1;
    report.totals.source_refs += sourceRefs.length;
    report.totals.target_refs += targetRefs.length;

    for (const sourceRef of sourceRefs) {
      const sourceRefToken = sourceRef.attrs['src-token'];
      const sourceRefBlockId = sourceRef.attrs['src-block-id'];
      const targetSourceMapping = sourceDocMap.get(sourceRefToken);
      const placement = resolvePlacement(mapping, sourceRef, sourceParsed, targetParsed);
      const targetSource = targetSourceMapping ? resolveTargetSourceBlock(targetSourceMapping, sourceRefBlockId) : null;

      if (targetSourceMapping) report.totals.target_source_doc_mapped += 1;
      else report.totals.unresolved_source_doc += 1;

      if (targetSource?.target_block_id) report.totals.target_source_block_resolved += 1;
      else report.totals.unresolved_source_block += 1;

      report.references.push({
        section: mapping.section,
        status: targetSource?.target_block_id ? 'ready-for-manual-ui' : 'needs-manual-resolution',
        target_doc: {
          path: mapping.target.path,
          token: mapping.target.obj_token,
          wiki_node: mapping.target.node_token,
          url: `https://zilliverse.feishu.cn/docx/${mapping.target.obj_token}`,
        },
        insertion: placement,
        source_reference: {
          source_doc_path: mapping.source.path,
          source_doc_token: mapping.source.obj_token,
          source_reference_block_id: sourceRef.attrs.id,
          original_source_document_id: sourceRefToken,
          original_source_block_id: sourceRefBlockId,
          source_reference_context_before: sourceParsed.nodes[sourceRef.ordinal - 1]?.text ?? '',
          source_reference_context_after: sourceParsed.nodes[sourceRef.ordinal + 1]?.text ?? '',
        },
        target_source: targetSourceMapping ? {
          path: targetSourceMapping.target.path,
          token: targetSourceMapping.target.obj_token,
          wiki_node: targetSourceMapping.target.node_token,
          url: `https://zilliverse.feishu.cn/docx/${targetSourceMapping.target.obj_token}`,
          block_id: targetSource?.target_block_id ?? null,
          block_match_confidence: targetSource?.confidence ?? 'unresolved',
          block_match_reason: targetSource?.reason ?? null,
          block_preview: targetSource?.source_block_preview ?? null,
        } : {
          path: null,
          token: null,
          block_id: null,
          block_match_confidence: 'unmapped-source-doc',
          block_match_reason: `No mapping for original source document ${sourceRefToken}`,
          block_preview: null,
        },
        manual_steps: [
          'Open target_source.url and locate target_source.block_id or the block_preview text.',
          'In Feishu UI, copy/create a synced reference for that target-source block.',
          'Open target_doc.url and paste the synced reference at insertion.target_anchor_context.',
          'Do not point the new reference at original_source_document_id unless target_source is unresolved.',
        ],
      });
    }
  } catch (error) {
    report.totals.errors += 1;
    report.errors.push({
      source_path: mapping.source.path,
      target_path: mapping.target.path,
      error: error.message,
    });
  }
}

mkdirSync(dirname(outputPath), { recursive: true });
mkdirSync(dirname(tsvPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(tsvPath, toTsv(report.references));

console.log(JSON.stringify({
  ok: report.totals.errors === 0,
  output: outputPath,
  tsv: tsvPath,
  totals: report.totals,
}, null, 2));

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const name = arg.slice(2);
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

function parseDoc(docToken) {
  if (parsedCache.has(docToken)) return parsedCache.get(docToken);
  const xml = fetchXml(docToken);
  const $ = cheerio.load(`<root>${xml}</root>`, { xmlMode: true, decodeEntities: false });
  const nodes = [];
  const topLevel = [];

  $('root').children().each((topIndex, topNode) => {
    const topInfo = nodeInfo($, topNode, nodes.length, topIndex, null);
    topLevel.push(topInfo);
    nodes.push(topInfo);
    $(topNode).find('*').each((_, childNode) => {
      nodes.push(nodeInfo($, childNode, nodes.length, topIndex, topInfo));
    });
  });

  const byId = new Map(nodes.filter((node) => node.attrs.id).map((node) => [node.attrs.id, node]));
  const parsed = { docToken, xml, nodes, topLevel, byId };
  parsedCache.set(docToken, parsed);
  return parsed;
}

function nodeInfo($, node, ordinal, topLevelIndex, topLevelNode) {
  return {
    ordinal,
    top_level_index: topLevelIndex,
    name: node.name,
    attrs: node.attribs ?? {},
    text: normalizeText($(node).text()),
    xml_signature: normalizeXml($.xml(node)),
    top_level_name: topLevelNode?.name ?? node.name,
    top_level_text: topLevelNode ? normalizeText($(topLevelNode).text()) : normalizeText($(node).text()),
    top_level_block_id: topLevelNode?.attribs?.id ?? node.attribs?.id ?? null,
  };
}

function resolvePlacement(mapping, sourceRef, sourceParsed, targetParsed) {
  const sourceBefore = previousTextNode(sourceParsed.nodes, sourceRef.ordinal);
  const sourceAfter = nextTextNode(sourceParsed.nodes, sourceRef.ordinal);
  const targetBefore = sourceBefore ? findEquivalentNode(sourceBefore, targetParsed).node : null;
  const targetAfter = sourceAfter ? findEquivalentNode(sourceAfter, targetParsed).node : null;

  return {
    source_top_level_index: sourceRef.top_level_index,
    source_context_before: sourceBefore?.text ?? '',
    source_context_after: sourceAfter?.text ?? '',
    target_anchor_block_id: targetBefore?.attrs?.id ?? null,
    target_anchor_context: targetBefore?.text ?? null,
    target_next_block_id: targetAfter?.attrs?.id ?? null,
    target_next_context: targetAfter?.text ?? null,
    target_empty_placeholder_hint: targetParsed.topLevel.find((block) => block.name === 'p' && !block.text && (
      block.top_level_index === sourceRef.top_level_index ||
      block.top_level_index === sourceRef.top_level_index - 1 ||
      block.top_level_index === sourceRef.top_level_index + 1
    ))?.attrs?.id ?? null,
  };
}

function resolveTargetSourceBlock(sourceMapping, sourceBlockId) {
  const sourceParsed = parseDoc(sourceMapping.source.obj_token);
  const targetParsed = parseDoc(sourceMapping.target.obj_token);
  const sourceBlock = sourceParsed.byId.get(sourceBlockId);

  if (!sourceBlock) {
    return {
      target_block_id: null,
      confidence: 'unresolved',
      reason: `Source block ${sourceBlockId} not found in ${sourceMapping.source.obj_token}`,
      source_block_preview: null,
    };
  }

  const match = findEquivalentNode(sourceBlock, targetParsed);
  return {
    target_block_id: match.node?.attrs?.id ?? null,
    confidence: match.confidence,
    reason: match.reason,
    source_block_preview: {
      name: sourceBlock.name,
      text: sourceBlock.text,
      top_level_text: sourceBlock.top_level_text,
    },
  };
}

function findEquivalentNode(sourceNode, targetParsed) {
  const sameSignature = targetParsed.nodes.filter((node) => node.name === sourceNode.name && node.xml_signature === sourceNode.xml_signature);
  if (sameSignature.length === 1) return { node: sameSignature[0], confidence: 'exact-xml', reason: 'single node with same XML signature' };

  const sameText = targetParsed.nodes.filter((node) => node.name === sourceNode.name && node.text && node.text === sourceNode.text);
  if (sameText.length === 1) return { node: sameText[0], confidence: 'exact-text', reason: 'single node with same tag and text' };

  const sameTopText = targetParsed.nodes.filter((node) => node.name === sourceNode.name && node.top_level_text && node.top_level_text === sourceNode.top_level_text);
  if (sameTopText.length === 1) return { node: sameTopText[0], confidence: 'top-level-context', reason: 'single node with same tag and top-level text' };

  if (sourceNode.top_level_index < targetParsed.topLevel.length) {
    const ordinal = targetParsed.topLevel[sourceNode.top_level_index];
    if (ordinal?.name === sourceNode.top_level_name) return { node: ordinal, confidence: 'top-level-ordinal', reason: 'same top-level index and tag' };
  }

  const fallback = sameText[0] ?? sameTopText[0] ?? null;
  return {
    node: fallback,
    confidence: fallback ? 'ambiguous' : 'unresolved',
    reason: fallback ? 'multiple possible matches; first candidate selected' : 'no equivalent target block found',
  };
}

function previousTextNode(nodes, ordinal) {
  for (let index = ordinal - 1; index >= 0; index -= 1) {
    if (nodes[index].text) return nodes[index];
  }
  return null;
}

function nextTextNode(nodes, ordinal) {
  for (let index = ordinal + 1; index < nodes.length; index += 1) {
    if (nodes[index].text) return nodes[index];
  }
  return null;
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeXml(value) {
  return String(value ?? '')
    .replace(/\sid="[^"]*"/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTsv(references) {
  const header = [
    'status',
    'section',
    'target_doc_path',
    'target_doc_url',
    'insert_after_context',
    'insert_before_context',
    'target_source_path',
    'target_source_url',
    'target_source_block_id',
    'match_confidence',
    'source_block_preview',
    'original_source_doc',
    'original_source_block_id',
  ];
  const rows = references.map((ref) => [
    ref.status,
    ref.section,
    ref.target_doc.path,
    ref.target_doc.url,
    ref.insertion.target_anchor_context,
    ref.insertion.target_next_context,
    ref.target_source.path,
    ref.target_source.url,
    ref.target_source.block_id,
    ref.target_source.block_match_confidence,
    ref.target_source.block_preview?.text || ref.target_source.block_preview?.top_level_text || '',
    ref.source_reference.original_source_document_id,
    ref.source_reference.original_source_block_id,
  ]);
  return [header, ...rows].map((row) => row.map(tsvCell).join('\t')).join('\n') + '\n';
}

function tsvCell(value) {
  return String(value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

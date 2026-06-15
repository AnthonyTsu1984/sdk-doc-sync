#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import * as cheerio from 'cheerio';

const args = parseArgs(process.argv.slice(2));
const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const mapPath = resolve(repoRoot, args.map ?? 'sync/wiki-node-map.json');
const outputPath = resolve(repoRoot, args.output ?? 'tmp/wiki-sync/synced-block-recreate-plan.json');
const recreateTsvPath = resolve(repoRoot, args.recreateTsv ?? 'tmp/wiki-sync/source-synced-docs-to-recreate.tsv');
const referenceTsvPath = resolve(repoRoot, args.referenceTsv ?? 'tmp/wiki-sync/reference-synced-docs-to-repair.tsv');
const sectionFilter = args.section ? new Set(args.section.split(',').map((s) => s.trim()).filter(Boolean)) : null;

const mappingFile = JSON.parse(readFileSync(mapPath, 'utf8'));
const mappings = mappingFile.mappings.filter((mapping) => {
  if (mapping.status !== 'synced') return false;
  if (mapping.sync_scope !== 'content') return false;
  if (sectionFilter && !sectionFilter.has(mapping.section)) return false;
  return mapping.source.obj_type === 'docx' && mapping.target.obj_type === 'docx';
});

const report = {
  generated_at: new Date().toISOString(),
  source_root: mappingFile.source_root,
  target_root: mappingFile.target_root,
  totals: {
    mapped_docs_considered: mappings.length,
    docs_to_recreate_for_source_synced: 0,
    source_synced_blocks: 0,
    docs_with_reference_synced: 0,
    reference_synced_blocks: 0,
    reference_docs_also_recreated: 0,
    errors: 0,
  },
  docs_to_recreate_for_source_synced: [],
  docs_with_reference_synced: [],
  errors: [],
};

for (const mapping of mappings) {
  try {
    const xml = fetchXml(mapping.source.obj_token);
    const counts = countSyncedBlocks(xml);

    if (counts.sourceSynced > 0) {
      report.totals.docs_to_recreate_for_source_synced += 1;
      report.totals.source_synced_blocks += counts.sourceSynced;
      report.docs_to_recreate_for_source_synced.push({
        section: mapping.section,
        source_path: mapping.source.path,
        target_path: mapping.target.path,
        source_title: mapping.source.title,
        target_title: mapping.target.title,
        source_node_token: mapping.source.node_token,
        source_obj_token: mapping.source.obj_token,
        target_node_token_old: mapping.target.node_token,
        target_obj_token_old: mapping.target.obj_token,
        target_parent_path: parentPath(mapping.target.path),
        source_synced_blocks: counts.sourceSynced,
        reference_synced_blocks_in_same_doc: counts.referenceSynced,
        proposed_operation: 'copy source wiki node under target parent, title as target_title; verify source_synced count; delete old target node; update wiki-node-map target tokens',
      });
    }

    if (counts.referenceSynced > 0) {
      report.totals.docs_with_reference_synced += 1;
      report.totals.reference_synced_blocks += counts.referenceSynced;
      const alsoRecreated = counts.sourceSynced > 0;
      if (alsoRecreated) report.totals.reference_docs_also_recreated += 1;
      report.docs_with_reference_synced.push({
        section: mapping.section,
        source_path: mapping.source.path,
        target_path: mapping.target.path,
        source_title: mapping.source.title,
        target_title: mapping.target.title,
        source_node_token: mapping.source.node_token,
        source_obj_token: mapping.source.obj_token,
        target_node_token_current: mapping.target.node_token,
        target_obj_token_current: mapping.target.obj_token,
        reference_synced_blocks: counts.referenceSynced,
        source_synced_blocks_in_same_doc: counts.sourceSynced,
        also_in_recreate_set: alsoRecreated,
        reference_targets: extractReferenceTargets(xml),
        manual_action_after_recreate: 'recreate these ReferenceSynced blocks in Feishu UI, pointing to recreated target-side SourceSynced blocks',
      });
    }
  } catch (error) {
    report.totals.errors += 1;
    report.errors.push({
      section: mapping.section,
      source_path: mapping.source.path,
      target_path: mapping.target.path,
      error: error.message,
    });
  }
}

mkdirSync(dirname(outputPath), { recursive: true });
mkdirSync(dirname(recreateTsvPath), { recursive: true });
mkdirSync(dirname(referenceTsvPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(recreateTsvPath, toRecreateTsv(report.docs_to_recreate_for_source_synced));
writeFileSync(referenceTsvPath, toReferenceTsv(report.docs_with_reference_synced));

console.log(JSON.stringify({
  ok: report.totals.errors === 0,
  output: outputPath,
  recreate_tsv: recreateTsvPath,
  reference_tsv: referenceTsvPath,
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
  const raw = execFileSync('lark-cli', [
    'docs', '+fetch', '--api-version', 'v2', '--as', 'user', '--doc', docToken,
    '--doc-format', 'xml', '--detail', 'full', '--format', 'json',
  ], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  const payload = JSON.parse(raw);
  if (!payload.ok) throw new Error(`fetch XML failed for ${docToken}: ${payload.error?.message ?? raw}`);
  return payload.data.document.content;
}

function countSyncedBlocks(xml) {
  const $ = cheerio.load(`<root>${xml}</root>`, { xmlMode: true, decodeEntities: false });
  return {
    sourceSynced: $('synced-source').length,
    referenceSynced: $('synced_reference').length,
  };
}

function extractReferenceTargets(xml) {
  const $ = cheerio.load(`<root>${xml}</root>`, { xmlMode: true, decodeEntities: false });
  return $('synced_reference').toArray().map((node) => ({
    source_doc_token: node.attribs?.['src-token'] ?? null,
    source_block_id: node.attribs?.['src-block-id'] ?? null,
  }));
}

function parentPath(path) {
  const parts = String(path ?? '').split(' > ');
  return parts.slice(0, -1).join(' > ');
}

function toRecreateTsv(rows) {
  const header = [
    'section',
    'target_path',
    'target_title',
    'target_parent_path',
    'source_path',
    'source_node_token',
    'source_obj_token',
    'old_target_node_token',
    'old_target_obj_token',
    'source_synced_blocks',
    'reference_synced_blocks_in_same_doc',
  ];
  return [header, ...rows.map((row) => [
    row.section,
    row.target_path,
    row.target_title,
    row.target_parent_path,
    row.source_path,
    row.source_node_token,
    row.source_obj_token,
    row.target_node_token_old,
    row.target_obj_token_old,
    row.source_synced_blocks,
    row.reference_synced_blocks_in_same_doc,
  ])].map((row) => row.map(tsvCell).join('\t')).join('\n') + '\n';
}

function toReferenceTsv(rows) {
  const header = [
    'section',
    'target_path',
    'target_title',
    'source_path',
    'target_node_token_current',
    'target_obj_token_current',
    'reference_synced_blocks',
    'source_synced_blocks_in_same_doc',
    'also_in_recreate_set',
    'reference_targets',
  ];
  return [header, ...rows.map((row) => [
    row.section,
    row.target_path,
    row.target_title,
    row.source_path,
    row.target_node_token_current,
    row.target_obj_token_current,
    row.reference_synced_blocks,
    row.source_synced_blocks_in_same_doc,
    row.also_in_recreate_set,
    row.reference_targets.map((target) => `${target.source_doc_token}:${target.source_block_id}`).join(', '),
  ])].map((row) => row.map(tsvCell).join('\t')).join('\n') + '\n';
}

function tsvCell(value) {
  return String(value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

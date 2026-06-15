#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const args = parseArgs(process.argv.slice(2));
const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const mapPath = resolve(repoRoot, args.map ?? 'sync/wiki-node-map.json');
const jsonOutput = resolve(repoRoot, args.output ?? 'tmp/wiki-sync/node-copy-synced-block-check.json');
const tsvOutput = jsonOutput.replace(/\.json$/, '.tsv');
const section = args.section ?? 'Management';

const mappingFile = JSON.parse(readFileSync(mapPath, 'utf8'));
const mappings = mappingFile.mappings.filter((mapping) => (
  mapping.section === section
  && mapping.sync_scope === 'node_copy'
  && mapping.source?.obj_type === 'docx'
  && mapping.target?.obj_type === 'docx'
));

const report = {
  generated_at: new Date().toISOString(),
  section,
  sync_scope: 'node_copy',
  totals: {
    docs_checked: 0,
    source_docs_with_synced_blocks: 0,
    target_docs_with_synced_blocks: 0,
    source_synced_source_blocks: 0,
    target_synced_source_blocks: 0,
    source_synced_reference_blocks: 0,
    target_synced_reference_blocks: 0,
    preserved_docs: 0,
    missing_or_changed_docs: 0,
    errors: 0,
  },
  docs: [],
};

for (const mapping of mappings) {
  const row = {
    source_path: mapping.source.path,
    source_node: mapping.source.node_token,
    source_doc: mapping.source.obj_token,
    target_path: mapping.target.path,
    target_node: mapping.target.node_token,
    target_doc: mapping.target.obj_token,
    source_counts: null,
    target_counts: null,
    status: 'unknown',
    error: null,
  };

  try {
    const sourceXml = fetchXml(mapping.source.obj_token);
    const targetXml = fetchXml(mapping.target.obj_token);
    row.source_counts = countSyncedBlocks(sourceXml);
    row.target_counts = countSyncedBlocks(targetXml);

    const sourceTotal = row.source_counts.synced_source + row.source_counts.synced_reference;
    const targetTotal = row.target_counts.synced_source + row.target_counts.synced_reference;
    report.totals.docs_checked += 1;
    report.totals.source_synced_source_blocks += row.source_counts.synced_source;
    report.totals.target_synced_source_blocks += row.target_counts.synced_source;
    report.totals.source_synced_reference_blocks += row.source_counts.synced_reference;
    report.totals.target_synced_reference_blocks += row.target_counts.synced_reference;
    if (sourceTotal > 0) report.totals.source_docs_with_synced_blocks += 1;
    if (targetTotal > 0) report.totals.target_docs_with_synced_blocks += 1;

    row.status = countsEqual(row.source_counts, row.target_counts) ? 'preserved' : 'missing_or_changed';
    if (row.status === 'preserved') report.totals.preserved_docs += 1;
    else report.totals.missing_or_changed_docs += 1;
  } catch (error) {
    row.status = 'error';
    row.error = error.message;
    report.totals.errors += 1;
  }

  report.docs.push(row);
}

mkdirSync(dirname(jsonOutput), { recursive: true });
writeFileSync(jsonOutput, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(tsvOutput, toTsv(report));

console.log(JSON.stringify({
  ok: report.totals.errors === 0,
  output: jsonOutput,
  tsv: tsvOutput,
  totals: report.totals,
}, null, 2));
if (report.totals.errors > 0) process.exitCode = 1;

function fetchXml(docToken) {
  const raw = execFileSync('lark-cli', [
    'docs', '+fetch',
    '--api-version', 'v2',
    '--as', 'user',
    '--doc', docToken,
    '--doc-format', 'xml',
    '--detail', 'full',
    '--format', 'json',
  ], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  const payload = parsePayload(raw);
  if (!payload.ok) throw new Error(`fetch failed for ${docToken}: ${payload.error?.message ?? raw}`);
  return payload.data.document.content;
}

function countSyncedBlocks(xml) {
  return {
    synced_source: countMatches(xml, /<synced-source\b/g),
    synced_reference: countMatches(xml, /<synced_reference\b/g),
  };
}

function countsEqual(left, right) {
  return left.synced_source === right.synced_source
    && left.synced_reference === right.synced_reference;
}

function countMatches(value, regex) {
  return value.match(regex)?.length ?? 0;
}

function parsePayload(raw) {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error(`could not parse JSON payload: ${raw}`);
  }
}

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

function toTsv(report) {
  const header = [
    'status',
    'source_synced_source',
    'target_synced_source',
    'source_synced_reference',
    'target_synced_reference',
    'source_node',
    'target_node',
    'source_path',
    'target_path',
    'error',
  ];
  const lines = [header.join('\t')];
  for (const doc of report.docs) {
    lines.push([
      doc.status,
      doc.source_counts?.synced_source ?? '',
      doc.target_counts?.synced_source ?? '',
      doc.source_counts?.synced_reference ?? '',
      doc.target_counts?.synced_reference ?? '',
      doc.source_node,
      doc.target_node,
      doc.source_path,
      doc.target_path,
      doc.error ?? '',
    ].join('\t'));
  }
  return `${lines.join('\n')}\n`;
}

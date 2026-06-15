#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const mapPath = resolve(repoRoot, 'sync/wiki-node-map.json');
const outputPath = resolve(repoRoot, 'tmp/wiki-sync/node-copy-reference-targets.json');
const mappingFile = JSON.parse(readFileSync(mapPath, 'utf8'));
const sourceDocToMapping = new Map();
const targetDocToMapping = new Map();
for (const mapping of mappingFile.mappings) {
  if (mapping.source?.obj_token) sourceDocToMapping.set(mapping.source.obj_token, mapping);
  if (mapping.target?.obj_token) targetDocToMapping.set(mapping.target.obj_token, mapping);
}

const docs = mappingFile.mappings.filter((mapping) => (
  mapping.section === 'Management'
  && mapping.sync_scope === 'node_copy'
  && mapping.target?.obj_type === 'docx'
));

const report = {
  generated_at: new Date().toISOString(),
  totals: {
    docs_checked: 0,
    docs_with_references: 0,
    reference_blocks: 0,
    points_to_target_mapping: 0,
    points_to_source_mapping: 0,
    points_to_unmapped_doc: 0,
    errors: 0,
  },
  docs: [],
};

for (const mapping of docs) {
  const row = {
    target_path: mapping.target.path,
    target_node: mapping.target.node_token,
    target_doc: mapping.target.obj_token,
    references: [],
    error: null,
  };
  try {
    const xml = fetchXml(mapping.target.obj_token);
    row.references = extractReferences(xml).map((reference) => classifyReference(reference));
    report.totals.docs_checked += 1;
    if (row.references.length > 0) report.totals.docs_with_references += 1;
    for (const reference of row.references) {
      report.totals.reference_blocks += 1;
      if (reference.src_doc_class === 'target_mapping') report.totals.points_to_target_mapping += 1;
      else if (reference.src_doc_class === 'source_mapping') report.totals.points_to_source_mapping += 1;
      else report.totals.points_to_unmapped_doc += 1;
    }
  } catch (error) {
    row.error = error.message;
    report.totals.errors += 1;
  }
  if (row.references.length > 0 || row.error) report.docs.push(row);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  ok: report.totals.errors === 0,
  output: outputPath,
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

function extractReferences(xml) {
  const references = [];
  const tagRegex = /<synced_reference\b[^>]*>/g;
  for (const match of xml.matchAll(tagRegex)) {
    const tag = match[0];
    references.push({
      src_doc: attr(tag, 'src-token'),
      src_block: attr(tag, 'src-block-id'),
    });
  }
  return references;
}

function classifyReference(reference) {
  const targetMapping = targetDocToMapping.get(reference.src_doc);
  const sourceMapping = sourceDocToMapping.get(reference.src_doc);
  if (targetMapping) {
    return {
      ...reference,
      src_doc_class: 'target_mapping',
      mapped_path: targetMapping.target.path,
      mapped_node: targetMapping.target.node_token,
    };
  }
  if (sourceMapping) {
    return {
      ...reference,
      src_doc_class: 'source_mapping',
      mapped_path: sourceMapping.source.path,
      mapped_node: sourceMapping.source.node_token,
    };
  }
  return {
    ...reference,
    src_doc_class: 'unmapped_doc',
    mapped_path: null,
    mapped_node: null,
  };
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`));
  return match?.[1] ?? null;
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

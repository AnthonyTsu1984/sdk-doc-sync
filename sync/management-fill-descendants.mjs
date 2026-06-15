#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const SOURCE_SPACE_ID = '7167193056431783939';
const TARGET_SPACE_ID = '7167193056431783939';
const SECTION = 'Management';

const args = parseArgs(process.argv.slice(2));
const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const mapPath = resolve(repoRoot, args.map ?? 'sync/wiki-node-map.json');
const sourceTreePath = resolve(repoRoot, args.sourceTree ?? 'tmp/wiki-sync/source-expanded.tsv');
const outputPath = resolve(repoRoot, args.output ?? 'tmp/wiki-sync/management-fill-descendants-report.json');

const sourceIndex = readSourceTree(sourceTreePath);
const mappingFile = JSON.parse(readFileSync(mapPath, 'utf8'));
const roots = mappingFile.mappings.filter((mapping) => (
  mapping.section === SECTION
  && mapping.status === 'synced'
  && mapping.sync_scope === 'category_stub'
));

const report = {
  generated_at: new Date().toISOString(),
  mode: args.apply ? 'apply' : 'dry-run',
  roots: roots.map((mapping) => ({
    source: mapping.source,
    target: mapping.target,
    source_descendant_count: sourceIndex.descendants(mapping.source.node_token).length,
  })),
  copied: [],
  existing: [],
  mappings_added: [],
  totals: {
    roots: roots.length,
    source_descendants: 0,
    existing_target_nodes: 0,
    copied_nodes: 0,
    map_entries_added: 0,
    errors: 0,
  },
  errors: [],
};

try {
  for (const root of roots) {
    report.totals.source_descendants += sourceIndex.descendants(root.source.node_token).length;
    fillChildren(root.source, root.target);
  }

  if (args.apply) {
    const before = mappingFile.mappings.length;
    upsertMappings(mappingFile, report.mappings_added);
    mappingFile.updated_at = new Date().toISOString();
    writeFileSync(mapPath, `${JSON.stringify(mappingFile, null, 2)}\n`);
    report.totals.map_entries_added = mappingFile.mappings.length - before;
  }
} catch (error) {
  report.totals.errors += 1;
  report.errors.push(error.stack ?? error.message);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  ok: report.totals.errors === 0,
  mode: report.mode,
  output: outputPath,
  totals: report.totals,
}, null, 2));
if (report.totals.errors > 0) process.exitCode = 1;

function fillChildren(sourceParent, targetParent) {
  const sourceChildren = sourceIndex.children(sourceParent.node_token);
  const targetChildren = args.apply ? listChildren(targetParent.node_token) : [];
  const targetByTitle = new Map(targetChildren.map((node) => [node.title.trim(), node]));

  for (const sourceChild of sourceChildren) {
    let targetChild = targetByTitle.get(sourceChild.title.trim());
    let status = 'existing';

    if (!targetChild) {
      status = args.apply ? 'copied' : 'dry-run-copy';
      targetChild = args.apply
        ? copyNode(sourceChild, targetParent.node_token)
        : dryRunTarget(sourceChild, targetParent);
      if (args.apply) {
        report.copied.push({ source: sourceChild, target_parent: targetParent, copied: targetChild });
        report.totals.copied_nodes += 1;
      }
    } else {
      report.existing.push({ source: sourceChild, target: targetChild, target_parent: targetParent });
      report.totals.existing_target_nodes += 1;
    }

    const mapping = mapEntry(sourceChild, {
      path: `${targetParent.path} > ${targetChild.title}`,
      title: targetChild.title,
      node_token: targetChild.node_token,
      obj_token: targetChild.obj_token,
      obj_type: targetChild.obj_type,
      node_type: targetChild.node_type,
    });
    report.mappings_added.push(mapping);

    fillChildren(sourceChild, mapping.target);
    if (status === 'dry-run-copy') report.totals.copied_nodes += 1;
  }
}

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

function readSourceTree(path) {
  const rows = readFileSync(path, 'utf8').trim().split(/\n/).map((line) => {
    const [fullPath, title, nodeToken, objToken, objType, nodeType, hasChild] = line.split('\t');
    const relativePath = fullPath.replace(/^Cloud Docs > /, '');
    return {
      fullPath,
      path: relativePath,
      title,
      node_token: nodeToken,
      obj_token: objToken,
      obj_type: objType,
      node_type: nodeType,
      has_child: hasChild === 'true',
      depth: relativePath.split(' > ').length,
    };
  });
  const byNode = new Map(rows.map((row) => [row.node_token, row]));
  return {
    children(nodeToken) {
      const parent = byNode.get(nodeToken);
      if (!parent) throw new Error(`source node not found in TSV: ${nodeToken}`);
      return rows.filter((row) => row.depth === parent.depth + 1 && row.path.startsWith(`${parent.path} > `));
    },
    descendants(nodeToken) {
      const parent = byNode.get(nodeToken);
      if (!parent) throw new Error(`source node not found in TSV: ${nodeToken}`);
      return rows.filter((row) => row.path.startsWith(`${parent.path} > `));
    },
    originForObjToken(objToken) {
      return rows.find((row) => row.obj_token === objToken && row.node_type === 'origin') ?? null;
    },
  };
}

function listChildren(nodeToken) {
  const raw = execFileSync('lark-cli', [
    'wiki', '+node-list',
    '--space-id', TARGET_SPACE_ID,
    '--parent-node-token', nodeToken,
    '--as', 'user',
    '--format', 'json',
  ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const payload = parsePayload(raw);
  if (!payload.ok) throw new Error(`node-list failed for ${nodeToken}: ${payload.error?.message ?? raw}`);
  return (payload.data?.nodes ?? []).map(normalizeNode);
}

function copyNode(source, targetParentNodeToken) {
  const nodeToCopy = source.node_type === 'shortcut'
    ? sourceIndex.originForObjToken(source.obj_token) ?? source
    : source;
  const raw = execFileSync('lark-cli', [
    'wiki', '+node-copy',
    '--space-id', SOURCE_SPACE_ID,
    '--node-token', nodeToCopy.node_token,
    '--target-parent-node-token', targetParentNodeToken,
    '--as', 'user',
    '--yes',
    '--format', 'json',
  ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const payload = parsePayload(raw);
  if (payload.ok === false) {
    throw new Error(`node-copy failed for ${source.node_token} using ${nodeToCopy.node_token}: ${payload.error?.message ?? raw}`);
  }
  const node = payload.data?.node ?? payload.data ?? payload;
  if (!node.node_token) throw new Error(`node-copy returned no node token for ${sourceNodeToken}: ${raw}`);
  return normalizeNode(node);
}

function normalizeNode(node) {
  return {
    has_child: Boolean(node.has_child),
    node_token: node.node_token,
    node_type: node.node_type,
    obj_token: node.obj_token,
    obj_type: node.obj_type,
    parent_node_token: node.parent_node_token,
    space_id: node.space_id,
    title: node.title,
  };
}

function dryRunTarget(source, targetParent) {
  return {
    has_child: false,
    node_token: `DRY_RUN_${source.node_token}`,
    node_type: source.node_type,
    obj_token: `DRY_RUN_${source.obj_token}`,
    obj_type: source.obj_type,
    parent_node_token: targetParent.node_token,
    space_id: TARGET_SPACE_ID,
    title: source.title,
  };
}

function mapEntry(source, target) {
  return {
    status: 'synced',
    section: SECTION,
    sync_scope: 'node_copy',
    source: {
      path: source.path,
      title: source.title,
      node_token: source.node_token,
      obj_token: source.obj_token,
      obj_type: source.obj_type,
      node_type: source.node_type,
    },
    target,
  };
}

function upsertMappings(file, entries) {
  const byKey = new Map(file.mappings.map((entry, index) => [`${entry.source?.node_token ?? ''}->${entry.target?.node_token ?? ''}`, index]));
  for (const entry of entries) {
    const key = `${entry.source.node_token}->${entry.target.node_token}`;
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, file.mappings.length);
      file.mappings.push(entry);
    } else {
      file.mappings[existing] = { ...file.mappings[existing], ...entry };
    }
  }
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

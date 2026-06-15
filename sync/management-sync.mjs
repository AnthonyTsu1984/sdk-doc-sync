#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import * as cheerio from 'cheerio';

const SOURCE_SPACE_ID = '7167193056431783939';
const TARGET_SPACE_ID = '7167193056431783939';
const SECTION = 'Management';

const args = parseArgs(process.argv.slice(2));
const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const mapPath = resolve(repoRoot, args.map ?? 'sync/wiki-node-map.json');
const outputPath = resolve(repoRoot, args.output ?? 'tmp/wiki-sync/management-sync-report.json');
const sourceTreePath = resolve(repoRoot, args.sourceTree ?? 'tmp/wiki-sync/source-expanded.tsv');

const managementRoot = {
  title: 'Management',
  node_token: 'R8muwjMZ9iCxX2kLXlZcz3Van2f',
  obj_token: 'N2VDdKzqboO934xrLYZcP4tVnId',
  obj_type: 'docx',
  node_type: 'origin',
};

const contentRoots = [
  {
    source: sourceNode('Organizations', 'Dh6vwCrzYimC7skvDRUcvPi4n2c', 'DmWyd8L8poKNGJxEn19cERZOnPe', 'Organizations'),
    target: targetNode('Organizations', 'BxOXw5VrkiJGoHknGEEc5C2cn4f', 'XzNkd32yvokaZ5xjf7Vc1XI3nx3', 'Management > Organizations'),
  },
  {
    source: sourceNode('Projects', 'QHzrwVlEOipspAkPiyucWezqneC', 'OSLXdUf2woTYrOxgxKDcsEN1n2b', 'Projects'),
    target: targetNode('Projects', 'TGR3w3nyXiYFTvkUUTfcsmqanWg', 'HraOd2zlMoEQRWxN3mTccj9anxb', 'Management > Projects'),
  },
  {
    source: sourceNode('Serving Cluster', 'BIy4we6qXiq8NpkHfXgcxuONngb', 'OUfrdK4rNooZfaxAS7UcgzT8nob', 'Serving Cluster'),
    target: targetNode('Clusters', 'L8fuwpmhoiMgmlkw1jbc93yznxb', 'H2FzdKzGroKHiFxDVc2clqbgncg', 'Management > Clusters'),
  },
];

const stubRoots = [
  stub('Backup & Restore', 'VvikwOKc9iZ5vBkgMnycrXKmnId', 'FFTud7thDozYYCx0TUOc6Mdonvd', 'NEtBw4yrxiBjvCktmoQcWFEsnAe', 'NzwOdiHPpok6ZrxFle1cYKiZn4b'),
  stub('Migrations', 'IeNswy8ySiutKAkdphRc4lfynsf', 'KaULdTsvsoMd3OxatWac19hunwh', 'WbhpwFQvwilzVCkz6MacX8E7nIf', 'DaU2dobpBoXPTaxwOw4cY65hnMc'),
  stub('Metrics & Alerts', 'Xma9w6Ne9ihcsZkFkSmcHidEnZg', 'HFDXdyQ3KoMgntx2uBucKBLpn2f', 'VisuwtCdJil7FWkN5afc969vnSb', 'NE4SdC4YgoAxOMxtSe9cBR8rnJb'),
  stub('Access Control', 'UEFXwAUL4icMjMkUej9cqncJncd', 'F2hadnoauoqZxDxCELlcHW6Eni7', 'Ov0FwEVpmi7RUfk9uSBcljSMnuf', 'XReCdD3uhoOVb7xvYzBciChUn1b', 'Security > Access Control'),
  stub('Audit Logs', 'UfGkwPQIPiJi6OkEu47cH3Umnvb', 'EMSkdGrKsoRpTAxQXCocjpHmndw', 'EXpEwxFtUi2VeKkPE6YcomYXngf', 'Pgxcdw4DroOQ2GxgQUccd2XOn4f', 'Security > Auditing Logs', 'Auditing Logs'),
  stub('Access Logs', 'VEdBwligrip5h7k4JQHcz58snmb', 'TgVMdPF7eosW1cxtJjFcmbP5nmb', 'URCQwkQr6iNE9HkXo0LclrTHnng', 'Fjy2d8aI6oV2PJxXctZcU7kpn17', 'Security > Access Logs'),
  stub('Customer-Managed Encryption Keys', 'GLxhwO5vWiWkTBkoNCPcg4ahnbe', 'QHPsdJ4UkoxpdTxt6S1clHqsnuf', 'ChYVwGhTliXKLVkMchXc8800nLe', 'B2SZdTVSNoQlBHxILIhcDnVyn5b', 'Security > Customer-Managed Encryption Keys'),
  stub('Billing Management', 'FmkCwm1QHitB7uk9U9ncLnHrnse', 'T1JedzGx9oVUcpxdjX7c6SmanqX', 'IP60whfmIiHqwxkNuuccuRfvnlf', 'LZOZduKU4ojL8LxuqsqcvkJEnre'),
  stub('Cost Management', 'XGmzwSmM0imGGYkqsCucdSy7nEf', 'QDEJdKgv7oX0Eixk2BycxSZhnsl', 'CT1FwNAx6iPtOFkZJkNcqhJWnEA', 'KlmNdhMTqovUB1xTEeUc8bbnnS7'),
  stub('Zilliz Cloud Limits', 'PuxkwMWvbiHxvTkHsVkcMZP9n5f', 'NIIldYshaoVw2bxiWjrcTt14nac', 'JSo2wh9A6iomi9k0oC0clYEwnbh', 'Ag5SdNg6vo9N4ZxiOBEcV9HwnSc', 'Limits & Restrictions > Zilliz Cloud Limits'),
  stub('API Availability', 'DAk8w3GCJiuUTTkms6IcMtnAnMf', 'NBPSdPSgsohOoxx0qIjcIogmnsd', 'Co97wuQC3ilC5NkIyMqcYQAUnwb', 'Bzt3dZlvRofRyMxitLbcER0qnMb', 'Limits & Restrictions > API Availability'),
  stub('FAQs', 'EV41wG08BiOWW8kbo9xcTGoPnKd', 'Ly6BdqdNooKWDhxejD8ckxaZnah', 'LB8kwdMKviHa1IkhABXcFKpDnEh', 'WtCEd7lR9oksmPxNSJHcaL1KnIf'),
];

const sourceIndex = readSourceTree(sourceTreePath);
const mappingFile = JSON.parse(readFileSync(mapPath, 'utf8'));
const plannedMappings = [
  mapEntry('content', contentRoots[0]),
  mapEntry('content', contentRoots[1]),
  mapEntry('content', contentRoots[2]),
  ...stubRoots.map((pair) => mapEntry('category_stub', pair)),
];
const copiedMappings = [];
const copiedRoots = [];
const report = {
  generated_at: new Date().toISOString(),
  mode: args.apply ? 'apply' : 'dry-run',
  management_root: managementRoot,
  content_roots: contentRoots,
  stub_roots: stubRoots.map((pair) => ({
    ...pair,
    source_child_count: sourceChildren(pair.source.node_token).length,
  })),
  copied_roots: copiedRoots,
  copied_mappings: copiedMappings,
  totals: {
    content_overwrites: 0,
    stub_overwrites: 0,
    source_child_nodes_to_copy: 0,
    node_copy_requests: 0,
    copied_mapping_entries: 0,
    map_entries_added: 0,
    errors: 0,
  },
  errors: [],
};

try {
  for (const pair of stubRoots) {
    const children = sourceChildren(pair.source.node_token);
    report.totals.source_child_nodes_to_copy += children.length;

    if (args.apply) overwriteDoc(pair.target.obj_token, `<title>${escapeXml(pair.target.title)}</title>`);
    report.totals.stub_overwrites += 1;

    for (const child of children) {
      report.totals.node_copy_requests += 1;
      if (!args.apply) {
        copiedRoots.push({
          status: 'dry-run',
          source_parent: pair.source,
          target_parent: pair.target,
          source_child: child,
        });
        continue;
      }

      const copied = copyNode(child.node_token, pair.target.node_token);
      copiedRoots.push({
        status: 'copied',
        source_parent: pair.source,
        target_parent: pair.target,
        source_child: child,
        copied,
      });

      const sourceSubtree = sourceIndex.subtree(child.node_token);
      const targetSubtree = listSubtree(copied.node_token, `${pair.target.path} > ${copied.title}`);
      copiedMappings.push(...matchCopiedSubtree(sourceSubtree, targetSubtree, pair.target.path));
    }
  }

  const replacements = buildTokenReplacements(mappingFile, [...plannedMappings, ...copiedMappings]);
  for (const pair of contentRoots) {
    if (args.apply) {
      const sourceXml = fetchXml(pair.source.obj_token);
      const targetXml = fetchXml(pair.target.obj_token);
      const rewritten = rewriteTokens(replaceTitle(sourceXml, extractTitleXml(targetXml)), replacements);
      overwriteDoc(pair.target.obj_token, rewritten);
    }
    report.totals.content_overwrites += 1;
  }

  if (args.apply) {
    const before = mappingFile.mappings.length;
    upsertMappings(mappingFile, [...plannedMappings, ...copiedMappings]);
    mappingFile.updated_at = new Date().toISOString();
    writeFileSync(mapPath, `${JSON.stringify(mappingFile, null, 2)}\n`);
    report.totals.map_entries_added = mappingFile.mappings.length - before;
  }
  report.totals.copied_mapping_entries = copiedMappings.length;
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

function sourceNode(title, nodeToken, objToken, path = title, sourceTitle = title) {
  return {
    path,
    title: sourceTitle,
    node_token: nodeToken,
    obj_token: objToken,
    obj_type: 'docx',
    node_type: 'origin',
  };
}

function targetNode(title, nodeToken, objToken, path) {
  return {
    path,
    title,
    node_token: nodeToken,
    obj_token: objToken,
    obj_type: 'docx',
    node_type: 'origin',
  };
}

function stub(targetTitle, sourceNodeToken, sourceObjToken, targetNodeToken, targetObjToken, sourcePath = targetTitle, sourceTitle = targetTitle) {
  return {
    source: sourceNode(sourceTitle, sourceNodeToken, sourceObjToken, sourcePath, sourceTitle),
    target: targetNode(targetTitle, targetNodeToken, targetObjToken, `Management > ${targetTitle}`),
  };
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
    byNode,
    children(nodeToken) {
      const parent = byNode.get(nodeToken);
      if (!parent) throw new Error(`source node not found in TSV: ${nodeToken}`);
      return rows.filter((row) => {
        if (row.depth !== parent.depth + 1) return false;
        return row.path.startsWith(`${parent.path} > `);
      });
    },
    subtree(nodeToken) {
      const root = byNode.get(nodeToken);
      if (!root) throw new Error(`source node not found in TSV: ${nodeToken}`);
      return rows.filter((row) => row.node_token === nodeToken || row.path.startsWith(`${root.path} > `));
    },
  };
}

function sourceChildren(nodeToken) {
  return sourceIndex.children(nodeToken);
}

function fetchXml(docToken) {
  const raw = execFileSync('lark-cli', [
    'docs', '+fetch', '--api-version', 'v2', '--as', 'user', '--doc', docToken,
    '--doc-format', 'xml', '--detail', 'full', '--format', 'json',
  ], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  const payload = parsePayload(raw);
  if (!payload.ok) throw new Error(`fetch XML failed for ${docToken}: ${payload.error?.message ?? raw}`);
  return payload.data.document.content;
}

function overwriteDoc(docToken, xml) {
  const raw = execFileSync('lark-cli', [
    'docs', '+update', '--api-version', 'v2', '--as', 'user', '--doc', docToken,
    '--command', 'overwrite', '--content', xml, '--format', 'json',
  ], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  const payload = parsePayload(raw);
  if (!payload.ok) throw new Error(`overwrite failed for ${docToken}: ${payload.error?.message ?? raw}`);
}

function copyNode(sourceNodeToken, targetParentNodeToken) {
  const raw = execFileSync('lark-cli', [
    'wiki', '+node-copy',
    '--space-id', SOURCE_SPACE_ID,
    '--node-token', sourceNodeToken,
    '--target-parent-node-token', targetParentNodeToken,
    '--as', 'user',
    '--yes',
    '--format', 'json',
  ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const payload = parsePayload(raw);
  if (payload.ok === false) throw new Error(`node-copy failed for ${sourceNodeToken}: ${payload.error?.message ?? raw}`);
  const node = payload.data?.node ?? payload.data ?? payload;
  if (!node.node_token) throw new Error(`node-copy returned no node token for ${sourceNodeToken}: ${raw}`);
  return normalizeNode(node);
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

function listSubtree(rootNodeToken, rootPath) {
  const rootChildren = [];
  const root = { node_token: rootNodeToken, path: rootPath };
  const stack = [root];
  const rows = [];
  while (stack.length > 0) {
    const current = stack.pop();
    const children = listChildren(current.node_token);
    if (current === root) rootChildren.push(...children);
    for (const child of children.reverse()) {
      const row = { ...child, path: `${current.path} > ${child.title}` };
      rows.push(row);
      if (child.has_child) stack.push(row);
    }
  }
  const rootNode = copiedRoots.at(-1)?.copied;
  return [
    ...(rootNode ? [{ ...rootNode, path: rootPath }] : []),
    ...rows,
  ];
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

function matchCopiedSubtree(sourceSubtree, targetSubtree, targetParentPath) {
  const sourceRoot = sourceSubtree[0];
  const targetByRelPath = new Map(targetSubtree.map((target) => {
    const rel = target.path.replace(`${targetParentPath} > `, '');
    return [rel, target];
  }));
  const mappings = [];
  for (const source of sourceSubtree) {
    const rel = source.path.replace(`${sourceRoot.path}`, sourceRoot.title);
    const target = targetByRelPath.get(rel);
    if (!target) {
      report.errors.push(`copied target not found for source relative path: ${rel}`);
      continue;
    }
    mappings.push(mapEntry('node_copy', {
      source: {
        path: source.path,
        title: source.title,
        node_token: source.node_token,
        obj_token: source.obj_token,
        obj_type: source.obj_type,
        node_type: source.node_type,
      },
      target: {
        path: target.path,
        title: target.title,
        node_token: target.node_token,
        obj_token: target.obj_token,
        obj_type: target.obj_type,
        node_type: target.node_type,
      },
    }));
  }
  return mappings;
}

function mapEntry(syncScope, pair) {
  return {
    status: 'synced',
    section: SECTION,
    sync_scope: syncScope,
    source: pair.source,
    target: pair.target,
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

function buildTokenReplacements(file, extraMappings) {
  const pairs = [];
  for (const mapping of [...file.mappings, ...extraMappings]) {
    if (mapping.source?.node_token && mapping.target?.node_token) pairs.push([mapping.source.node_token, mapping.target.node_token]);
    if (mapping.source?.obj_token && mapping.target?.obj_token) pairs.push([mapping.source.obj_token, mapping.target.obj_token]);
  }
  return pairs;
}

function rewriteTokens(xml, replacements) {
  let output = xml;
  for (const [from, to] of replacements) output = output.split(from).join(to);
  return output;
}

function replaceTitle(sourceXml, targetTitleXml) {
  const $ = cheerio.load(`<root>${sourceXml}</root>`, { xmlMode: true, decodeEntities: false });
  const title = $('root').children('title').first();
  if (title.length) title.replaceWith(targetTitleXml);
  else $('root').prepend(targetTitleXml);
  return $('root').children().toArray().map((node) => $.xml(node)).join('');
}

function extractTitleXml(xml) {
  const $ = cheerio.load(`<root>${xml}</root>`, { xmlMode: true, decodeEntities: false });
  const title = $('root').children('title').first();
  return title.length ? $.xml(title[0]) : '<title></title>';
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

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

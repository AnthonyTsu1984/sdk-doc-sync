#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

function usage() {
  console.log('Usage: compare-scan-artifacts <artifact-a.json> <artifact-b.json> [--json]');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function actionsFrom(artifact) {
  const rows = artifact.actions || artifact.diff || [];
  return rows.map((row) => ({
    key: row.stableId || `${row.type || row.diffAction}:${row.symbol || row.slug}`,
    type: row.type || row.diffAction || '',
    symbol: row.symbol || '',
    slug: row.canonicalSlug || row.slug || '',
    reason: row.reason || '',
    source: row.source || null,
    evidence: row.evidence || [],
  }));
}

function countBy(rows, field) {
  const counts = {};
  for (const row of rows) {
    const key = row[field] || '';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function mapByKey(rows) {
  const map = new Map();
  for (const row of rows) map.set(row.key, row);
  return map;
}

function duplicateKeys(rows) {
  const counts = {};
  for (const row of rows) counts[row.key] = (counts[row.key] || 0) + 1;
  return Object.entries(counts)
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function comparableAction(row) {
  return stableJson({
    type: row.type,
    symbol: row.symbol,
    slug: row.slug,
    reason: row.reason,
    source: row.source,
    evidence: row.evidence,
  });
}

function planningErrorsFrom(artifact) {
  return (artifact.planningErrors || []).map((error) => ({
    key: `${error.stableId || ''}:${error.diffAction || ''}:${error.code || ''}`,
    stableId: error.stableId || '',
    diffAction: error.diffAction || '',
    code: error.code || '',
  }));
}

function compare(a, b) {
  const aActions = actionsFrom(a);
  const bActions = actionsFrom(b);
  const aPlanningErrors = planningErrorsFrom(a);
  const bPlanningErrors = planningErrorsFrom(b);
  const aMap = mapByKey(aActions);
  const bMap = mapByKey(bActions);
  const aPlanningErrorMap = mapByKey(aPlanningErrors);
  const bPlanningErrorMap = mapByKey(bPlanningErrors);
  const shared = [];
  const changed = [];
  const onlyA = [];
  const onlyB = [];

  for (const row of aActions) {
    const other = bMap.get(row.key);
    if (!other) {
      onlyA.push(row);
      continue;
    }
    if (comparableAction(row) === comparableAction(other)) {
      shared.push(row);
    } else {
      changed.push({ a: row, b: other });
    }
  }
  for (const row of bActions) {
    if (!aMap.has(row.key)) onlyB.push(row);
  }

  return {
    a: {
      releaseScope: a.releaseScope || {
        baselineTag: a.baselineTag,
        targetTag: a.targetTag,
        releaseRange: a.releaseRange,
      },
      count: aActions.length,
      uniqueCount: aMap.size,
      duplicateKeys: duplicateKeys(aActions),
      countsByType: countBy(aActions, 'type'),
      planningErrorCount: aPlanningErrors.length,
      planningErrorCodes: countBy(aPlanningErrors, 'code'),
    },
    b: {
      releaseScope: b.releaseScope || {
        baselineTag: b.baselineTag,
        targetTag: b.targetTag,
        releaseRange: b.releaseRange,
      },
      count: bActions.length,
      uniqueCount: bMap.size,
      duplicateKeys: duplicateKeys(bActions),
      countsByType: countBy(bActions, 'type'),
      planningErrorCount: bPlanningErrors.length,
      planningErrorCodes: countBy(bPlanningErrors, 'code'),
    },
    sharedCount: shared.length,
    changedCount: changed.length,
    onlyACount: onlyA.length,
    onlyBCount: onlyB.length,
    onlyA,
    onlyB,
    changed,
    planningErrorsChanged: stableJson([...aPlanningErrorMap.keys()].sort()) !== stableJson([...bPlanningErrorMap.keys()].sort()),
  };
}

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.length < 2) {
    usage();
    return args.includes('--help') ? 0 : 1;
  }
  const json = args.includes('--json');
  const files = args.filter((arg) => arg !== '--json');
  const result = compare(readJson(files[0]), readJson(files[1]));
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  console.log(`A: ${files[0]} (${result.a.count} actions)`);
  console.log(`B: ${files[1]} (${result.b.count} actions)`);
  if (result.a.duplicateKeys.length || result.b.duplicateKeys.length) {
    console.log(`Unique keys: A=${result.a.uniqueCount}, B=${result.b.uniqueCount}`);
  }
  if (result.a.planningErrorCount || result.b.planningErrorCount) {
    console.log(`Planning errors: A=${result.a.planningErrorCount}, B=${result.b.planningErrorCount}`);
  }
  console.log(`Shared: ${result.sharedCount}`);
  console.log(`Changed: ${result.changedCount}`);
  console.log(`Only in A: ${result.onlyACount}`);
  console.log(`Only in B: ${result.onlyBCount}`);
  if (result.planningErrorsChanged) {
    console.log('Planning error sets changed');
  }
  if (result.a.duplicateKeys.length) {
    console.log(`Duplicate keys in A: ${result.a.duplicateKeys.length}`);
  }
  if (result.b.duplicateKeys.length) {
    console.log(`Duplicate keys in B: ${result.b.duplicateKeys.length}`);
  }
  if (result.onlyA.length || result.onlyB.length || result.changed.length) {
    console.log('');
    for (const row of result.onlyA) console.log(`- only A: ${row.type} ${row.symbol || row.slug}`);
    for (const row of result.onlyB) console.log(`- only B: ${row.type} ${row.symbol || row.slug}`);
    for (const row of result.changed) {
      console.log(`- changed: ${row.a.key} (${row.a.type}/${row.a.slug} -> ${row.b.type}/${row.b.slug})`);
    }
  }
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv);

module.exports = { actionsFrom, compare };

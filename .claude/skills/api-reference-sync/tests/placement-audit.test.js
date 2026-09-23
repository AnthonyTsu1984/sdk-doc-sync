'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseAdjacentBitable,
  parseArgs,
  parseBitableTarget,
  resolveRegistryContext,
} = require('../scripts/build-current-placement-audit');

test('placement audit CLI parses adjacent Bitable targets', () => {
  assert.deepEqual(parseAdjacentBitable('v2.6.x:base-v26'), {
    version: 'v2.6.x',
    baseToken: 'base-v26',
    tableId: null,
  });
  assert.deepEqual(parseAdjacentBitable('v2.6.x:base-v26:table-1'), {
    version: 'v2.6.x',
    baseToken: 'base-v26',
    tableId: 'table-1',
  });
  assert.throws(() => parseAdjacentBitable('base-only'), /--adjacent-bitable/);
  assert.deepEqual(parseBitableTarget('base-v30'), { baseToken: 'base-v30', tableId: null });
  assert.throws(() => parseBitableTarget('a:b:c'), /Bitable target/);
});

test('placement audit CLI accepts registry arguments and repeatable track flags', () => {
  const args = parseArgs([
    'node', 'build-current-placement-audit.js',
    '--proposal', '/tmp/proposal.json',
    '--version', 'v3.0.x',
    '--output', '/tmp/audit.json',
    '--language', 'cpp',
    '--registry', '/tmp/registry.json',
    '--adjacent-bitable', 'v2.6.x:base-v26',
    '--adjacent-bitable', 'v2.5.x:base-v25:table-2',
  ]);
  assert.equal(args.language, 'cpp');
  assert.equal(args.registry, '/tmp/registry.json');
  assert.equal(args.versionRoot, undefined);
  assert.deepEqual(args.adjacentBitables, ['v2.6.x:base-v26', 'v2.5.x:base-v25:table-2']);

  assert.throws(
    () => parseArgs(['node', 'script', '--proposal', 'p.json', '--version', 'v3.0.x']),
    /Missing --output/,
  );
});

test('registry context resolves cpp release roots and full cross-track enumeration', () => {
  const resolved = resolveRegistryContext({
    args: { language: 'cpp' },
    version: 'v3.0.x',
  });

  assert.deepEqual(resolved.targetBitable, {
    version: 'v3.0.x',
    baseToken: 'QdLkbfmnFatl4TsThKDc5Dobn5g',
    tableId: null,
  });
  assert.equal(resolved.targetRoot, 'NVjgfJr5aleBsedDoKCcDpnJn9b');
  // Only older tracks can physically hold inherited documents.
  assert.deepEqual(resolved.sourceVersionRoots, [{
    version: 'v2.6.x',
    rootToken: 'CSzVfDgfAlne87dDj3vcnR3nnsg',
  }]);
  // Every other track is enumerated for record pointers in both directions.
  assert.deepEqual(resolved.adjacentBitables, [{
    version: 'v2.6.x',
    baseToken: 'XmndbkxkQaigA8soRiCcTT41nMd',
    tableId: null,
  }]);
});

test('registry context resolves the older cpp track without newer-tree roots', () => {
  const resolved = resolveRegistryContext({
    args: { language: 'cpp' },
    version: 'v2.6.x',
  });

  assert.equal(resolved.targetRoot, 'CSzVfDgfAlne87dDj3vcnR3nnsg');
  assert.deepEqual(resolved.sourceVersionRoots, []);
  assert.deepEqual(
    resolved.adjacentBitables.map((track) => track.version),
    ['v3.0.x'],
  );
});

test('registry context fails closed for unregistered tracks', () => {
  assert.throws(
    () => resolveRegistryContext({ args: { language: 'cpp' }, version: 'v9.9.x' }),
    (error) => error.code === 'TRACK_REGISTRY_TRACK_NOT_REGISTERED',
  );
  assert.throws(
    () => resolveRegistryContext({ args: { language: 'rust' }, version: 'v1.0.x' }),
    (error) => error.code === 'TRACK_REGISTRY_LANGUAGE_NOT_REGISTERED',
  );
});

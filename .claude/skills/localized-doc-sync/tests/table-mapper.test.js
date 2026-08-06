'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { mapTables } = require('../src/table-mapper');

test('dynamic table mapping covers every discovered table and treats Deployment generically', () => {
  const sourceTables = [
    { tableId: 'deployment', name: 'Deployment' },
    { tableId: 'development', name: 'Development' },
  ];
  const targetTables = [
    { tableId: 'zh-development', name: '开发指南' },
    { tableId: 'legacy', name: 'Legacy' },
  ];
  const result = mapTables({
    sourceTables,
    targetTables,
    policy: {
      mappings: [
        { relation: 'mapped', sourceTableId: 'development', targetTableId: 'zh-development', provenance: 'reviewed:1' },
        { relation: 'source-only', sourceTableId: 'deployment', provenance: 'reviewed:2', revalidateAfter: '2026-12-01' },
        { relation: 'target-only', targetTableId: 'legacy', provenance: 'reviewed:3' },
      ],
    },
  });
  assert.deepEqual(result.mappings.map((mapping) => mapping.relation).sort(), ['mapped', 'source-only', 'target-only']);
  assert.equal(result.issues.length, 0);

  const unresolved = mapTables({ sourceTables, targetTables, policy: { mappings: [] } });
  assert.equal(unresolved.issues.filter((issue) => issue.code === 'UNMAPPED_TABLE').length, 4);
  assert.equal(unresolved.mappings.some((mapping) => mapping.sourceTableId === 'deployment' && mapping.relation === 'source-only'), false);
});

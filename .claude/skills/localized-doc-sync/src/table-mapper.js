'use strict';

const { digestSemantic } = require('../../doc-ops-core/src/digest');

const RELATIONS = new Set(['mapped', 'source-only', 'target-only', 'split', 'merged', 'ignored-by-policy', 'unresolved']);

function mapTables({ sourceTables = [], targetTables = [], policy = {} }) {
  const sourceIds = new Set(sourceTables.map((table) => table.tableId));
  const targetIds = new Set(targetTables.map((table) => table.tableId));
  const coveredSource = new Set();
  const coveredTarget = new Set();
  const issues = [];
  const mappings = [];
  for (const rule of policy.mappings || []) {
    if (!RELATIONS.has(rule.relation)) throw new Error(`Unsupported table relation: ${rule.relation}`);
    const sourceTableIds = [...new Set([...(rule.sourceTableIds || []), rule.sourceTableId].filter(Boolean))].sort();
    const targetTableIds = [...new Set([...(rule.targetTableIds || []), rule.targetTableId].filter(Boolean))].sort();
    const missing = [
      ...sourceTableIds.filter((id) => !sourceIds.has(id)),
      ...targetTableIds.filter((id) => !targetIds.has(id)),
    ];
    if (missing.length) {
      issues.push({ code: 'TABLE_MISSING', relation: rule.relation, tableIds: missing, blocking: true });
      continue;
    }
    sourceTableIds.forEach((id) => coveredSource.add(id));
    targetTableIds.forEach((id) => coveredTarget.add(id));
    const semantic = {
      relation: rule.relation,
      sourceTableIds,
      targetTableIds,
      provenance: rule.provenance || null,
      revalidateAfter: rule.revalidateAfter || null,
    };
    mappings.push({ mappingId: `table-map:${digestSemantic(semantic).slice(7, 23)}`, ...semantic });
  }
  for (const table of sourceTables.filter((item) => !coveredSource.has(item.tableId))) {
    issues.push({ code: 'UNMAPPED_TABLE', side: 'source', tableId: table.tableId, tableName: table.name, blocking: true });
  }
  for (const table of targetTables.filter((item) => !coveredTarget.has(item.tableId))) {
    issues.push({ code: 'UNMAPPED_TABLE', side: 'target', tableId: table.tableId, tableName: table.name, blocking: true });
  }
  mappings.sort((a, b) => a.mappingId.localeCompare(b.mappingId));
  issues.sort((a, b) => a.code.localeCompare(b.code) || String(a.tableId || '').localeCompare(String(b.tableId || '')));
  return { mappings, issues };
}

module.exports = { RELATIONS, mapTables };

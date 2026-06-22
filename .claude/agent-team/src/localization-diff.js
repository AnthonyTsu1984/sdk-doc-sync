const TranslationDiff = require('../../skills/sdk-doc-sync/src/feishu-doc-translator/translation-diff');

function normalizeSummary(actions) {
  return actions.reduce((summary, action) => {
    summary.total += 1;
    summary[action.type] = (summary[action.type] || 0) + 1;
    return summary;
  }, { total: 0, NEW: 0, UPDATE: 0, META_ONLY: 0, SKIP: 0, ORPHAN: 0 });
}

function classifyMetaOnly(actions) {
  return actions.map((action) => {
    const tableScopedAction = {
      ...action,
      sourceTableId: action.sourceTableId || action.source?.sourceTableId || action.target?.sourceTableId,
      targetTableId: action.targetTableId || action.source?.targetTableId || action.target?.targetTableId,
    };
    if (tableScopedAction.type !== 'UPDATE') return tableScopedAction;
    const reason = tableScopedAction.reason || '';
    if (/deprecated since|source deprecated/i.test(reason)) {
      return { ...tableScopedAction, type: 'META_ONLY', reason };
    }
    return tableScopedAction;
  });
}

async function readLocalizationRecords(config) {
  const BitableReader = require('../../skills/sdk-doc-sync/src/feishu-doc-translator/bitable-reader');
  const localization = config.surfaces.localization;
  const pairs = localization.sourceTableIds.map((sourceTableId, index) => ({
    sourceTableId,
    targetTableId: localization.targetTableIds[index],
  }));
  const tableResults = await Promise.all(pairs.map(async pair => {
    const sourceReader = new BitableReader({
      baseToken: localization.sourceBaseToken,
      tableId: pair.sourceTableId,
    });
    const targetReader = new BitableReader({
      baseToken: localization.targetBaseToken,
      tableId: pair.targetTableId,
    });
    const [sourceRecords, targetRecords] = await Promise.all([
      sourceReader.listRecords(),
      targetReader.listRecords(),
    ]);
    return {
      ...pair,
      sourceRecords: sourceRecords.map(record => ({ ...record, sourceTableId: pair.sourceTableId, targetTableId: pair.targetTableId })),
      targetRecords: targetRecords.map(record => ({ ...record, sourceTableId: pair.sourceTableId, targetTableId: pair.targetTableId })),
    };
  }));
  return {
    tableResults,
    sourceRecords: tableResults.flatMap(result => result.sourceRecords),
    targetRecords: tableResults.flatMap(result => result.targetRecords),
  };
}

function diffOneTablePair(sourceRecords, targetRecords) {
  const diff = new TranslationDiff({ strict: true });
  return classifyMetaOnly(diff.diff(sourceRecords, targetRecords));
}

function diffLocalizationRecords(sourceRecordsOrReadResult, targetRecords = null) {
  const actions = sourceRecordsOrReadResult.tableResults
    ? sourceRecordsOrReadResult.tableResults.flatMap(result => diffOneTablePair(result.sourceRecords, result.targetRecords))
    : diffOneTablePair(sourceRecordsOrReadResult, targetRecords);
  return {
    actions,
    summary: normalizeSummary(actions),
  };
}

module.exports = {
  readLocalizationRecords,
  diffLocalizationRecords,
  diffOneTablePair,
  normalizeSummary,
};

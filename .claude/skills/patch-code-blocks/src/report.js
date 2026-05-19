function formatDryRunReport({ matrix, candidates }) {
  const operations = Array.isArray(matrix) ? matrix.length : Object.keys(matrix || {}).length;

  return {
    mode: 'dry-run',
    summary: {
      operations,
      candidates: (candidates || []).length,
    },
    matrix,
    candidates,
  };
}

function formatApplyReport({ dryRunReport, applySummary, operationResults }) {
  return {
    mode: 'apply',
    summary: {
      ...dryRunReport.summary,
      patched: applySummary.patched,
      skipped: applySummary.skipped,
      failed: applySummary.failed,
    },
    matrix: dryRunReport.matrix,
    operationResults,
  };
}

module.exports = {
  formatDryRunReport,
  formatApplyReport,
};

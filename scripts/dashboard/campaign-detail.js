'use strict';
// Campaign detail builder — batch 5, read-only derivation.
//
// The operator-facing file table (file names first, Feishu links secondary)
// is a deterministic join of two durable artifacts the governed pipeline
// already wrote: the review session (units, acceptance receipts) and the
// release scope (web-content file paths, symbols, change reasons). Join key
// = actions[].stableId ≡ units[].documentStableId. Same tree in, same
// detail out; no writes, no network, nothing persisted.

const fs = require('node:fs');
const path = require('node:path');

const {
  SCAN_STATE_RELATIVE_PATH,
  SESSION_SCAN_ROOTS,
  buildCampaignCard,
  readJsonOrNull,
} = require('./ledger.js');

function toRepoRelative(repoRoot, absolutePath) {
  if (typeof absolutePath !== 'string') return null;
  const resolved = path.resolve(repoRoot, absolutePath);
  const relative = path.relative(repoRoot, resolved);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : null;
}

// Fail-closed: detail is only served for session files the ledger itself
// would discover (inside the scan roots, normal repo-relative form).
function sessionPathAllowed(repoRoot, sessionPath) {
  if (typeof sessionPath !== 'string' || sessionPath.includes('..') || path.isAbsolute(sessionPath)) {
    return false;
  }
  const normalized = sessionPath.split(path.sep).join('/');
  return SESSION_SCAN_ROOTS.some((root) => normalized.startsWith(`${root}/`));
}

function unitStatusOf(session, unit) {
  const accepted = (session.acceptedReviewUnits || []).some((a) => a.reviewUnitId === unit.reviewUnitId);
  if (accepted) return 'accepted';
  const pending = (session.pendingExecutions || []).some((p) => p.reviewUnitId === unit.reviewUnitId);
  if (pending) return 'pending-approval';
  if (session.activeExecution && session.activeExecution.reviewUnitId === unit.reviewUnitId) return 'executing';
  if (session.activeRollback) return 'rolling-back';
  return 'queued';
}

// Build one row per review unit (the approval cadence the operator actually
// gated), plus trailing rows for release-scope PR files no unit covers.
function buildFileRows(session, releaseScope) {
  const actions = Array.isArray(releaseScope?.actions) ? releaseScope.actions : [];
  const byStableId = new Map(actions.map((a) => [a.stableId, a]));
  const acceptedByUnit = new Map(
    (Array.isArray(session.acceptedReviewUnits) ? session.acceptedReviewUnits : [])
      .map((a) => [a.reviewUnitId, a]),
  );
  const rows = [];
  for (const unit of session.reviewUnitManifest?.units || []) {
    const action = byStableId.get(unit.documentStableId) || null;
    const prInfo = action?.pr || null;
    const receipt = acceptedByUnit.get(unit.reviewUnitId) || null;
    rows.push({
      unitId: unit.reviewUnitId,
      stableId: unit.documentStableId,
      status: unitStatusOf(session, unit),
      // web-content path is the operator-readable name; basename for the
      // table, full path for the tooltip.
      filePath: prInfo?.path || null,
      fileName: prInfo?.path ? path.posix.basename(prInfo.path) : null,
      symbol: action?.symbol || prInfo?.symbol || null,
      changeType: prInfo?.changeType || action?.type || null,
      reason: action?.reason || (Array.isArray(action?.reasons) ? action.reasons[0] : null) || null,
      sourcePr: typeof prInfo?.number === 'number' ? prInfo.number : null,
      sourceLocator: action?.source?.file
        ? `${action.source.file}${action.source.line ? ':' + action.source.line : ''}`
        : null,
      acceptedAt: receipt?.acceptedAt || null,
      documentLinks: receipt?.documentLinks || [],
      recordLinks: receipt?.recordLinks || [],
    });
  }
  // Release-scope PR files with no unit (e.g. secondary/suffixed pages) —
  // listed honestly as 未入组 rather than silently dropped.
  const covered = new Set(rows.map((r) => r.filePath).filter(Boolean));
  const orphans = (releaseScope?.pr?.files || []).filter((f) => !covered.has(f.path));
  for (const file of orphans) {
    rows.push({
      unitId: null,
      stableId: null,
      status: 'ungrouped',
      filePath: file.path || null,
      fileName: file.path ? path.posix.basename(file.path) : null,
      symbol: file.symbol || null,
      changeType: file.changeType || null,
      reason: null,
      sourcePr: null,
      sourceLocator: null,
      acceptedAt: null,
      documentLinks: [],
      recordLinks: [],
    });
  }
  return rows;
}

function buildCampaignDetail({ repoRoot, sessionPath }) {
  if (!repoRoot) throw new Error('buildCampaignDetail requires repoRoot');
  const normalized = typeof sessionPath === 'string' ? sessionPath.split(path.sep).join('/') : sessionPath;
  if (!normalized || !sessionPathAllowed(repoRoot, normalized)) {
    return { ok: false, error: `session path not discoverable: ${sessionPath}` };
  }
  const session = readJsonOrNull(path.join(repoRoot, normalized));
  if (!session || !session.schemaVersion || typeof session.status !== 'string') {
    return { ok: false, error: `not a durable review session: ${normalized}` };
  }
  const scanState = readJsonOrNull(path.join(repoRoot, SCAN_STATE_RELATIVE_PATH));
  const card = buildCampaignCard(repoRoot, normalized, session, scanState);

  const releaseScopeRelative = card.artifacts.releaseScope
    ? card.artifacts.releaseScope
    : null;
  const releaseScope = releaseScopeRelative
    ? readJsonOrNull(path.join(repoRoot, releaseScopeRelative))
    : null;

  const rows = buildFileRows(session, releaseScope);
  const receipts = (session.acceptedReviewUnits || []).map((a) => ({
    unitId: a.reviewUnitId,
    acceptedAt: a.acceptedAt || null,
    finalizedAt: a.finalizedAt || null,
    executionJournalPath: a.executionJournalPath ? toRepoRelative(repoRoot, a.executionJournalPath) : null,
    executionJournalDigest: typeof a.executionJournalDigest === 'string' ? a.executionJournalDigest : null,
    unitReceiptPath: a.unitReceiptPath ? toRepoRelative(repoRoot, a.unitReceiptPath) : null,
  }));

  return {
    ok: true,
    card,
    releaseScopePresent: Boolean(releaseScope),
    scale: {
      units: card.units,
      accepted: card.accepted,
      pending: card.pending,
      actions: Array.isArray(releaseScope?.actions) ? releaseScope.actions.length : null,
      prFiles: Array.isArray(releaseScope?.pr?.files) ? releaseScope.pr.files.length : null,
      changedSdkFiles: Array.isArray(releaseScope?.changedFiles) ? releaseScope.changedFiles.length : null,
      targetTag: releaseScope?.targetTag ?? card.scanState.targetTag,
      baselineTag: releaseScope?.baselineTag ?? null,
    },
    files: rows,
    receipts,
  };
}

module.exports = {
  buildCampaignDetail,
  buildFileRows,
  sessionPathAllowed,
  unitStatusOf,
};

'use strict';

// Batch-14 doorbell: turn the dashboard's aggregated payload into
// operator-actionable notification events and decide which of them actually
// get sent on a sweep. The dashboard keeps no second truth — every event
// derives from fields the cards already show; sending decisions persist to an
// append-only ledger under tmp/dashboard-events/ so a restart neither
// re-spams nor forgets. Pure functions only: the server owns all IO.

const fs = require('node:fs');
const path = require('node:path');

const ROLLBACK_MANIFESTS_RELATIVE_DIR = 'tmp/api-reference-sync/rollback-manifests';

// A rollback gate the session status machine cannot see: the worker planned
// the rollback (manifest on disk) but the wait-for-operator state lives only
// in the worker conversation — the session file has no activeRollback until
// execution. The board therefore derives the gate from the manifest itself:
// pending while the anchored journal still sits in its slot (rollback
// completion byte-archives it away), closed once the slot is released or the
// manifest is cleaned up.
function pendingRollbackGateFor(repoRoot, sessionId, executedManifestDigests = null) {
  if (!repoRoot || !sessionId) return null;
  const dir = path.join(repoRoot, ROLLBACK_MANIFESTS_RELATIVE_DIR);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch {
      continue;
    }
    if (manifest.sessionId !== sessionId) continue;
    // A receipt binding this manifest digest means the rollback already
    // executed — the gate is closed regardless of journal archiving (the
    // supersede path rewrites the slot instead of archiving it).
    if (executedManifestDigests && executedManifestDigests.has(manifest.rollbackManifestDigest)) continue;
    if (!manifest.reviewUnitId || !manifest.rollbackManifestDigest) continue;
    if (typeof manifest.executionJournalPath !== 'string') continue;
    try {
      fs.statSync(manifest.executionJournalPath);
    } catch {
      continue; // anchored journal already archived — rollback completed
    }
    return {
      gate: 'APPROVE_ROLLBACK',
      reviewUnitId: manifest.reviewUnitId,
      digest: manifest.rollbackManifestDigest,
      manifestPath: `${ROLLBACK_MANIFESTS_RELATIVE_DIR}/${name}`,
      source: 'rollback-manifest',
    };
  }
  return null;
}

// Re-notify a still-pending event at most every 2h (dwell escalation).
const ESCALATE_AFTER_MS = 2 * 60 * 60 * 1000;
// Quiet window 22:00–07:59 local: sweeps still record resolve bookkeeping but
// send nothing — unsent events accumulate naturally and land as one merged
// message on the first morning sweep.
const QUIET_START_HOUR = 22;
const QUIET_END_HOUR = 8;
// A dispatched intake worker with no exit record: worth one notification once
// it outlives the 2h in-flight cap, silence after a day (the campaign card or
// a fresh dispatch has superseded it by then).
const LOST_WORKER_MIN_AGE_MS = 2 * 60 * 60 * 1000;
const LOST_WORKER_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function inQuietWindow(date) {
  const hour = date.getHours();
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

function cardLabel(card) {
  const track = card.track ? ` ${card.track}` : '';
  const checkout = card.checkoutLabel ? `（${card.checkoutLabel}）` : '';
  return `${card.language ?? '未知语言'}${track}${checkout}`;
}

// One event per actionable finding. `since` carries the durable timestamp the
// dwell is measured from (gate presentation, worker dispatch, sentinel last
// run) — not "when the notifier first noticed", which would understate waits
// across restarts.
function campaignEvents(payload, nowMs) {
  const events = [];
  for (const card of payload?.campaigns || []) {
    const sessionKey = card.sessionKey ?? `main::${card.sessionPath}`;
    if (card.health === 'zombie') {
      events.push({
        key: `zombie:${sessionKey}`,
        category: '僵尸会话',
        line: `${cardLabel(card)} 会话已标记僵尸（scan-state 已越过它）——处置或归档`,
        since: card.updatedAt ?? null,
      });
      continue; // a zombie needs no gate echo on top
    }
    if (card.health === 'awaiting-close') {
      events.push({
        key: `close:${sessionKey}`,
        category: '待关账',
        line: `${cardLabel(card)} 全部单元已验收——执行 close-session 收账`,
        since: card.updatedAt ?? null,
      });
      continue;
    }
    if (card.staleReceipts && card.staleReceipts.count > 0) {
      events.push({
        key: `stale-receipt:${sessionKey}`,
        category: '回执未落',
        line: `${cardLabel(card)} ${card.staleReceipts.count} 个单元执行完成但回执未落账——核对 journal 后补记`,
        since: card.updatedAt ?? null,
      });
    }
    const gate = card.nextGate && card.nextGate.gate;
    if (card.health === 'active' && gate && gate !== 'CLOSE_SESSION') {
      events.push({
        key: `gate:${sessionKey}:${gate}`,
        category: '战役门',
        line: `${cardLabel(card)} 停在 ${gate}${card.nextGate.reviewUnitId ? `（${card.nextGate.reviewUnitId}）` : ''}`,
        since: card.updatedAt ?? null,
      });
    }
  }
  return events;
}

// Unapproved intake grouping manifests: the campaign's first gate, often the
// longest wait (presented → operator approval can span days).
function intakeEvents(payload) {
  const events = [];
  for (const card of payload?.intakes || []) {
    if (card.approved) continue;
    events.push({
      key: `grouping:${card.manifestPath}`,
      category: '分组门',
      line: `${card.language ?? '未知语言'} 分组方案已呈门待批（${card.checkoutLabel ?? ''}）`,
      since: card.presentedAt ?? null,
    });
  }
  return events;
}

function sentinelEvents(payload) {
  const events = [];
  for (const sentinel of payload?.sentinels || []) {
    if (sentinel.status === 'stale') {
      events.push({
        key: `sentinel:${sentinel.id}:stale`,
        category: '哨兵停摆',
        line: `${sentinel.title} 超过 25h 未运行——查 cron 或失败原因`,
        since: sentinel.lastRunAt ?? null,
      });
    } else if (sentinel.status === 'never-run' && sentinel.readiness?.capabilityReady) {
      // capability-ready-but-never-ran means the schedule should have fired
      // and did not; a not-yet-ready sentinel is setup state, not news.
      events.push({
        key: `sentinel:${sentinel.id}:never`,
        category: '哨兵未跑',
        line: `${sentinel.title} 具备运行条件但从未运行——查 cron`,
        since: null,
      });
    }
  }
  return events;
}

// Open dispatches that outlived the in-flight cap: the child died without an
// exit record (crash, host reboot) and only the durable ledger remembers it.
function lostWorkerEvents(dispatchLines, nowMs) {
  const events = [];
  const lastByKey = new Map();
  for (const line of Array.isArray(dispatchLines) ? dispatchLines : []) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed && typeof parsed.workerKey === 'string') lastByKey.set(parsed.workerKey, parsed);
  }
  for (const [workerKey, last] of lastByKey) {
    if (last.kind === 'exit') continue;
    const dispatchedAt = Date.parse(last.at || '');
    if (!Number.isFinite(dispatchedAt)) continue;
    const age = nowMs - dispatchedAt;
    if (age < LOST_WORKER_MIN_AGE_MS || age > LOST_WORKER_MAX_AGE_MS) continue;
    events.push({
      key: `lost-worker:${workerKey}`,
      category: 'worker 失联',
      line: `派出的 intake worker（${workerKey}）超过 2h 无退出记录——确认进程或重新派单`,
      since: last.at ?? null,
    });
  }
  return events;
}

function deriveEvents({ payload, dispatchLines, now = new Date() }) {
  const nowMs = now.getTime();
  return [
    ...campaignEvents(payload, nowMs),
    ...intakeEvents(payload),
    ...sentinelEvents(payload),
    ...lostWorkerEvents(dispatchLines, nowMs),
  ];
}

// Ledger lines (newest last): { v:1, key, at, kind: 'send'|'resolve' }. The
// latest record per key decides — a resolve forgets prior sends so a
// re-occurrence is new again.
function ledgerState(lines) {
  const state = new Map();
  for (const line of Array.isArray(lines) ? lines : []) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed.key !== 'string') continue;
    state.set(parsed.key, parsed);
  }
  return state;
}

function decideSends(events, ledgerLines, now = new Date(), { force = false } = {}) {
  const state = ledgerState(ledgerLines);
  const present = new Set(events.map((event) => event.key));
  const appends = [];
  for (const key of state.keys()) {
    const record = state.get(key);
    if (!present.has(key) && record.kind !== 'resolve') {
      appends.push({ v: 1, key, at: now.toISOString(), kind: 'resolve' });
    }
  }
  const sends = [];
  if (inQuietWindow(now) && !force) {
    return { sends, appends };
  }
  for (const event of events) {
    const record = state.get(event.key);
    const lastSend = record && record.kind === 'send' ? record : null;
    if (lastSend) {
      const sentAt = Date.parse(lastSend.at || '');
      if (Number.isFinite(sentAt) && now.getTime() - sentAt < ESCALATE_AFTER_MS) continue;
    }
    const since = Date.parse(event.since || '');
    const dwellMs = Number.isFinite(since) ? Math.max(0, now.getTime() - since) : null;
    sends.push({
      ...event,
      dwellMs,
      escalated: Boolean(lastSend),
    });
  }
  // The caller appends the matching send record per event only after the
  // message actually went out — a failed send must retry on the next sweep.
  return { sends, appends };
}

function formatDwell(dwellMs) {
  if (dwellMs === null || !Number.isFinite(dwellMs)) return '';
  const hours = dwellMs / 3_600_000;
  if (hours >= 48) return `已等待 ${Math.floor(hours / 24)} 天`;
  if (hours >= 1) return `已等待 ${hours.toFixed(1)} 小时`;
  return '刚发生';
}

// Plain text by construction: interactive cards render links AND bare URLs as
// unclickable text, and gate digests are display-only — the message carries
// neither, only enough to find the item on the board.
function formatMessage(sends, { generatedAt } = {}) {
  const lines = ['🔔 治理看板 · 待你决定'];
  if (sends.length === 1) {
    const [send] = sends;
    const dwell = formatDwell(send.dwellMs);
    lines.push(`【${send.category}】${send.line}${dwell ? ` — ${dwell}` : ''}${send.escalated ? '（再次提醒）' : ''}`);
  } else {
    sends.forEach((send, index) => {
      const dwell = formatDwell(send.dwellMs);
      lines.push(`${index + 1}. 【${send.category}】${send.line}${dwell ? ` — ${dwell}` : ''}${send.escalated ? '（再次提醒）' : ''}`);
    });
  }
  const stamp = generatedAt ? new Date(generatedAt).toLocaleString('zh-CN', { hour12: false }) : null;
  lines.push('——到任务看板处理；本消息不含链接与摘要，一切以看板和 canonical CLI 呈现的绑定工件为准。');
  if (stamp) lines.push(`（看板扫描于 ${stamp}）`);
  return lines.join('\n');
}

module.exports = {
  ESCALATE_AFTER_MS,
  QUIET_START_HOUR,
  QUIET_END_HOUR,
  LOST_WORKER_MIN_AGE_MS,
  LOST_WORKER_MAX_AGE_MS,
  ROLLBACK_MANIFESTS_RELATIVE_DIR,
  inQuietWindow,
  pendingRollbackGateFor,
  deriveEvents,
  decideSends,
  formatMessage,
  formatDwell,
  ledgerState,
};

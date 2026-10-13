'use strict';

// Durable view of dashboard-spawned worker sessions. The runtime map in
// server.js stays the operative state; this module only makes the registry
// survive restarts so the one-click approve keeps its injection targets —
// a restart otherwise orphans every spawned worker: the board still shows
// the gate but can no longer resume the session that waits at it.

const fs = require('node:fs');
const path = require('node:path');

const MAX_ENTRIES_PER_CARD = 6;

function loadWorkerRegistry(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
    const map = new Map();
    for (const [key, entries] of Object.entries(parsed)) {
      if (!Array.isArray(entries)) continue;
      // sessionId null is a LEGITIMATE live state (spawn still resolving its
      // id) — dropping such entries at load orphaned running workers on every
      // restart, together with their directive stamps. Malformed guard is
      // shape-only.
      map.set(key, entries.filter((e) => e && typeof e.status === 'string'
        && (e.sessionId === null || typeof e.sessionId === 'string')));
    }
    return map;
  } catch {
    return new Map();
  }
}

// Atomic tmp+rename so a crash mid-write never yields a half registry.
function saveWorkerRegistry(filePath, map) {
  const plain = {};
  for (const [key, entries] of map) plain[key] = entries;
  const temporary = `${filePath}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(temporary, `${JSON.stringify(plain, null, 2)}\n`);
    fs.renameSync(temporary, filePath);
  } catch {
    // best-effort only — a lost save costs the one-click target after the
    // next restart, never correctness (the resume CLI re-validates anyway)
  }
}

// Same sessionId updates the STORED entry in place (running → idle
// transitions mutate the object the callers hold live references to — copies
// would strand those references and lose the flip); a new id appends; the
// per-card window keeps the most recent MAX_ENTRIES_PER_CARD. A null
// sessionId (spawn still resolving its id) always appends — dedup on null
// would merge concurrent spawns.
function upsertWorkerEntry(entries, entry) {
  const list = Array.isArray(entries) ? entries.slice() : [];
  if (entry.sessionId != null) {
    const existing = list.findIndex((e) => e.sessionId === entry.sessionId);
    if (existing >= 0) {
      Object.assign(list[existing], entry);
      return list.slice(-MAX_ENTRIES_PER_CARD);
    }
  }
  list.push(entry);
  return list.slice(-MAX_ENTRIES_PER_CARD);
}

// Returns the STORED entry so callers keep mutating the registry's object,
// not a private copy.
function storedWorkerEntry(map, sessionPath, sessionId) {
  return (map.get(sessionPath) || []).find((e) => e.sessionId === sessionId) || null;
}

// Derive the board-facing reject-dispatch state from a card's worker
// entries: a dispatched REJECT supersedes the on-disk gate presentation
// until a NEWER one is regenerated — the card must stop offering the
// rejected batch as if it still awaited the operator's decision. null when
// no reject was dispatched or a newer presentation already landed.
function rejectDispatchState(workerEntries, presentationGeneratedAt) {
  const latest = (Array.isArray(workerEntries) ? workerEntries : [])
    .filter((w) => w?.directive?.kind === 'reject')
    .sort((a, b) => String(b.directive.at).localeCompare(String(a.directive.at)))[0];
  if (!latest) return null;
  if (presentationGeneratedAt && String(latest.directive.at) <= String(presentationGeneratedAt)) return null;
  return { at: latest.directive.at, running: latest.status === 'running' };
}

module.exports = {
  MAX_ENTRIES_PER_CARD,
  loadWorkerRegistry,
  saveWorkerRegistry,
  storedWorkerEntry,
  upsertWorkerEntry,
  rejectDispatchState,
};

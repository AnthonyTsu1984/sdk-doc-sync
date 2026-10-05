'use strict';
// Shared append-only event tap library for dashboard hooks (batch 2).
//
// Events land in <root>/tmp/dashboard-events/events-<YYYY-MM-DD>.jsonl, one
// JSON object per line, newest last. Best-effort by contract: every failure is
// swallowed (a hook's stdout/exit semantics belong to its caller and must
// never depend on the tap). DASHBOARD_HOOK_ROOT redirects the root for tests
// so fixtures never write into the real scan tree.
//
// Versioned here (scripts/dashboard/) so CI can test it; .zcode/hooks/ carries
// only thin local shims that require this module (the hooks directory is
// gitignored machine-local wiring).

const fs = require('node:fs');
const path = require('node:path');

function eventRoot() {
  const base = process.env.DASHBOARD_HOOK_ROOT
    ? path.resolve(process.env.DASHBOARD_HOOK_ROOT)
    : path.resolve(__dirname, '..', '..');
  return path.join(base, 'tmp', 'dashboard-events');
}

function eventFileName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `events-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.jsonl`;
}

function appendEvent(event) {
  try {
    const dir = eventRoot();
    fs.mkdirSync(dir, { recursive: true });
    const record = { v: 1, ts: new Date().toISOString(), ...event };
    fs.appendFileSync(path.join(dir, eventFileName()), `${JSON.stringify(record)}\n`);
    return true;
  } catch {
    return false;
  }
}

// Session-file references inside a tool input identify which campaign a tool
// call belongs to; matching against ledger cards happens at read time.
const SESSION_REF_REGEX = /tmp\/(?:sdk-release-scout|sdk-doc-sync-runs)\/[^"'\s]*session[^"'\s]*\.json/g;

function extractSessionRef(toolInput) {
  try {
    const text = JSON.stringify(toolInput ?? {});
    const match = SESSION_REF_REGEX.exec(text);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

module.exports = { appendEvent, eventFileName, eventRoot, extractSessionRef };

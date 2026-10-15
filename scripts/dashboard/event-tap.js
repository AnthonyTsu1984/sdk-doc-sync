#!/usr/bin/env node
'use strict';
// ZCode PostToolUse event tap (dashboard batch 2): injection-free, silent.
//
// Appends one compact event per completed tool call to the dashboard event
// stream. Deliberately quiet: empty stdout, always exit 0, sub-millisecond
// work (single append). PostToolUseFailure is a separate hook; this one only
// sees successful calls. No-op outside this repository or on any error — the
// session must never feel this hook.
//
// Also feeds agent budget metering (slice 3-1): every event carries the main
// session's session_id, so the tap can meter MAIN-session tool rounds, and
// Agent-like tool calls record subagent dispatches (hooks do NOT fire inside
// subagent child sessions — verified empirically; see budget-meter.js).
//
// Registered via the thin shim .zcode/hooks/post-tool-use.cjs (machine-local,
// gitignored); this module is the versioned, CI-tested implementation and can
// also be run directly for manual verification:
//   echo '{"cwd":"<repo>","tool_name":"Bash","tool_input":{"command":"ls"}}' | node scripts/dashboard/event-tap.js

const fs = require('node:fs');
const path = require('node:path');
const { appendEvent, extractSessionRef } = require('./event-lib.js');
const {
  countSessionRoundsToday,
  isAgentDispatchTool,
  mainSessionRoundRecord,
  recordAgentDispatch,
} = require('./budget-meter.js');

const HOOK_ROOT = process.env.DASHBOARD_HOOK_ROOT
  ? path.resolve(process.env.DASHBOARD_HOOK_ROOT)
  : path.resolve(__dirname, '..', '..');

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

function summarize(toolInput) {
  const input = toolInput ?? {};
  const flat = (value) => String(value).replace(/\s+/g, ' ').trim().slice(0, 160);
  if (typeof input.command === 'string') return flat(input.command);
  if (typeof input.file_path === 'string') return flat(input.file_path);
  if (typeof input.description === 'string') return flat(input.description);
  if (typeof input.pattern === 'string') return flat(input.pattern);
  return '';
}

function main() {
  const input = readStdin();
  let cwd;
  try {
    cwd = fs.realpathSync(String(input.cwd || ''));
  } catch {
    return;
  }
  let root;
  try {
    root = fs.realpathSync(HOOK_ROOT);
  } catch {
    return;
  }
  if (cwd !== root) return;

  const sessionId = input.session_id ?? input.sessionId ?? null;
  const tool = input.tool_name ?? input.toolName ?? null;
  const toolInput = input.tool_input ?? input.toolInput;

  // The dashboard event lands FIRST and exactly once, outside the metering
  // try — the pre-fix shape appended it again in the catch fallback whenever
  // a metering call after a successful append threw (batch15 review P2-4).
  // Round count is still read BEFORE the append, so +1 in the meter counts
  // the current round exactly once.
  let eventsBefore = null;
  try {
    eventsBefore = countSessionRoundsToday(root, sessionId);
  } catch {
    // metering only; the event must still land below
  }
  try {
    appendEvent({
      kind: 'tool',
      sessionId,
      tool,
      summary: summarize(toolInput),
      sessionRef: extractSessionRef(toolInput),
    });
  } catch {
    // give up silently
  }
  try {
    if (isAgentDispatchTool(tool)) {
      recordAgentDispatch({ root, sessionId, tool, toolInput });
    }
    // Agent-like calls are rounds of the parent session too (its context pays
    // for them), so they count toward the parent's round meter as well.
    if (eventsBefore !== null) {
      mainSessionRoundRecord({ root, sessionId, lastTool: tool, eventsToday: eventsBefore });
    }
  } catch {
    // metering is observability only
  }
}

if (require.main === module) {
  try {
    main();
  } catch {
    // best-effort tap: never surface
  }
  process.exit(0);
}

module.exports = { main, summarize };

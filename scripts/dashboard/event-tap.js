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
// Registered via the thin shim .zcode/hooks/post-tool-use.cjs (machine-local,
// gitignored); this module is the versioned, CI-tested implementation and can
// also be run directly for manual verification:
//   echo '{"cwd":"<repo>","tool_name":"Bash","tool_input":{"command":"ls"}}' | node scripts/dashboard/event-tap.js

const fs = require('node:fs');
const path = require('node:path');
const { appendEvent, extractSessionRef } = require('./event-lib.js');

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

  appendEvent({
    kind: 'tool',
    sessionId: input.session_id ?? input.sessionId ?? null,
    tool: input.tool_name ?? input.toolName ?? null,
    summary: summarize(input.tool_input ?? input.toolInput),
    sessionRef: extractSessionRef(input.tool_input ?? input.toolInput),
  });
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

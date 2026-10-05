#!/usr/bin/env node
'use strict';
// Task-dashboard local server — batch 1, strictly read-only.
//
// Serves the aggregation layer (ledger.js) over localhost: static page +
// /api/cards JSON + Server-Sent Events push + an allowlisted file viewer for
// session/journal/gate materials. It has NO write path: it never mutates tmp/
// or governance files, so it sits outside the governed-writer perimeter by
// construction. Watching + a 30s poll keep cards fresh without re-running
// the admission fingerprint hot path (that is cached with a TTL in the
// background).

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { exec, execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { buildLedger } = require('./ledger.js');

const execFileAsync = promisify(execFile);

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const INDEX_HTML = path.join(__dirname, 'public', 'index.html');
const REVIEW_SESSION_CLI = path.join(REPO_ROOT, '.claude/skills/api-reference-sync/bin/sdk-review-session.js');
const NEXT_GATE_TTL_MS = 3 * 60_000;
const NEXT_GATE_MAX_SESSIONS = 8;

// /api/file allowlist: repo-relative prefixes (plus one exact file). Anything
// resolving outside these — or outside the repo via .. or symlinks — is 403.
const FILE_VIEW_PREFIXES = [
  'tmp/sdk-release-scout/',
  'tmp/sdk-doc-sync-runs/',
  'tmp/api-reference-sync/',
  'tmp/skill-feedback-rollout/',
  'tmp/dashboard-events/',
];
const FILE_VIEW_EXACT = ['.claude/skills/api-reference-sync/scan-state.json'];

// Watch tmp/ recursively: covers all scan roots + evidence dirs + newly
// created event dirs in one watcher (recompute is cheap and debounced).
const WATCH_DIRS = ['tmp', '.claude/skills/api-reference-sync'];

const POLL_INTERVAL_MS = 30_000;
const DEBOUNCE_MS = 400;
const FINGERPRINT_TTL_MS = 5 * 60_000;
const FILE_VIEW_MAX_BYTES = 2 * 1024 * 1024;

function parseArgs(argv) {
  const options = { port: 8765, open: true, allowSpawn: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port') {
      const value = Number(argv[i + 1]);
      if (Number.isInteger(value) && value > 0 && value < 65536) {
        options.port = value;
        i += 1;
      }
    } else if (arg === '--no-open') {
      options.open = false;
    } else if (arg === '--allow-spawn') {
      options.allowSpawn = true;
    }
  }
  return options;
}

// ---------- next-gate enrichment (authoritative CLI, TTL-cached) ----------

const nextGateCache = new Map(); // sessionPath -> { value, at }

// Authoritative next-gate derivation lives in sdk-review-session.js; the
// dashboard only caches and displays it. Failures degrade to no chip.
async function fetchNextGate(sessionPath) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [REVIEW_SESSION_CLI, 'status', '--session', path.join(REPO_ROOT, sessionPath)],
    { timeout: 30_000, encoding: 'utf8' },
  );
  return parseStatusOutput(stdout);
}

function parseStatusOutput(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function refreshNextGates() {
  if (!currentPayload) return;
  const targets = currentPayload.campaigns
    .filter((card) => card.health !== 'finalized')
    .slice(0, NEXT_GATE_MAX_SESSIONS);
  let changed = false;
  for (const card of targets) {
    const cached = nextGateCache.get(card.sessionPath);
    if (cached && Date.now() - cached.at < NEXT_GATE_TTL_MS) continue;
    let value = null;
    try {
      value = await fetchNextGate(card.sessionPath);
    } catch {
      value = null;
    }
    nextGateCache.set(card.sessionPath, { value, at: Date.now() });
    changed = true;
  }
  if (changed) scheduleRecompute('next-gate');
}

function mergeNextGate(payload) {
  for (const card of payload.campaigns) {
    const cached = nextGateCache.get(card.sessionPath);
    if (cached && Date.now() - cached.at < NEXT_GATE_TTL_MS) {
      card.nextGate = cached.value?.nextGate ?? null;
    }
  }
  return payload;
}

// ---------- session spawn (opt-in, interactive only) ----------

// Fixed command: open an interactive Terminal in the repo running zcode. No
// request input ever reaches the shell. Headless/autonomous execution is
// deliberately NOT offered — campaign gates require the operator.
function buildSpawnCommand(repoRoot) {
  const escaped = String(repoRoot).replace(/"/g, '\\"');
  return ['osascript', ['-e', `tell application "Terminal" to do script "cd ${escaped} && zcode"`]];
}

// ---------- aggregation cache + push ----------

let currentPayload = null;
let currentSignature = '';
const sseClients = new Set();
let recomputeTimer = null;

function fingerprintStatus(state) {
  if (!state.computed) return { status: 'pending' };
  const last = currentPayload?.admission?.lastEntry ?? null;
  return {
    status: 'admitted',
    phase: state.phase ?? null,
    fingerprint: state.fingerprint,
    recordedAt: state.recordedAt ?? null,
    matchesLedger: last ? last.sourceFingerprint === state.fingerprint : null,
  };
}

function buildPayload() {
  const ledger = buildLedger({ repoRoot: REPO_ROOT });
  const payload = {
    ...ledger,
    admission: { ...ledger.admission, fingerprint: fingerprintStatus(fingerprintState) },
    features: { spawnEnabled: spawnOptions.allowSpawn },
  };
  return mergeNextGate(payload);
}

// generatedAt (and fingerprint computedAt) are volatile; everything else
// changing means the cards actually changed and clients should be notified.
function signatureOf(payload) {
  const clone = {
    ...payload,
    generatedAt: undefined,
    admission: payload.admission
      ? { ...payload.admission, fingerprint: payload.admission.fingerprint
        ? { ...payload.admission.fingerprint, fingerprint: payload.admission.fingerprint.fingerprint?.slice(0, 19) }
        : null }
      : null,
  };
  return JSON.stringify(clone);
}

function recompute(reason) {
  let payload;
  try {
    payload = buildPayload();
  } catch (error) {
    process.stderr.write(`[dashboard] recompute failed (${reason}): ${error?.message}\n`);
    return;
  }
  const signature = signatureOf(payload);
  currentPayload = payload;
  if (signature !== currentSignature) {
    currentSignature = signature;
    process.stdout.write(`[dashboard] cards updated (${reason}); campaigns=${payload.campaigns.length}\n`);
    broadcast(payload);
  }
}

function scheduleRecompute(reason) {
  if (recomputeTimer) return;
  recomputeTimer = setTimeout(() => {
    recomputeTimer = null;
    recompute(reason);
  }, DEBOUNCE_MS);
}

function broadcast(payload) {
  const data = `event: cards\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(data);
    } catch {
      sseClients.delete(client);
    }
  }
}

function heartbeat() {
  for (const client of sseClients) {
    try {
      client.write(': ping\n\n');
    } catch {
      sseClients.delete(client);
    }
  }
}

// ---------- admission fingerprint (background, TTL-cached) ----------

const fingerprintState = { computed: false, fingerprint: null, phase: null, recordedAt: null };

let spawnOptions = { allowSpawn: false };

function computeFingerprint() {
  try {
    // Same implementation the admission ledger binds — never a second truth.
    const { productionInputFingerprint } = require(path.join(
      REPO_ROOT,
      '.claude/skills/doc-ops-core/src/run-manifest.js',
    ));
    const fingerprint = productionInputFingerprint({ repoRoot: REPO_ROOT });
    fingerprintState.fingerprint = fingerprint;
    fingerprintState.phase = currentPayload?.admission?.lastEntry?.phase ?? null;
    fingerprintState.recordedAt = currentPayload?.admission?.lastEntry?.generatedAt ?? null;
    fingerprintState.computed = true;
  } catch (error) {
    fingerprintState.computed = false;
    process.stderr.write(`[dashboard] fingerprint failed: ${error?.message}\n`);
  }
  scheduleRecompute('fingerprint');
}

// ---------- request handling ----------

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function fileViewAllowed(resolvedRelative) {
  const normalized = resolvedRelative.split(path.sep).join('/');
  if (FILE_VIEW_EXACT.includes(normalized)) return true;
  return FILE_VIEW_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Read-only single-level directory listing (for sentinel artifact dirs etc.).
// Every child link re-enters /api/file, so the allowlist stays enforced.
function serveDirectoryListing(res, resolved, normalizedRelative) {
  fs.readdir(resolved, { withFileTypes: true }, (dirError, entries) => {
    if (dirError) {
      sendJson(res, 500, { error: String(dirError?.message || dirError) });
      return;
    }
    const childPath = (name) => path.posix.join(normalizedRelative, name);
    const parent = path.posix.dirname(normalizedRelative);
    const parentAllowed = fileViewAllowed(`${parent}/`) || FILE_VIEW_EXACT.includes(parent);
    const rows = entries
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => `<tr><td><a href="/api/file?path=${encodeURIComponent(childPath(entry.name))}">${escapeHtml(entry.name)}${entry.isDirectory() ? '/' : ''}</a></td><td>${entry.isDirectory() ? 'dir' : ''}</td></tr>`)
      .join('\n');
    const up = parentAllowed && parent !== normalizedRelative
      ? `<p><a href="/api/file?path=${encodeURIComponent(parent)}">.. ${escapeHtml(parent)}/</a></p>`
      : '';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(`<!doctype html><meta charset="utf-8"><title>${escapeHtml(normalizedRelative)}/</title>
<style>body{font:13px -apple-system,system-ui,sans-serif;padding:16px}td{padding:2px 14px 2px 0}td:last-child{color:#888}</style>
<h3>${escapeHtml(normalizedRelative)}/</h3>${up}<table>${rows}</table>`);
  });
}

function serveFileView(req, res, query) {
  const requested = query.get('path');
  if (!requested) {
    sendJson(res, 400, { error: 'missing ?path=' });
    return;
  }
  const resolved = path.resolve(REPO_ROOT, requested);
  const relative = path.relative(REPO_ROOT, resolved);
  const normalizedRelative = relative.split(path.sep).join('/');
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fileViewAllowed(normalizedRelative)) {
    sendJson(res, 403, { error: 'path outside dashboard view allowlist' });
    return;
  }
  fs.stat(resolved, (statError, stat) => {
    if (statError) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    if (stat.isDirectory()) {
      serveDirectoryListing(res, resolved, normalizedRelative);
      return;
    }
    if (!stat.isFile()) {
      sendJson(res, 404, { error: 'not a regular file' });
      return;
    }
    if (stat.size > FILE_VIEW_MAX_BYTES) {
      sendJson(res, 413, { error: `file larger than ${FILE_VIEW_MAX_BYTES} bytes` });
      return;
    }
    fs.readFile(resolved, (readError, body) => {
      if (readError) {
        sendJson(res, 500, { error: String(readError?.message || readError) });
        return;
      }
      const ext = path.extname(resolved).toLowerCase();
      const type = ext === '.html'
        ? 'text/html; charset=utf-8'
        : 'text/plain; charset=utf-8';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    });
  });
}

function handler(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${req.socket.localPort || 0}`);
  if (url.pathname === '/api/spawn-session') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'POST required' });
      return;
    }
    if (!spawnOptions.allowSpawn) {
      sendJson(res, 404, { error: 'spawn disabled — restart the dashboard with --allow-spawn' });
      return;
    }
    const [command, args] = buildSpawnCommand(REPO_ROOT);
    execFile(command, args, { timeout: 15_000 }, (error) => {
      if (error) {
        sendJson(res, 500, { error: `spawn failed: ${error?.message}` });
        return;
      }
      sendJson(res, 200, { ok: true, note: '已在 Terminal 打开 zcode——粘贴 /attach <键> 挂载战役（如 /attach java-v30）' });
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'read-only server' });
    return;
  }
  switch (url.pathname) {
    case '/':
      fs.readFile(INDEX_HTML, (error, body) => {
        if (error) {
          sendJson(res, 500, { error: `index.html missing: ${error?.message}` });
          return;
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(body);
      });
      return;
    case '/api/cards':
      if (!currentPayload) recompute('api-cold-start');
      sendJson(res, 200, currentPayload ?? { error: 'not ready' });
      return;
    case '/api/healthz':
      sendJson(res, 200, { ok: true, clients: sseClients.size });
      return;
    case '/api/file':
      serveFileView(req, res, url.searchParams);
      return;
    case '/favicon.ico':
      res.writeHead(204);
      res.end();
      return;
    case '/api/events':
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write(`event: cards\ndata: ${JSON.stringify(currentPayload ?? {})}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    default:
      sendJson(res, 404, { error: 'not found' });
  }
}

function main() {
  const { port, open, allowSpawn } = parseArgs(process.argv);
  spawnOptions = { allowSpawn };
  recompute('startup');
  computeFingerprint();
  setInterval(() => computeFingerprint(), FINGERPRINT_TTL_MS).unref();
  refreshNextGates().catch(() => {});
  setInterval(() => refreshNextGates().catch(() => {}), 60_000).unref();

  for (const dir of WATCH_DIRS) {
    try {
      fs.watch(path.join(REPO_ROOT, dir), { recursive: true }, () => scheduleRecompute(`watch:${dir}`));
    } catch {
      // dir absent now; the 30s poll keeps cards correct once it appears
    }
  }
  setInterval(() => recompute('poll'), POLL_INTERVAL_MS).unref();
  setInterval(heartbeat, 25_000).unref();

  const server = http.createServer(handler);
  server.listen(port, '127.0.0.1', () => {
    const address = `http://127.0.0.1:${server.address().port}`;
    process.stdout.write(`[dashboard] serving ${address} (read-only${allowSpawn ? ' + opt-in spawn' : ''}; repo ${REPO_ROOT})\n`);
    if (open) exec(`open ${address}`);
  });
}

if (require.main === module) main();

module.exports = { buildSpawnCommand, parseArgs, parseStatusOutput };

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
const { exec } = require('node:child_process');

const { buildLedger, SESSION_SCAN_ROOTS } = require('./ledger.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const INDEX_HTML = path.join(__dirname, 'public', 'index.html');

// /api/file allowlist: repo-relative prefixes (plus one exact file). Anything
// resolving outside these — or outside the repo via .. or symlinks — is 403.
const FILE_VIEW_PREFIXES = [
  'tmp/sdk-release-scout/',
  'tmp/sdk-doc-sync-runs/',
  'tmp/api-reference-sync/',
  'tmp/skill-feedback-rollout/',
];
const FILE_VIEW_EXACT = ['.claude/skills/api-reference-sync/scan-state.json'];

const WATCH_DIRS = [
  ...SESSION_SCAN_ROOTS,
  'tmp/api-reference-sync',
  'tmp/skill-feedback-rollout',
  '.claude/skills/api-reference-sync',
];

const POLL_INTERVAL_MS = 30_000;
const DEBOUNCE_MS = 400;
const FINGERPRINT_TTL_MS = 5 * 60_000;
const FILE_VIEW_MAX_BYTES = 2 * 1024 * 1024;

function parseArgs(argv) {
  const options = { port: 8765, open: true };
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
    }
  }
  return options;
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
  return {
    ...ledger,
    admission: { ...ledger.admission, fingerprint: fingerprintStatus(fingerprintState) },
  };
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

function serveFileView(req, res, query) {
  const requested = query.get('path');
  if (!requested) {
    sendJson(res, 400, { error: 'missing ?path=' });
    return;
  }
  const resolved = path.resolve(REPO_ROOT, requested);
  const relative = path.relative(REPO_ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fileViewAllowed(relative)) {
    sendJson(res, 403, { error: 'path outside dashboard view allowlist' });
    return;
  }
  fs.stat(resolved, (statError, stat) => {
    if (statError || !stat.isFile()) {
      sendJson(res, 404, { error: 'not found' });
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
  const { port, open } = parseArgs(process.argv);
  recompute('startup');
  computeFingerprint();
  setInterval(() => computeFingerprint(), FINGERPRINT_TTL_MS).unref();

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
    process.stdout.write(`[dashboard] serving ${address} (read-only; repo ${REPO_ROOT})\n`);
    if (open) exec(`open ${address}`);
  });
}

main();

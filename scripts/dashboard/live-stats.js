'use strict';
// Live Feishu content statistics per registered release track — batch 6.
//
// Server-side, TTL-cached, degrade-graceful. Read-only GET APIs only, so the
// dashboard's no-write-path red line holds. The release-track registry stays
// the source of truth for WHICH tracks exist (a version must be registered to
// be governed); this module only counts what Feishu currently holds per
// track: Bitable record total + Drive document/folder tree size.
//
// Tests never touch node-fetch or the network: the token fetcher and fetch
// implementation are injectable; production wiring lazy-requires the skill's
// larkTokenFetcher (which pulls node-fetch/dotenv from the repo install).

const path = require('node:path');
const { RELEASE_TRACKS_RELATIVE_PATH, readJsonOrNull } = require('./ledger.js');

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DEFAULT_TTL_MS = 10 * 60_000;
const DRIVE_NODE_CAP = 2000;
const LOOKBACK_DAYS = 14;

function defaultFetchImpl() {
  const fetchImpl = globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('no global fetch available (Node >= 18 required)');
  }
  return fetchImpl.bind(globalThis);
}

function defaultTokenFetcher(repoRoot) {
  const LarkTokenFetcher = require(path.join(
    repoRoot,
    '.claude/skills/api-reference-sync/lib/lark-docs/larkTokenFetcher.js',
  ));
  return new LarkTokenFetcher();
}

async function feishuGet(tokenFetcher, route, fetchImpl) {
  const token = await tokenFetcher.token();
  const res = await fetchImpl(`${FEISHU_HOST}${route}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!data || data.code !== 0) {
    throw new Error(`${route}: ${data?.msg ?? 'code ' + data?.code ?? 'non-json response'}`);
  }
  return data.data;
}

// One cheap page read: the records-list response carries `total` for the
// table, so a page_size=1 fetch is enough. Falls back to item count if a
// future API revision drops the field (honest undercount beats a crash).
async function bitableRecordTotal(tokenFetcher, baseToken, fetchImpl) {
  const tables = await feishuGet(
    tokenFetcher,
    `/open-apis/bitable/v1/apps/${baseToken}/tables?page_size=100`,
    fetchImpl,
  );
  const tableId = (tables.items || [])[0]?.table_id;
  if (!tableId) throw new Error(`no tables in bitable ${baseToken}`);
  const query = new URLSearchParams({ page_size: '1' });
  const page = await feishuGet(
    tokenFetcher,
    `/open-apis/bitable/v1/apps/${baseToken}/tables/${tableId}/records?${query}`,
    fetchImpl,
  );
  if (typeof page.total === 'number') return page.total;
  return (page.items || []).length;
}

async function listFolder(tokenFetcher, folderToken, fetchImpl) {
  const items = [];
  let pageToken = '';
  do {
    const query = new URLSearchParams({ folder_token: folderToken, page_size: '200' });
    if (pageToken) query.set('page_token', pageToken);
    const data = await feishuGet(tokenFetcher, `/open-apis/drive/v1/files?${query}`, fetchImpl);
    items.push(...(data.files || data.items || []));
    pageToken = data.has_more ? (data.next_page_token || data.page_token || '') : '';
  } while (pageToken);
  return items;
}

// Breadth-first walk of the track's release root counting docx docs and
// category folders. Capped: a runaway tree surfaces as capped=true instead
// of an unbounded crawl.
async function driveTreeCounts(tokenFetcher, rootToken, fetchImpl) {
  const queue = [rootToken];
  const visited = new Set();
  let docs = 0;
  let folders = 0;
  let nodes = 0;
  while (queue.length > 0 && nodes < DRIVE_NODE_CAP) {
    const folder = queue.shift();
    if (visited.has(folder)) continue;
    visited.add(folder);
    const items = await listFolder(tokenFetcher, folder, fetchImpl);
    for (const item of items) {
      nodes += 1;
      const type = item.type || item.file_type;
      const token = item.token || item.file_token;
      if (type === 'folder') {
        folders += 1;
        if (token && nodes < DRIVE_NODE_CAP) queue.push(token);
      } else if (type === 'docx' || type === 'doc') {
        docs += 1;
      }
    }
  }
  return { docs, folders, capped: nodes >= DRIVE_NODE_CAP };
}

function registryTracks(registry) {
  const tracks = [];
  for (const [language, entry] of Object.entries(registry?.languages || {})) {
    for (const track of entry.tracks || []) {
      tracks.push({
        language,
        version: track.version,
        baseToken: track.bitable?.baseToken || null,
        releaseRootToken: track.drive?.releaseRoot?.token || null,
      });
    }
  }
  return tracks;
}

// Per-track failures are isolated: one bad base token must not sink the other
// tracks. Status: ok (all fetched) / partial (some tracks errored) / failed
// (registry absent or everything errored, e.g. credentials missing).
function createLiveStatsCollector({
  repoRoot,
  tokenFetcher,
  fetchImpl,
  ttlMs = DEFAULT_TTL_MS,
  now = () => Date.now(),
} = {}) {
  const state = {
    status: 'never-run',
    fetchedAt: null,
    error: null,
    tracks: {}, // key `${language}:${version}` → stats or error
  };
  let inflight = null;

  async function refresh() {
    const registry = readJsonOrNull(path.join(repoRoot, RELEASE_TRACKS_RELATIVE_PATH));
    if (!registry) {
      state.status = 'failed';
      state.error = 'release-track registry unreadable';
      state.fetchedAt = new Date(now()).toISOString();
      return state;
    }
    const list = registryTracks(registry);
    const nextTracks = {};
    let failures = 0;
    let fetcher = tokenFetcher;
    let getter = fetchImpl;
    try {
      fetcher = fetcher || defaultTokenFetcher(repoRoot);
      getter = getter || defaultFetchImpl();
    } catch (error) {
      state.status = 'failed';
      state.error = `auth unavailable: ${error?.message || error}`;
      state.fetchedAt = new Date(now()).toISOString();
      return state;
    }
    for (const track of list) {
      const key = `${track.language}:${track.version}`;
      const entry = { language: track.language, version: track.version };
      try {
        if (track.baseToken) {
          entry.recordTotal = await bitableRecordTotal(fetcher, track.baseToken, getter);
        }
        if (track.releaseRootToken) {
          Object.assign(entry, await driveTreeCounts(fetcher, track.releaseRootToken, getter));
        }
        if (entry.recordTotal === undefined && entry.docs === undefined) {
          throw new Error('track has neither bitable base nor release root on file');
        }
      } catch (error) {
        failures += 1;
        entry.error = String(error?.message || error);
      }
      nextTracks[key] = entry;
    }
    state.tracks = nextTracks;
    state.error = failures > 0 ? `${failures}/${list.length} 轨道拉取失败` : null;
    state.status = failures === 0 ? 'ok' : failures === list.length ? 'failed' : 'partial';
    state.fetchedAt = new Date(now()).toISOString();
    return state;
  }

  function snapshot() {
    return {
      status: state.status,
      fetchedAt: state.fetchedAt,
      error: state.error,
      tracks: state.tracks,
    };
  }

  // Single-flight, TTL-gated: concurrent callers share one refresh; a fresh
  // enough snapshot is returned as-is.
  async function get({ force = false } = {}) {
    const age = state.fetchedAt ? now() - new Date(state.fetchedAt).getTime() : Infinity;
    if (!force && age < ttlMs && state.status !== 'never-run') return snapshot();
    if (!inflight) {
      inflight = refresh().finally(() => { inflight = null; });
    }
    await inflight;
    return snapshot();
  }

  return { refresh, get, snapshot };
}

module.exports = {
  DEFAULT_TTL_MS,
  DRIVE_NODE_CAP,
  LOOKBACK_DAYS,
  bitableRecordTotal,
  createLiveStatsCollector,
  driveTreeCounts,
  listFolder,
  registryTracks,
};

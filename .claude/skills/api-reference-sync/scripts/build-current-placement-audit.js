#!/usr/bin/env node
'use strict';

// Canonical read-only inheritance-evidence collector. Combines recursive Drive
// ancestry with fully paginated adjacent-track Bitable enumeration so sharing
// is proven from record pointers (the authoritative carriers of version
// belonging) instead of inferred from physical placement. Every mutation-free
// run emits per-entry `inheritanceEvidence` objects that the reviewed-context
// builder, planner, and executor revalidate fail-closed.

const fs = require('node:fs');
const path = require('node:path');
const fetch = require('node-fetch');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');
const {
  createInheritanceEvidence,
  documentTokenFromLink,
  trackInventoryDigest,
} = require('../src/sdk-doc-sync/inheritance-evidence');
const { bitableRecordTokens } = require('../src/sdk-doc-sync/token-reference-reader');
const {
  listLanguageTracks,
  loadReleaseTrackRegistry,
  requireTrack,
  trackBaseToken,
  trackReleaseRootToken,
  trackTableId,
} = require('../src/sdk-doc-sync/release-track-registry');

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function parseArgs(argv = process.argv) {
  const args = { sourceVersionRoots: [], adjacentBitables: [], requiredTracks: [] };
  const repeatable = new Set(['--source-version-root', '--adjacent-bitable', '--required-track']);
  const options = new Set([
    '--proposal', '--version', '--version-root', '--output',
    '--language', '--registry', '--target-bitable',
    ...repeatable,
  ]);
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!options.has(key)) throw new Error(`Unknown argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    if (key === '--source-version-root') {
      args.sourceVersionRoots.push(value);
    } else if (key === '--adjacent-bitable') {
      args.adjacentBitables.push(value);
    } else if (key === '--required-track') {
      args.requiredTracks.push(value);
    } else {
      args[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    }
    index += 1;
  }
  for (const key of ['proposal', 'version', 'output']) {
    if (!args[key]) throw new Error(`Missing --${key}`);
  }
  return args;
}

function parseSourceVersionRoot(value) {
  const match = String(value || '').match(/^([^:=]+)[:=](.+)$/);
  if (!match) throw new Error(`Invalid --source-version-root ${value}; expected <version>:<folderToken>`);
  return { version: match[1], rootToken: match[2] };
}

function parseBitableTarget(value) {
  const parts = String(value || '').split(':').filter((part) => part.length > 0);
  if (parts.length === 0 || parts.length > 2) {
    throw new Error(`Invalid Bitable target ${value}; expected <baseToken>[:<tableId>]`);
  }
  return { baseToken: parts[0], tableId: parts[1] || null };
}

function parseAdjacentBitable(value) {
  const match = String(value || '').match(/^([^:]+):([^:]+)(?::([^:]+))?$/);
  if (!match) {
    throw new Error(`Invalid --adjacent-bitable ${value}; expected <version>:<baseToken>[:<tableId>]`);
  }
  return { version: match[1], baseToken: match[2], tableId: match[3] || null };
}

function tokenFromLink(link) {
  return documentTokenFromLink(link);
}

function proposalEntries(proposal) {
  return (proposal.proposals || [])
    .filter((item) => item.existingBitable?.status === 'matched')
    .map((item) => ({
      proposalId: item.id,
      stableId: item.docIdentity.stableId,
      canonicalSlug: item.docIdentity.canonicalSlug,
      title: item.docIdentity.title,
      recordId: item.existingBitable.recordId,
      documentToken: item.existingBitable.currentDocumentToken || tokenFromLink(item.existingBitable.currentDocsLink),
      targetFolderToken: item.docIdentity.targetFolderToken,
      parentRecordId: item.existingBitable.parentRecordIds?.[0] || null,
    }));
}

async function feishuGet(tokenFetcher, route) {
  const token = await tokenFetcher.token();
  const res = await fetch(`${FEISHU_HOST}${route}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`${route}: ${data.msg}`);
  return data.data;
}

async function listFolder(tokenFetcher, folderToken) {
  const items = [];
  let pageToken = '';
  do {
    const query = new URLSearchParams({ folder_token: folderToken, page_size: '200' });
    if (pageToken) query.set('page_token', pageToken);
    const data = await feishuGet(tokenFetcher, `/open-apis/drive/v1/files?${query}`);
    items.push(...(data.files || data.items || []));
    pageToken = data.has_more ? (data.next_page_token || data.page_token || '') : '';
  } while (pageToken);
  return items;
}

async function indexVersionRoot(tokenFetcher, rootToken) {
  const byToken = new Map();
  const visited = new Set();
  const queue = [{ token: rootToken, ancestors: [rootToken] }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current.token)) continue;
    visited.add(current.token);
    for (const item of await listFolder(tokenFetcher, current.token)) {
      const token = item.token || item.file_token;
      const type = item.type || item.file_type;
      if (!token) continue;
      byToken.set(token, {
        token,
        type,
        parentFolderToken: current.token,
        ancestors: current.ancestors,
        name: item.name || item.title || '',
      });
      if (type === 'folder') queue.push({ token, ancestors: [...current.ancestors, token] });
    }
  }
  return byToken;
}

async function resolveTableId(tokenFetcher, baseToken, tableId) {
  if (nonEmptyString(tableId)) return tableId;
  const data = await feishuGet(tokenFetcher, `/open-apis/bitable/v1/apps/${baseToken}/tables?page_size=100`);
  const first = (data.items || [])[0];
  if (!nonEmptyString(first?.table_id)) throw new Error(`No tables found in Bitable ${baseToken}`);
  return first.table_id;
}

// Fully paginated record listing; GET-only so the audit stays read-only.
async function listBitableRecords(tokenFetcher, baseToken, tableId = null) {
  const resolvedTableId = await resolveTableId(tokenFetcher, baseToken, tableId);
  const records = [];
  let pageToken = '';
  do {
    const query = new URLSearchParams({ page_size: '500' });
    if (pageToken) query.set('page_token', pageToken);
    const data = await feishuGet(
      tokenFetcher,
      `/open-apis/bitable/v1/apps/${baseToken}/tables/${resolvedTableId}/records?${query}`,
    );
    records.push(...(data.items || []));
    pageToken = data.has_more ? (data.page_token || '') : '';
  } while (pageToken);
  return records;
}

function classifySharedToken({ entry, enumerationComplete, referencesByToken, placementVerified }) {
  const blockers = [];
  if (!enumerationComplete) blockers.push('TRACK_ENUMERATION_INCOMPLETE');
  if (!placementVerified) blockers.push('PLACEMENT_UNVERIFIED');
  if (!nonEmptyString(entry.recordId)) blockers.push('CURRENT_RECORD_REQUIRED');
  if (!nonEmptyString(entry.documentToken)) blockers.push('CURRENT_DOCUMENT_TOKEN_REQUIRED');
  if (!enumerationComplete || !nonEmptyString(entry.documentToken)) {
    return { status: 'unknown', referencedRecordIds: [], blockers };
  }
  const references = referencesByToken.get(entry.documentToken) || [];
  const referencedRecordIds = [...new Set(references.map((reference) => reference.recordId))].sort();
  if (!nonEmptyString(entry.recordId) || !referencedRecordIds.includes(entry.recordId)) {
    // The proposal's own record does not point at the proposal's own document:
    // the proposal is stale or the record was repointed after review.
    blockers.push('CURRENT_RECORD_NOT_REFERENCING');
    return { status: 'unknown', referencedRecordIds, blockers };
  }
  const status = referencedRecordIds.length > 1 ? 'shared' : 'unshared';
  return { status, referencedRecordIds, blockers };
}

async function buildPlacementAudit({
  proposal,
  version,
  versionRootToken,
  sourceVersionRoots = [],
  indexer,
  trackBitables = [],
  recordLister = null,
  collectedAt = null,
  requiredTrackVersions = null,
}) {
  const runCollectedAt = collectedAt || new Date().toISOString();
  const roots = [
    { version, rootToken: versionRootToken, target: true },
    ...sourceVersionRoots.map((item) => ({ ...item, target: false })),
  ];
  const indexes = [];
  for (const root of roots) {
    indexes.push({
      ...root,
      index: await indexer(root.rootToken),
    });
  }
  const targetIndex = indexes[0].index;

  // Completeness is "every applicable track was enumerated", never "at least
  // one was supplied". The required set is derived independently of what the
  // caller chose to enumerate: the target version, every declared source
  // root, and any registry/explicit manifest versions. An omitted adjacent
  // Bitable could hold references to the same document tokens, so a partial
  // enumeration must yield unknown sharing, not digest-valid unshared
  // evidence.
  const requiredVersions = [...new Set([
    version,
    ...sourceVersionRoots.map((item) => item.version),
    ...(requiredTrackVersions || []),
  ].filter(nonEmptyString))];

  const enumeration = {
    complete: true,
    supplied: trackBitables.length,
    requiredVersions,
    failures: [],
    tracks: [],
  };
  const referencesByToken = new Map();
  const trackInventoryDigests = {};
  const enumeratedVersions = new Set();
  const seenVersions = new Set();
  for (const track of trackBitables) {
    if (seenVersions.has(track.version)) {
      enumeration.complete = false;
      enumeration.failures.push({
        version: track.version,
        baseToken: track.baseToken || null,
        code: 'TRACK_COVERAGE_DUPLICATE',
      });
      continue;
    }
    seenVersions.add(track.version);
    if (!nonEmptyString(track.baseToken)) {
      enumeration.complete = false;
      enumeration.failures.push({
        version: track.version,
        baseToken: null,
        code: 'TRACK_BASE_TOKEN_UNRESOLVED',
      });
      continue;
    }
    try {
      if (typeof recordLister !== 'function') {
        throw new Error('recordLister is required to enumerate track Bitables');
      }
      const records = await recordLister({
        baseToken: track.baseToken,
        tableId: track.tableId || null,
        version: track.version,
      });
      const tokens = bitableRecordTokens(records);
      const inventoryDigest = trackInventoryDigest(tokens);
      trackInventoryDigests[track.version] = inventoryDigest;
      enumeratedVersions.add(track.version);
      enumeration.tracks.push({
        version: track.version,
        baseToken: track.baseToken,
        tableId: track.tableId || null,
        recordCount: (records || []).length,
        documentTokenCount: tokens.length,
        inventoryDigest,
      });
      for (const { recordId, documentToken } of tokens) {
        const list = referencesByToken.get(documentToken) || [];
        list.push({ recordId, version: track.version, baseToken: track.baseToken });
        referencesByToken.set(documentToken, list);
      }
    } catch (error) {
      enumeration.complete = false;
      enumeration.failures.push({
        version: track.version,
        baseToken: track.baseToken,
        code: 'TRACK_ENUMERATION_FAILED',
        message: error.message,
      });
    }
  }
  for (const required of requiredVersions) {
    if (!enumeratedVersions.has(required)) {
      enumeration.complete = false;
      enumeration.failures.push({
        version: required,
        baseToken: null,
        code: 'TRACK_COVERAGE_MISSING',
      });
    }
  }

  const entries = proposalEntries(proposal).map((entry) => {
    const match = indexes.find((item) => item.index.has(entry.documentToken));
    const placementEntry = match?.index.get(entry.documentToken);
    const placementVerified = Boolean(match && placementEntry);
    const sharing = classifySharedToken({
      entry,
      enumerationComplete: enumeration.complete,
      referencesByToken,
      placementVerified,
    });
    const targetFolderVerified = nonEmptyString(entry.targetFolderToken)
      && targetIndex.has(entry.targetFolderToken);
    const blockers = [...sharing.blockers];
    if (!targetFolderVerified) blockers.push('TARGET_FOLDER_UNVERIFIED');

    let inheritanceEvidence = null;
    if (placementVerified && targetFolderVerified && sharing.status !== 'unknown'
      && enumeration.complete && nonEmptyString(entry.recordId) && nonEmptyString(entry.stableId)) {
      inheritanceEvidence = createInheritanceEvidence({
        stableId: entry.stableId,
        current: {
          recordId: entry.recordId,
          documentToken: entry.documentToken,
          version: match.version,
          folderToken: placementEntry.parentFolderToken,
          versionRootToken: match.rootToken,
          ancestryVerified: true,
          placementVerified: true,
        },
        target: {
          version,
          folderToken: entry.targetFolderToken,
          versionRootToken,
          ancestryVerified: true,
        },
        sharedTokenStatus: sharing.status,
        referencedRecordIds: sharing.referencedRecordIds,
        trackInventoryDigests,
        collectedAt: runCollectedAt,
      });
    }

    return {
      ...entry,
      placement: {
        verified: placementVerified,
        status: placementVerified ? (match.target ? 'current_version_local' : 'inherited_source') : 'unverified',
        version: placementVerified ? match.version : null,
        folderToken: placementEntry?.parentFolderToken || null,
        versionRootToken: match?.rootToken || null,
        // Tri-state derived from paginated Bitable record pointers, never from
        // physical placement alone; null means unknown and blocks planning.
        referencedByOlderVersions: sharing.status === 'shared'
          ? true
          : sharing.status === 'unshared' ? false : null,
        ancestry: placementEntry?.ancestors || [],
      },
      sharedToken: {
        status: sharing.status,
        referencedRecordIds: sharing.referencedRecordIds,
        references: (referencesByToken.get(entry.documentToken) || [])
          .map((reference) => ({ ...reference }))
          .sort((left, right) => left.recordId.localeCompare(right.recordId)),
      },
      targetFolderVerified,
      inheritanceEvidence,
      inheritanceEvidenceBlockers: inheritanceEvidence ? [] : blockers,
    };
  });

  const sharedTokenSummary = { shared: 0, unshared: 0, unknown: 0 };
  for (const entry of entries) sharedTokenSummary[entry.sharedToken.status] += 1;

  return {
    schemaVersion: 2,
    status: entries.every((entry) => entry.placement.verified) ? 'placement_audit_ready' : 'placement_audit_blocked',
    inheritanceEvidenceStatus: entries.every((entry) => entry.inheritanceEvidence) ? 'evidence_complete' : 'evidence_blocked',
    generatedAt: new Date().toISOString(),
    collectedAt: runCollectedAt,
    version,
    versionRootToken,
    sourceVersionRoots,
    recordEnumeration: {
      complete: enumeration.complete,
      supplied: enumeration.supplied,
      requiredVersions: enumeration.requiredVersions,
      failures: enumeration.failures,
      tracks: enumeration.tracks,
    },
    trackInventoryDigests,
    sharedTokenSummary,
    entries,
    blocked: entries.filter((entry) => !entry.placement.verified),
    evidenceBlocked: entries
      .filter((entry) => !entry.inheritanceEvidence)
      .map((entry) => ({ stableId: entry.stableId, blockers: entry.inheritanceEvidenceBlockers })),
    writesPerformed: false,
  };
}

// Registry-driven resolution: the target track supplies the release root and
// Bitable base; every other track of the language is enumerated so cross-track
// references are complete in both directions. Explicit CLI flags win.
function resolveRegistryContext({ args, version, registryPath }) {
  const registry = loadReleaseTrackRegistry(registryPath);
  const tracks = listLanguageTracks(registry, args.language);
  const targetIndex = tracks.findIndex((track) => track.version === version);
  if (targetIndex < 0) requireTrack(registry, args.language, version);
  const track = tracks[targetIndex];
  const targetBitable = {
    version,
    baseToken: trackBaseToken(track),
    tableId: trackTableId(track),
  };
  const targetRoot = trackReleaseRootToken(track);
  const sourceVersionRoots = [];
  const adjacentBitables = [];
  // Tracks are ordered oldest first. Only tracks before the target are older
  // release roots that can physically hold inherited documents; every other
  // track can hold record pointers at this track's documents.
  for (const candidate of tracks.slice(0, targetIndex)) {
    const rootToken = trackReleaseRootToken(candidate);
    if (rootToken) sourceVersionRoots.push({ version: candidate.version, rootToken });
  }
  for (const candidate of tracks) {
    if (candidate.version === version) continue;
    adjacentBitables.push({
      version: candidate.version,
      baseToken: trackBaseToken(candidate),
      tableId: trackTableId(candidate),
    });
  }
  // The registry is the independent source of the required enumeration set:
  // every registered track of the language can hold record pointers at this
  // track's documents, so all of them must be enumerated for sharing to be
  // known.
  const requiredTrackVersions = tracks.map((candidate) => candidate.version);
  return { targetBitable, targetRoot, sourceVersionRoots, adjacentBitables, requiredTrackVersions };
}

async function main(argv = process.argv) {
  const args = parseArgs(argv);
  const proposal = JSON.parse(fs.readFileSync(args.proposal, 'utf8'));
  const tokenFetcher = new larkTokenFetcher();

  let versionRootToken = args.versionRoot || null;
  const sourceVersionRoots = args.sourceVersionRoots.map(parseSourceVersionRoot);
  const trackBitables = [];
  const requiredTrackVersions = [...args.requiredTracks];
  if (args.targetBitable) {
    trackBitables.push({ version: args.version, ...parseBitableTarget(args.targetBitable) });
  }
  for (const value of args.adjacentBitables) trackBitables.push(parseAdjacentBitable(value));

  if (args.language) {
    const resolved = resolveRegistryContext({
      args,
      version: args.version,
      registryPath: args.registry ? path.resolve(args.registry) : undefined,
    });
    if (!versionRootToken) versionRootToken = resolved.targetRoot;
    if (!trackBitables.some((track) => track.version === args.version)) {
      trackBitables.unshift(resolved.targetBitable);
    }
    if (args.adjacentBitables.length === 0) {
      for (const adjacent of resolved.adjacentBitables) {
        if (!trackBitables.some((track) => track.version === adjacent.version)) {
          trackBitables.push(adjacent);
        }
      }
    }
    for (const source of resolved.sourceVersionRoots) {
      if (!sourceVersionRoots.some((item) => item.version === source.version)) {
        sourceVersionRoots.push(source);
      }
    }
    requiredTrackVersions.push(...resolved.requiredTrackVersions);
  }

  if (!versionRootToken) {
    throw new Error('Missing --version-root (or --language with a registered release root)');
  }

  const artifact = await buildPlacementAudit({
    proposal,
    version: args.version,
    versionRootToken,
    sourceVersionRoots,
    indexer: (rootToken) => indexVersionRoot(tokenFetcher, rootToken),
    trackBitables,
    recordLister: ({ baseToken, tableId }) => listBitableRecords(tokenFetcher, baseToken, tableId),
    requiredTrackVersions,
  });
  artifact.sourceProposal = args.proposal;
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({
    output: args.output,
    status: artifact.status,
    inheritanceEvidenceStatus: artifact.inheritanceEvidenceStatus,
    entries: artifact.entries.length,
    blocked: artifact.blocked.length,
    evidenceBlocked: artifact.evidenceBlocked.length,
    sharedTokenSummary: artifact.sharedTokenSummary,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  buildPlacementAudit,
  indexVersionRoot,
  listBitableRecords,
  parseAdjacentBitable,
  parseArgs,
  parseBitableTarget,
  parseSourceVersionRoot,
  proposalEntries,
  resolveRegistryContext,
  tokenFromLink,
};

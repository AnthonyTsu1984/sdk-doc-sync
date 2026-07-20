#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const fetch = require('node-fetch');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';

function parseArgs(argv = process.argv) {
  const args = { sourceVersionRoots: [] };
  const options = new Set(['--proposal', '--version', '--version-root', '--output', '--source-version-root']);
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!options.has(key)) throw new Error(`Unknown argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    if (key === '--source-version-root') {
      args.sourceVersionRoots.push(value);
    } else {
      args[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    }
    index += 1;
  }
  for (const key of ['proposal', 'version', 'versionRoot', 'output']) {
    if (!args[key]) throw new Error(`Missing --${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  }
  return args;
}

function parseSourceVersionRoot(value) {
  const match = String(value || '').match(/^([^:=]+)[:=](.+)$/);
  if (!match) throw new Error(`Invalid --source-version-root ${value}; expected <version>:<folderToken>`);
  return { version: match[1], rootToken: match[2] };
}

function tokenFromLink(link) {
  return String(link || '').match(/\/docx\/([^/?#]+)/)?.[1] || '';
}

function isNonemptyConfigurationString(value) {
  return typeof value === 'string' && value.trim().length > 0 && value === value.trim();
}

function validateVersionRoots({ version, versionRootToken, sourceVersionRoots }) {
  if (!isNonemptyConfigurationString(version)) {
    throw new Error('Invalid target version: expected a nonempty string');
  }
  if (!isNonemptyConfigurationString(versionRootToken)) {
    throw new Error('Invalid target versionRootToken: expected a nonempty string');
  }
  if (!Array.isArray(sourceVersionRoots)) {
    throw new Error('Invalid sourceVersionRoots: expected an array');
  }

  const versions = new Set();
  const rootTokens = new Set();
  for (let index = 0; index < sourceVersionRoots.length; index += 1) {
    const root = sourceVersionRoots[index];
    if (!root || typeof root !== 'object' || Array.isArray(root)) {
      throw new Error(`Invalid sourceVersionRoots[${index}]: expected an object`);
    }
    if (!isNonemptyConfigurationString(root.version)) {
      throw new Error(`Invalid sourceVersionRoots[${index}].version: expected a nonempty string`);
    }
    if (!isNonemptyConfigurationString(root.rootToken)) {
      throw new Error(`Invalid sourceVersionRoots[${index}].rootToken: expected a nonempty string`);
    }
    if (root.version === version) {
      throw new Error(`Invalid sourceVersionRoots[${index}]: source version "${root.version}" must differ from target version`);
    }
    if (root.rootToken === versionRootToken) {
      throw new Error(`Invalid sourceVersionRoots[${index}]: source rootToken "${root.rootToken}" must differ from target versionRootToken`);
    }
    if (versions.has(root.version)) {
      throw new Error(`Invalid sourceVersionRoots: duplicate version label "${root.version}"`);
    }
    if (rootTokens.has(root.rootToken)) {
      throw new Error(`Invalid sourceVersionRoots: duplicate rootToken "${root.rootToken}"`);
    }
    versions.add(root.version);
    rootTokens.add(root.rootToken);
  }
  return true;
}

function normalizeSharedTokenEvidence(evidence, { targetVersion, sourceVersionRoots }) {
  const source = 'proposal.existingBitable.sharedTokenEvidence';
  if (evidence == null) {
    return {
      source,
      status: 'missing',
      checked: null,
      referencedByOlderVersions: null,
      versions: [],
    };
  }

  const versionsAreArray = Array.isArray(evidence.versions);
  const versions = versionsAreArray ? [...evidence.versions] : [];
  const reviewedVersions = sourceVersionRoots.map((root) => root.version);
  const reviewedVersionSet = new Set(reviewedVersions);
  const versionsAreStrings = versions.every(
    (version) => typeof version === 'string' && version.trim().length > 0,
  );
  const versionsAreUnique = new Set(versions).size === versions.length;
  const versionsMatchReviewedRoots = versions.length === reviewedVersionSet.size
    && versions.every((version) => reviewedVersionSet.has(version));
  const emptySetEvidence = reviewedVersionSet.size === 0
    && evidence.referencedByOlderVersions === false
    && versions.length === 0;
  const reviewedOlderVersionEvidence = reviewedVersionSet.size > 0 && versions.length > 0;
  const valid = evidence.checked === true
    && typeof evidence.referencedByOlderVersions === 'boolean'
    && versionsAreArray
    && versionsAreStrings
    && versionsAreUnique
    && !versions.includes(targetVersion)
    && versionsMatchReviewedRoots
    && (emptySetEvidence || reviewedOlderVersionEvidence);
  return {
    source,
    status: valid ? 'verified' : 'malformed',
    checked: evidence.checked ?? null,
    referencedByOlderVersions: typeof evidence.referencedByOlderVersions === 'boolean'
      ? evidence.referencedByOlderVersions
      : null,
    versions,
  };
}

function blockedReasonsFor({ placementVerified, sharedTokenEvidence }) {
  const reasons = [];
  if (!placementVerified) {
    reasons.push({
      code: 'DRIVE_PLACEMENT_UNVERIFIED',
      message: 'The current Docs token was not found in the reviewed Drive version roots.',
    });
  }
  if (sharedTokenEvidence.status === 'missing') {
    reasons.push({
      code: 'SHARED_TOKEN_EVIDENCE_MISSING',
      message: 'Explicit cross-version Bitable shared-token evidence is required.',
    });
  } else if (sharedTokenEvidence.status === 'malformed') {
    reasons.push({
      code: 'SHARED_TOKEN_EVIDENCE_MALFORMED',
      message: 'Shared-token evidence requires checked=true, a boolean referencedByOlderVersions, and each reviewed older source version exactly once.',
    });
  }
  return reasons;
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
      sharedTokenEvidence: item.existingBitable.sharedTokenEvidence ?? null,
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

async function buildPlacementAudit({
  proposal,
  version,
  versionRootToken,
  sourceVersionRoots = [],
  indexer,
}) {
  validateVersionRoots({ version, versionRootToken, sourceVersionRoots });
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

  const entries = proposalEntries(proposal).map((entry) => {
    const match = indexes.find((item) => item.index.has(entry.documentToken));
    const placement = match?.index.get(entry.documentToken);
    const verified = Boolean(match && placement);
    const sharedTokenEvidence = normalizeSharedTokenEvidence(entry.sharedTokenEvidence, {
      targetVersion: version,
      sourceVersionRoots,
    });
    const blockedReasons = blockedReasonsFor({
      placementVerified: verified,
      sharedTokenEvidence,
    });
    return {
      ...entry,
      sharedTokenEvidence,
      blockedReasons,
      placement: {
        verified,
        status: verified ? (match.target ? 'current_version_local' : 'inherited_source') : 'unverified',
        version: verified ? match.version : null,
        folderToken: placement?.parentFolderToken || null,
        versionRootToken: match?.rootToken || null,
        referencedByOlderVersions: sharedTokenEvidence.status === 'verified'
          ? sharedTokenEvidence.referencedByOlderVersions
          : null,
        ancestry: placement?.ancestors || [],
      },
    };
  });
  return {
    schemaVersion: 1,
    status: entries.every((entry) => entry.blockedReasons.length === 0)
      ? 'placement_audit_ready'
      : 'placement_audit_blocked',
    generatedAt: new Date().toISOString(),
    version,
    versionRootToken,
    sourceVersionRoots,
    entries,
    blocked: entries.filter((entry) => entry.blockedReasons.length > 0),
    writesPerformed: false,
  };
}

async function main(argv = process.argv) {
  const args = parseArgs(argv);
  const proposal = JSON.parse(fs.readFileSync(args.proposal, 'utf8'));
  const tokenFetcher = new larkTokenFetcher();
  const sourceVersionRoots = args.sourceVersionRoots.map(parseSourceVersionRoot);
  const artifact = await buildPlacementAudit({
    proposal,
    version: args.version,
    versionRootToken: args.versionRoot,
    sourceVersionRoots,
    indexer: (rootToken) => indexVersionRoot(tokenFetcher, rootToken),
  });
  artifact.sourceProposal = args.proposal;
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({
    output: args.output,
    status: artifact.status,
    entries: artifact.entries.length,
    blocked: artifact.blocked.length,
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
  parseArgs,
  parseSourceVersionRoot,
  proposalEntries,
  normalizeSharedTokenEvidence,
  tokenFromLink,
  validateVersionRoots,
};

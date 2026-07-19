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

async function buildPlacementAudit({
  proposal,
  version,
  versionRootToken,
  sourceVersionRoots = [],
  indexer,
}) {
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
    return {
      ...entry,
      placement: {
        verified,
        status: verified ? (match.target ? 'current_version_local' : 'inherited_source') : 'unverified',
        version: verified ? match.version : null,
        folderToken: placement?.parentFolderToken || null,
        versionRootToken: match?.rootToken || null,
        referencedByOlderVersions: verified ? !match.target : null,
        ancestry: placement?.ancestors || [],
      },
    };
  });
  return {
    schemaVersion: 1,
    status: entries.every((entry) => entry.placement.verified) ? 'placement_audit_ready' : 'placement_audit_blocked',
    generatedAt: new Date().toISOString(),
    version,
    versionRootToken,
    sourceVersionRoots,
    entries,
    blocked: entries.filter((entry) => !entry.placement.verified),
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
    entries: entries.length,
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
  tokenFromLink,
};

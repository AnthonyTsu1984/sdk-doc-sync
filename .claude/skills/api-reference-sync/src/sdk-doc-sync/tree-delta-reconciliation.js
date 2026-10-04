'use strict';

// Read-only reconciliation for the api.versioned-tree-delta invariant
// (plan §6a). Consumes normalized two-track Bitable indexes, the target
// release-root folder inventory, target category VirtualNode records, and the
// cross-track token reference map; reports typed findings without mutating
// anything. Reconciliation detects manual edits and historical drift — it does
// not authorize cleanup and does not replace the pre-write guard.

const { INVARIANT_ID, FOLDER_ANCESTRY_MAX_DEPTH } = require('./versioned-tree-policy');
const { sha256Digest } = require('../../../doc-ops-core/src/digest');

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function folderTokenFromLink(link) {
  if (!nonEmptyString(link)) return null;
  const match = /\/drive\/folder\/([A-Za-z0-9]+)/.exec(link);
  return match ? match[1] : null;
}

function documentTokenFromLink(link) {
  if (!nonEmptyString(link)) return null;
  const match = /\/docx\/([A-Za-z0-9]+)/.exec(link);
  return match ? match[1] : null;
}

// Live containment evidence for the kernel v3 copy gates: walks the Drive tree
// breadth-first from the track's version root and returns the folder chain
// [versionRoot, ..., folderToken] (inclusive), or null when folderToken is not
// reachable under versionRootToken. `listFolder` is injected ({ folderToken,
// type } => files[]) so planning and execution share one derivation —
// planning binds the chain into the plan, the executor re-derives it live
// before the first write. The visited set keeps a token reachable through
// two parents from being queued twice and terminates folder cycles.
// Derive the folder-NAME sequence of a containment chain (version root
// excluded — roots differ by design), resolving each level's name from the
// live tree. Shared by the executor's kernel v5 copy-structure mirror gate
// and the batch-level post-write drift observation. Returns null when the
// chain is unreachable or a level's name cannot be resolved.
async function deriveFolderChainNames({ listFolder, versionRootToken, folderToken }) {
    const chain = await deriveFolderAncestry({ listFolder, versionRootToken, folderToken });
    if (!chain || chain.length < 2) return null;
    const names = [];
    for (let level = 1; level < chain.length; level += 1) {
        const children = await listFolder({ folderToken: chain[level - 1], type: 'all' });
        const entry = (children || []).find((item) => (item.token || item.file_token) === chain[level]);
        if (!entry || typeof entry.name !== 'string' || entry.name === '') return null;
        names.push(entry.name);
    }
    return names;
}

async function deriveFolderAncestry({
  listFolder,
  versionRootToken,
  folderToken,
  maxDepth = FOLDER_ANCESTRY_MAX_DEPTH,
} = {}) {
  if (typeof listFolder !== 'function') {
    throw new TypeError('deriveFolderAncestry requires a listFolder function');
  }
  if (!nonEmptyString(versionRootToken) || !nonEmptyString(folderToken)) return null;
  if (versionRootToken === folderToken) return null; // a category folder cannot be the version root itself
  const visited = new Set([versionRootToken]);
  let frontier = [{ token: versionRootToken, chain: [versionRootToken] }];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const next = [];
    for (const node of frontier) {
      const children = await listFolder({ folderToken: node.token, type: 'folder' }) || [];
      for (const child of children) {
        const childToken = child?.token || child?.file_token || child?.folder_token || null;
        if (!nonEmptyString(childToken) || childToken === node.token || visited.has(childToken)) continue;
        const childType = child?.type || 'folder';
        if (childType !== 'folder' && childType !== 'all' && childType !== null) continue;
        visited.add(childToken);
        const chain = [...node.chain, childToken];
        if (childToken === folderToken) return chain;
        next.push({ token: childToken, chain });
      }
    }
    frontier = next;
  }
  return null;
}

// Normalized record shape: { recordId, slug, documentToken, link, type }.
function reconcileTreeDelta({
  baselineRecords,
  targetRecords,
  changedIdentities = null,
  mustRepointIdentities = null,
  targetFolders,
  categoryNodes,
  tokenReferences = null,
  evidenceInputs,
}) {
  const errors = [];
  const findings = [];
  const report = (severity, code, identity, detail) => {
    findings.push({ invariantId: INVARIANT_ID, severity, code, identity, detail });
    if (severity === 'error') errors.push(code);
  };

  const baselineBySlug = new Map();
  for (const record of baselineRecords || []) {
    if (nonEmptyString(record?.slug)) baselineBySlug.set(record.slug, record);
  }
  const targetBySlug = new Map();
  for (const record of targetRecords || []) {
    if (nonEmptyString(record?.slug)) targetBySlug.set(record.slug, record);
  }

  // 1. Delta inventory: every identity is added, changed, unchanged, or a
  // reviewed exception. Missing target pages for changed identities and
  // still-shared pages for changed identities are delta-model violations.
  // Issue #76 ruling: only the TARGET track's classification escalates
  // CHANGED_NOT_REPOINTED — a still-shared pointer after the target track's
  // own sync marked the identity changed is a genuinely missing fork, while a
  // baseline-track classification (source-track update) with a still-shared
  // pointer is the correct post-release state when the change flowed in
  // place (kernel v4 case 1), so it stays advisory. Direct callers passing
  // only changedIdentities keep the historical escalate-on-classified
  // behavior (mustRepointIdentities defaults to it).
  const repointClassifier = mustRepointIdentities || changedIdentities;
  const sharedIdentities = new Set();
  for (const [slug, baseline] of baselineBySlug) {
    const target = targetBySlug.get(slug);
    if (!target) {
      const severity = changedIdentities && changedIdentities.has(slug) ? 'error' : 'warn';
      report(severity, 'TREE_DELTA_TARGET_RECORD_MISSING', slug, {
        baselineDocumentToken: baseline.documentToken ?? null,
      });
      continue;
    }
    if (target.documentToken && target.documentToken === baseline.documentToken) {
      sharedIdentities.add(slug);
      if (changedIdentities && changedIdentities.has(slug)) {
        const severity = repointClassifier && repointClassifier.has(slug) ? 'error' : 'warn';
        report(severity, 'TREE_DELTA_CHANGED_NOT_REPOINTED', slug, {
          sharedDocumentToken: baseline.documentToken ?? null,
        });
      }
    } else if (changedIdentities && changedIdentities.has(slug)) {
      // changed with a target-local document: the expected post-transition state
    } else {
      // An unchanged identity with its own target-local document is a
      // candidate mirror — content comparison needs a reviewed exception or
      // content digest, so surface it for review instead of failing hard.
      report('warn', 'TREE_DELTA_UNCHANGED_DIVERGENT', slug, {
        baselineDocumentToken: baseline.documentToken ?? null,
        targetDocumentToken: target.documentToken ?? null,
      });
    }
  }
  for (const slug of targetBySlug.keys()) {
    if (!baselineBySlug.has(slug)) {
      // A newly added target-only interface legitimately has no older
      // counterpart; reported as informational only.
      findings.push({ invariantId: INVARIANT_ID, severity: 'info', code: 'TREE_DELTA_IDENTITY_ADDED', identity: slug, detail: {} });
    }
  }

  // 2. Shared-document integrity: a token both tracks agree on must still be
  // referenced by exactly the records that are supposed to share it. A shared
  // token referenced by a single record means one track was repointed away
  // (or a record link was hand-edited) without the corresponding transition.
  for (const slug of sharedIdentities) {
    const token = baselineBySlug.get(slug)?.documentToken;
    if (!nonEmptyString(token) || !tokenReferences) continue;
    const referencing = (tokenReferences[token] || []).filter(nonEmptyString);
    if (referencing.length < 2) {
      report('error', 'TREE_DELTA_SHARED_LINK_BROKEN', slug, {
        documentToken: token,
        referencingRecordIds: referencing,
      });
    }
  }

  // 3. VirtualNode/folder integrity: category node links must resolve to a
  // folder in the target release-root inventory, and every governed folder
  // needs a visible purpose. Orphans are warnings for review, not cleanup
  // authorization.
  const linkedFolderTokens = new Set();
  for (const node of categoryNodes || []) {
    if (!nonEmptyString(node?.slug)) continue;
    const folderToken = folderTokenFromLink(node.link);
    if (!folderToken) {
      report('error', 'TREE_DELTA_NODE_LINK_INVALID', node.slug, { link: node.link ?? null });
      continue;
    }
    const folder = (targetFolders || []).find(entry => (entry.token || entry.folder_token) === folderToken);
    if (!folder) {
      report('error', 'TREE_DELTA_NODE_NOT_UNDER_ROOT', node.slug, { folderToken, versionRoot: evidenceInputs?.versionRootToken ?? null });
      continue;
    }
    linkedFolderTokens.add(folderToken);
    if (node.type && node.type !== 'VirtualNode') {
      report('error', 'TREE_DELTA_NODE_TYPE_INVALID', node.slug, { type: node.type });
    }
  }
  for (const folder of targetFolders || []) {
    const token = folder.token || folder.folder_token;
    if (!nonEmptyString(token) || linkedFolderTokens.has(token)) continue;
    report('warn', 'TREE_DELTA_ORPHAN_FOLDER', folder.name || token, { folderToken: token });
  }

  const evidenceDigest = sha256Digest(Buffer.from(
    JSON.stringify(evidenceInputs || {}),
    'utf8',
  ));
  return {
    invariantId: INVARIANT_ID,
    evidenceDigest,
    ok: errors.length === 0,
    summary: {
      errors: errors.length,
      warnings: findings.filter(finding => finding.severity === 'warn').length,
      infos: findings.filter(finding => finding.severity === 'info').length,
      sharedIdentities: sharedIdentities.size,
    },
    findings,
  };
}

module.exports = {
    deriveFolderChainNames,
  deriveFolderAncestry,
  documentTokenFromLink,
  folderTokenFromLink,
  reconcileTreeDelta,
};

'use strict';

// Read-only reconciliation for the api.versioned-tree-delta invariant
// (plan §6a). Consumes normalized two-track Bitable indexes, the target
// release-root folder inventory, target category VirtualNode records, and the
// cross-track token reference map; reports typed findings without mutating
// anything. Reconciliation detects manual edits and historical drift — it does
// not authorize cleanup and does not replace the pre-write guard.

const { INVARIANT_ID } = require('./versioned-tree-policy');
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

// Normalized record shape: { recordId, slug, documentToken, link, type }.
function reconcileTreeDelta({
  baselineRecords,
  targetRecords,
  changedIdentities = null,
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
        report('error', 'TREE_DELTA_CHANGED_NOT_REPOINTED', slug, {
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
  documentTokenFromLink,
  folderTokenFromLink,
  reconcileTreeDelta,
};

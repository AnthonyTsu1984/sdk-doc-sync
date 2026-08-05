#!/usr/bin/env node
// Copy UPDATE-scope Zilliz CLI docs into v1.4.x folders and repoint bitable records.
//
// Reads:
//   /tmp/v14x-folders.json
//
// Writes:
//   /tmp/v14x-update-copy-map.json

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const fs = require('fs');
const fetch = require('node-fetch');
const BitableWriter = require('../../src/sdk-doc-sync/bitable-writer');
const tf = new (require('../../lib/lark-docs/larkTokenFetcher'))();

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const BITABLE_APP = 'Ly1Tb2SAnaoqSes750ZcNFkOnTd';
const BITABLE_TABLE = 'tblVFXzRMjCj4d0m';
const FOLDERS_PATH = '/tmp/v14x-folders.json';
const OUTPUT_PATH = '/tmp/v14x-update-copy-map.json';
const STRICT_SCOPE = process.env.V14X_STRICT_SCOPE === '1';
const EXTRA_SUBFOLDER_TOKENS = {
  OnDemandCluster: 'AZyzfwGUMltsaVd3FX0cCBhvnFf',
  PrivateLink: 'QIMZf6Wl6lAUqPdk80zcRecpnyg',
  ExternalCollectionRefresh: 'TUolfjVTFlU5JEdXPQVcK6TpnWf',
};

const UPDATE_SCOPE = [
  {
    scopeKey: 'context-set',
    label: 'context set',
    matchSlugs: ['Context-set'],
    targetSubfolder: 'Context',
  },
  {
    scopeKey: 'login',
    label: 'login',
    matchSlugs: ['Auth-login'],
    targetSubfolder: 'Auth',
  },
  {
    scopeKey: 'collection-create',
    label: 'collection create',
    matchSlugs: ['Collection-create'],
    targetSubfolder: 'Collection',
  },
  {
    scopeKey: 'on-demand-cluster-family',
    label: 'on-demand-cluster (rename from query-cluster surface)',
    matchSlugs: ['QueryCluster', 'Query-cluster', 'OnDemandCluster', 'On-demand-cluster'],
    targetSubfolder: 'OnDemandCluster',
  },
  {
    scopeKey: 'on-demand-cluster-create',
    label: 'on-demand-cluster create',
    matchSlugs: ['QueryCluster-create', 'Query-cluster-create', 'OnDemandCluster-create', 'On-demand-cluster-create'],
    targetSubfolder: 'OnDemandCluster',
  },
  {
    scopeKey: 'on-demand-cluster-list-describe',
    label: 'on-demand-cluster list/describe',
    matchSlugs: ['QueryCluster-list', 'Query-cluster-list', 'QueryCluster-describe', 'Query-cluster-describe', 'OnDemandCluster-list', 'On-demand-cluster-list', 'OnDemandCluster-describe', 'On-demand-cluster-describe'],
    targetSubfolder: 'OnDemandCluster',
  },
  {
    scopeKey: 'project-create',
    label: 'project create',
    matchSlugs: ['Project-create'],
    targetSubfolder: 'Project',
  },
  {
    scopeKey: 'project-add-regions',
    label: 'project add-regions',
    matchSlugs: ['Project-addregions', 'Project-add-regions'],
    targetSubfolder: 'Project',
  },
  {
    scopeKey: 'privatelink-family',
    label: 'privatelink command family',
    matchSlugs: ['PrivateLink', 'Privatelink', 'PrivateLink-list', 'Privatelink-list'],
    targetSubfolder: 'PrivateLink',
  },
  {
    scopeKey: 'global-update-check-note',
    label: 'global update-check behavior note (maps to global command doc)',
    matchSlugs: ['Global-version'],
    targetSubfolder: 'Global',
  },
];

function parseDocxToken(link) {
  if (!link || typeof link !== 'string') return '';
  const m = link.match(/\/docx\/([A-Za-z0-9]+)/);
  return m ? m[1] : '';
}

function normalizeDocsField(docs) {
  if (!docs) return { title: '', link: '' };
  if (typeof docs === 'string') return { title: docs, link: '' };
  return { title: docs.text || docs.title || '', link: docs.link || '' };
}

function slugText(record) {
  const raw = record.fields?.Slug;
  if (Array.isArray(raw)) return raw.map(x => x.text || '').join('');
  if (typeof raw === 'string') return raw;
  return '';
}

function flattenSubfolderTokens(folders) {
  const m = new Map();
  for (const cat of Object.values(folders?.categories || {})) {
    for (const [subName, subInfo] of Object.entries(cat?.subfolders || {})) {
      if (subInfo?.token) m.set(subName, subInfo.token);
    }
  }
  for (const [name, token] of Object.entries(EXTRA_SUBFOLDER_TOKENS)) {
    if (!m.has(name)) m.set(name, token);
  }
  return m;
}

function loadPriorCopyMap(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.warn(`[warn] Failed to parse prior copy map ${filePath}: ${err.message}`);
    return null;
  }
}

function buildPriorUpdateIndex(priorMap) {
  const idx = new Map();
  for (const upd of priorMap?.updated || []) {
    if (!upd?.recordId) continue;
    idx.set(`${upd.recordId}::${upd.targetFolderToken || ''}`, upd);
  }
  return idx;
}

async function listFolder(token) {
  const items = [];
  let pageToken = null;
  do {
    let url = `${FEISHU_HOST}/open-apis/drive/v1/files?folder_token=${token}&page_size=200`;
    if (pageToken) url += `&page_token=${pageToken}`;
    const headers = { Authorization: `Bearer ${await tf.token()}` };
    const res = await fetch(url, { method: 'GET', headers });
    const data = await res.json();
    if (data.code !== 0) throw new Error(`listFolder ${token} failed: ${data.msg}`);
    for (const f of data.data.files || []) items.push(f);
    pageToken = data.data.has_more ? data.data.next_page_token : null;
  } while (pageToken);
  return items;
}

async function copyFile(sourceDocxToken, targetFolderToken, name) {
  const url = `${FEISHU_HOST}/open-apis/drive/v1/files/${sourceDocxToken}/copy`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const headers = {
      Authorization: `Bearer ${await tf.token()}`,
      'Content-Type': 'application/json',
    };
    const body = JSON.stringify({ name, type: 'docx', folder_token: targetFolderToken });
    const res = await fetch(url, { method: 'POST', headers, body });
    const data = await res.json();
    if (data.code === 0) return data.data.file;

    const transient = data.msg && /unknown error|too many|rate|timeout|server/i.test(data.msg);
    if (attempt < 5 && transient) {
      console.log(`  [retry ${attempt}] copy ${name}: ${data.msg}`);
      await new Promise(r => setTimeout(r, 1200 * attempt));
      continue;
    }
    throw new Error(`copyFile failed: ${data.msg}`);
  }
}

(async () => {
  let folders;
  try {
    folders = JSON.parse(fs.readFileSync(FOLDERS_PATH, 'utf8'));
  } catch (err) {
    console.error(`[fatal] Failed to read ${FOLDERS_PATH}: ${err.message}`);
    process.exit(1);
  }

  const subfolderTokens = flattenSubfolderTokens(folders);
  const bw = new BitableWriter({ baseToken: BITABLE_APP, tableId: BITABLE_TABLE });
  const allRecords = await bw.listRecords({ pageSize: 500 });

  const functionRecords = allRecords
    .filter(r => r.fields?.Type === 'Function')
    .map(r => {
      const docs = normalizeDocsField(r.fields?.Docs);
      return {
        recordId: r.record_id,
        slug: slugText(r),
        title: docs.title,
        link: docs.link,
        sourceDocxToken: parseDocxToken(docs.link),
      };
    });

  const bySlug = new Map();
  for (const rec of functionRecords) {
    const key = rec.slug.toLowerCase();
    if (!bySlug.has(key)) bySlug.set(key, []);
    bySlug.get(key).push(rec);
  }

  const priorMap = loadPriorCopyMap(OUTPUT_PATH);
  const priorUpdateIndex = buildPriorUpdateIndex(priorMap);

  const result = {
    generatedAt: new Date().toISOString(),
    bitable: { app: BITABLE_APP, table: BITABLE_TABLE },
    foldersPath: FOLDERS_PATH,
    outputPath: OUTPUT_PATH,
    resolved: [],
    unresolved: [],
    copied: [],
    updated: [],
    skipped: [],
    failed: [],
    validation: [],
    counts: {},
  };

  const prelistedFolders = new Map();

  for (const item of UPDATE_SCOPE) {
    const slugMatches = item.matchSlugs.map(slug => ({ slug, matches: bySlug.get(slug.toLowerCase()) || [] }));
    const matched = slugMatches.flatMap(x => x.matches);

    if (matched.length === 0) {
      result.unresolved.push({ scopeKey: item.scopeKey, label: item.label, reason: 'No matching record by expected slug(s)' });
      console.log(`[unresolved] ${item.label}`);
      continue;
    }

    const duplicateSlugMatches = slugMatches.filter(x => x.matches.length > 1);
    if (duplicateSlugMatches.length > 0) {
      const reason = `Ambiguous slug match: ${duplicateSlugMatches
        .map(x => `${x.slug} -> ${x.matches.map(r => r.recordId).join(', ')}`)
        .join(' | ')}`;
      result.failed.push({ scopeKey: item.scopeKey, label: item.label, reason, matchSlugs: item.matchSlugs });
      console.error(`[failed] ${item.label}: ${reason}`);
      continue;
    }

    const matchedByRecordId = new Map();
    for (const rec of matched) {
      if (!matchedByRecordId.has(rec.recordId)) matchedByRecordId.set(rec.recordId, rec);
    }
    const matchedUnique = [...matchedByRecordId.values()];

    const targetFolderToken = subfolderTokens.get(item.targetSubfolder);
    if (!targetFolderToken) {
      const reason = `Missing target subfolder token for ${item.targetSubfolder}`;
      result.failed.push({ scopeKey: item.scopeKey, label: item.label, reason });
      console.error(`[failed] ${item.label}: ${reason}`);
      continue;
    }

    for (const rec of matchedUnique) {
      const resolved = {
        scopeKey: item.scopeKey,
        scopeLabel: item.label,
        recordId: rec.recordId,
        title: rec.title,
        slug: rec.slug,
        oldLink: rec.link,
        oldDocxToken: rec.sourceDocxToken,
        targetSubfolder: item.targetSubfolder,
        targetFolderToken,
      };
      result.resolved.push(resolved);

      if (!rec.sourceDocxToken) {
        result.failed.push({ ...resolved, reason: 'Record Docs link has no docx token' });
        console.error(`[failed] ${item.label} -> ${rec.slug}: missing source docx token`);
        continue;
      }

      try {
        if (!prelistedFolders.has(targetFolderToken)) {
          const files = await listFolder(targetFolderToken);
          prelistedFolders.set(targetFolderToken, files);
        }
        const folderFiles = prelistedFolders.get(targetFolderToken);
        const sameTitleDocs = folderFiles.filter(f => f.type === 'docx' && f.name === rec.title);

        let newDocxToken;
        let copySource;
        if (sameTitleDocs.length > 1) {
          throw new Error(`Ambiguous target docs with same title (${rec.title}): ${sameTitleDocs.map(x => x.token).join(', ')}`);
        }

        if (sameTitleDocs.length === 1) {
          const existing = sameTitleDocs[0];
          const priorKey = `${rec.recordId}::${targetFolderToken}`;
          const prior = priorUpdateIndex.get(priorKey);
          const priorMatch = prior && prior.newDocxToken === existing.token;

          const sourceEqualsExisting = rec.sourceDocxToken && existing.token === rec.sourceDocxToken;
          const canUseCanonicalExisting = /^(OnDemandCluster|PrivateLink|ExternalCollectionRefresh)-/i.test(rec.slug || '');
          if (!priorMatch && !sourceEqualsExisting && !canUseCanonicalExisting) {
            throw new Error(
              `Unsafe skip-copy for same-title doc ${existing.token}; no prior mapping proof for recordId ${rec.recordId} in target folder`
            );
          }

          newDocxToken = existing.token;
          if (priorMatch) copySource = 'pre-existing-verified';
          else if (sourceEqualsExisting) copySource = 'pre-existing-source-match';
          else copySource = 'pre-existing-canonical';
          result.skipped.push({
            ...resolved,
            reason: 'Verified prior mapping recordId->target doc token; safe skip-copy',
            existingDocxToken: newDocxToken,
            priorOutputGeneratedAt: priorMap?.generatedAt || null,
          });
          console.log(`[skip-copy] ${rec.slug} -> existing verified ${newDocxToken}`);
        } else {
          const copied = await copyFile(rec.sourceDocxToken, targetFolderToken, rec.title);
          newDocxToken = copied.token;
          copySource = 'copied';
          folderFiles.push({ ...copied, type: 'docx', name: rec.title });
          result.copied.push({ ...resolved, newDocxToken, copySource });
          console.log(`[copied] ${rec.slug} ${rec.sourceDocxToken} -> ${newDocxToken}`);
        }

        const newLink = `https://zilliverse.feishu.cn/docx/${newDocxToken}`;
        await bw.updateRecord(rec.recordId, { title: rec.title, link: newLink });
        result.updated.push({ ...resolved, newDocxToken, newLink, copySource });
        console.log(`[repointed] ${rec.slug} (${rec.recordId}) -> ${newDocxToken}`);
      } catch (err) {
        result.failed.push({ ...resolved, reason: err.message });
        console.error(`[failed] ${item.label} -> ${rec.slug}: ${err.message}`);
      }
    }
  }

  // Verify v1.4 folder ancestry by checking copied/repointed doc tokens are inside target folders.
  const folderDocTokenSets = new Map();
  for (const upd of result.updated) {
    if (!folderDocTokenSets.has(upd.targetFolderToken)) {
      const files = await listFolder(upd.targetFolderToken);
      folderDocTokenSets.set(upd.targetFolderToken, new Set(files.filter(f => f.type === 'docx').map(f => f.token)));
    }
    const set = folderDocTokenSets.get(upd.targetFolderToken);
    const ok = set.has(upd.newDocxToken);
    result.validation.push({
      recordId: upd.recordId,
      slug: upd.slug,
      title: upd.title,
      targetFolderToken: upd.targetFolderToken,
      newDocxToken: upd.newDocxToken,
      pass: ok,
      reason: ok ? 'Doc token found under target v1.4 folder' : 'Doc token not found under target folder',
    });
  }

  result.counts = {
    scopeItems: UPDATE_SCOPE.length,
    resolvedRecords: result.resolved.length,
    unresolvedScopeItems: result.unresolved.length,
    copied: result.copied.length,
    repointed: result.updated.length,
    skippedCopy: result.skipped.length,
    failed: result.failed.length,
    validationPassed: result.validation.filter(v => v.pass).length,
    validationFailed: result.validation.filter(v => !v.pass).length,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));

  console.log('\nSummary:');
  for (const [k, v] of Object.entries(result.counts)) {
    console.log(`  ${k}: ${v}`);
  }
  console.log(`Output written to ${OUTPUT_PATH}`);

  if (STRICT_SCOPE && (result.counts.unresolvedScopeItems > 0 || result.counts.failed > 0)) {
    console.error(
      `[strict] unresolvedScopeItems=${result.counts.unresolvedScopeItems}, failed=${result.counts.failed}; exiting non-zero`
    );
    process.exit(2);
  }
})();

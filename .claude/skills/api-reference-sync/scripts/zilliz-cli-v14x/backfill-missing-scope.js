#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const BitableWriter = require('../../src/sdk-doc-sync/bitable-writer');
const MarkdownToFeishu = require('../../src/markdown-to-feishu');
const tf = new (require('../../lib/lark-docs/larkTokenFetcher'))();

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const BITABLE_APP = 'Ly1Tb2SAnaoqSes750ZcNFkOnTd';
const BITABLE_TABLE = 'tblVFXzRMjCj4d0m';
const DOC_BASE = 'https://zilliverse.feishu.cn/docx';

const OUTPUT_PATH = '/tmp/v14x-backfill-results.json';
const MARKDOWN_DIR = path.resolve(__dirname, 'markdown', 'backfill');
const DRY_RUN = process.argv.includes('--dry-run');

const SPECS = [
  { key: 'on-demand-cluster-create', title: 'create', markdownFile: 'on-demand-cluster-create.md', parentRecordId: 'recvjyLcUDT46I', folderToken: 'AZyzfwGUMltsaVd3FX0cCBhvnFf', expectedSlugPrefixes: ['OnDemandCluster', 'On-demand-cluster'] },
  { key: 'on-demand-cluster-list', title: 'list', markdownFile: 'on-demand-cluster-list.md', parentRecordId: 'recvjyLcUDT46I', folderToken: 'AZyzfwGUMltsaVd3FX0cCBhvnFf', expectedSlugPrefixes: ['OnDemandCluster', 'On-demand-cluster'] },
  { key: 'on-demand-cluster-describe', title: 'describe', markdownFile: 'on-demand-cluster-describe.md', parentRecordId: 'recvjyLcUDT46I', folderToken: 'AZyzfwGUMltsaVd3FX0cCBhvnFf', expectedSlugPrefixes: ['OnDemandCluster', 'On-demand-cluster'] },
  { key: 'project-add-regions', title: 'add-regions', markdownFile: 'project-add-regions.md', parentRecordId: 'recveEKqd7G2GE', folderToken: 'VO75fmX0El7YQhdr9pqciDXcnNb', expectedSlugPrefixes: ['Project'] },
  { key: 'privatelink-list', title: 'list', markdownFile: 'privatelink-list.md', parentRecordId: 'recvjyLe8NPvzV', folderToken: 'QIMZf6Wl6lAUqPdk80zcRecpnyg', expectedSlugPrefixes: ['PrivateLink', 'Privatelink'] },
  { key: 'external-collection-refresh-trigger', title: 'trigger', markdownFile: 'external-collection-refresh-trigger.md', parentRecordId: 'recvjyLfsirYjS', folderToken: 'TUolfjVTFlU5JEdXPQVcK6TpnWf', expectedSlugPrefixes: ['ExternalCollectionRefresh'] },
  { key: 'external-collection-refresh-describe', title: 'describe', markdownFile: 'external-collection-refresh-describe.md', parentRecordId: 'recvjyLfsirYjS', folderToken: 'TUolfjVTFlU5JEdXPQVcK6TpnWf', expectedSlugPrefixes: ['ExternalCollectionRefresh'] },
  { key: 'external-collection-refresh-list', title: 'list', markdownFile: 'external-collection-refresh-list.md', parentRecordId: 'recvjyLfsirYjS', folderToken: 'TUolfjVTFlU5JEdXPQVcK6TpnWf', expectedSlugPrefixes: ['ExternalCollectionRefresh'] },
];

function normalizeDocsField(docs) {
  if (!docs) return { title: '', link: '' };
  if (typeof docs === 'string') return { title: docs, link: '' };
  return { title: docs.text || docs.title || '', link: docs.link || '' };
}

function extractSlug(record) {
  const raw = record.fields?.Slug;
  if (Array.isArray(raw)) return raw.map(x => x.text || '').join('');
  if (typeof raw === 'string') return raw;
  return '';
}

function parentRecordIds(field) {
  if (!Array.isArray(field)) return [];
  const out = [];
  for (const p of field) {
    if (typeof p === 'string') out.push(p);
    else if (p?.record_ids) out.push(...p.record_ids);
    else if (p?.record_id) out.push(p.record_id);
  }
  return out.filter(Boolean);
}

function parseDocxToken(link) {
  const m = (link || '').match(/\/docx\/([A-Za-z0-9]+)/);
  return m ? m[1] : '';
}

async function listFolderDocs(folderToken) {
  const all = [];
  let pageToken = null;
  do {
    let url = `${FEISHU_HOST}/open-apis/drive/v1/files?folder_token=${folderToken}&page_size=200`;
    if (pageToken) url += `&page_token=${pageToken}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${await tf.token()}` },
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error(`listFolderDocs(${folderToken}) failed: ${data.msg}`);
    all.push(...(data.data.files || []).filter(x => x.type === 'docx'));
    pageToken = data.data.has_more ? data.data.next_page_token : null;
  } while (pageToken);
  return all;
}

(async () => {
  const result = { generatedAt: new Date().toISOString(), dryRun: DRY_RUN, outputPath: OUTPUT_PATH, ensured: [], unresolved: [], failed: [], summary: {} };

  const bw = new BitableWriter({ baseToken: BITABLE_APP, tableId: BITABLE_TABLE });
  const records = await bw.listRecords({ pageSize: 500 });

  const byParentAndTitle = new Map();
  const byId = new Map();

  for (const r of records) {
    byId.set(r.record_id, r);
    if (r.fields?.Type !== 'Function') continue;
    const docs = normalizeDocsField(r.fields?.Docs);
    const item = { recordId: r.record_id, title: docs.title, link: docs.link, slug: extractSlug(r), parentRecordIds: parentRecordIds(r.fields?.父记录) };
    for (const pid of item.parentRecordIds) {
      byParentAndTitle.set(`${pid}::${(item.title || '').toLowerCase()}`, item);
    }
  }

  const folderDocsCache = new Map();

  for (const spec of SPECS) {
    try {
      const mdPath = path.join(MARKDOWN_DIR, spec.markdownFile);
      if (!fs.existsSync(mdPath)) { result.unresolved.push({ key: spec.key, reason: `Missing markdown file ${mdPath}` }); continue; }
      if (!byId.has(spec.parentRecordId)) { result.unresolved.push({ key: spec.key, reason: `Missing parent record ${spec.parentRecordId}` }); continue; }

      if (!folderDocsCache.has(spec.folderToken) && !DRY_RUN) folderDocsCache.set(spec.folderToken, await listFolderDocs(spec.folderToken));
      const folderDocs = folderDocsCache.get(spec.folderToken) || [];

      const existingRecord = byParentAndTitle.get(`${spec.parentRecordId}::${spec.title.toLowerCase()}`) || null;
      const existingDoc = folderDocs.find(d => d.name === spec.title) || null;

      let docId = existingDoc?.token || '';
      let docLink = docId ? `${DOC_BASE}/${docId}` : '';

      if (!docId) {
        if (DRY_RUN) {
          docId = '<dry-run-doc-id>'; docLink = `${DOC_BASE}/${docId}`;
        } else {
          const markdown = fs.readFileSync(mdPath, 'utf8');
          const m2f = new MarkdownToFeishu({ sourceType: 'drive', rootToken: spec.folderToken, baseToken: null });
          const push = await m2f.push_markdown({ markdown_content: markdown, title: spec.title, folder_token: spec.folderToken });
          docId = push.document_id; docLink = `${DOC_BASE}/${docId}`;
          folderDocs.push({ token: docId, name: spec.title, type: 'docx' });
        }
      }

      let recordId = existingRecord?.recordId || '';
      if (!recordId) {
        if (DRY_RUN) recordId = '<dry-run-record-id>';
        else {
          const created = await bw.createRecord({ title: spec.title, link: docLink, type: 'Function', addedSince: 'v1.4.x', progress: 'Draft', targets: ['Zilliz'], parentRecordId: spec.parentRecordId });
          recordId = created.record_id || created.record?.record_id;
        }
      } else if (!DRY_RUN && existingRecord.link !== docLink) {
        await bw.updateRecord(recordId, { title: existingRecord.title || spec.title, link: docLink });
      }

      let slug = existingRecord?.slug || '';

      const slugPass = slug ? spec.expectedSlugPrefixes.some(prefix => slug.toLowerCase().startsWith(prefix.toLowerCase())) : true;
      result.ensured.push({ key: spec.key, recordId, title: spec.title, slug, docId, docUrl: docLink, parentRecordId: spec.parentRecordId, folderToken: spec.folderToken, createdRecord: !existingRecord, createdDoc: !existingDoc, slugPass });
      if (!slugPass) result.failed.push({ key: spec.key, recordId, slug, reason: `Unexpected slug prefix for ${spec.key}` });
    } catch (err) {
      result.failed.push({ key: spec.key, reason: err.message });
    }
  }

  result.summary = {
    specs: SPECS.length,
    ensured: result.ensured.length,
    unresolved: result.unresolved.length,
    failed: result.failed.length,
    createdRecords: result.ensured.filter(x => x.createdRecord).length,
    createdDocs: result.ensured.filter(x => x.createdDoc).length,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
  console.log('Backfill summary');
  for (const [k, v] of Object.entries(result.summary)) console.log(`  ${k}: ${v}`);
  console.log(`Result written to ${OUTPUT_PATH}`);

  if (result.failed.length > 0) process.exit(2);
})();

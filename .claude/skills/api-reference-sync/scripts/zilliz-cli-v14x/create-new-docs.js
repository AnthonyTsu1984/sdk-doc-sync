#!/usr/bin/env node
// Create NEW-scope Zilliz CLI v1.4.x docs and Function records.
//
// Reads:
//   /tmp/v14x-folders.json
//   ./markdown/new/*.md
//
// Writes:
//   /tmp/v14x-new-docs-results.json

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
const FEISHU_DOC = 'https://zilliverse.feishu.cn/docx';

const FOLDERS_PATH = '/tmp/v14x-folders.json';
const MARKDOWN_DIR = path.resolve(__dirname, 'markdown', 'new');
const OUTPUT_PATH = '/tmp/v14x-new-docs-results.json';
const DRY_RUN = process.argv.includes('--dry-run');

const NEW_DOC_SPECS = [
  {
    key: 'external-collection-refresh-trigger',
    title: 'trigger',
    slug: 'ExternalCollectionRefresh-trigger',
    subfolder: 'ExternalCollectionRefresh',
    markdownFile: 'external-collection-refresh-trigger.md',
    parentVirtualNodeTitle: 'ExternalCollectionRefresh',
  },
  {
    key: 'external-collection-refresh-describe',
    title: 'describe',
    slug: 'ExternalCollectionRefresh-describe',
    subfolder: 'ExternalCollectionRefresh',
    markdownFile: 'external-collection-refresh-describe.md',
    parentVirtualNodeTitle: 'ExternalCollectionRefresh',
  },
  {
    key: 'external-collection-refresh-list',
    title: 'list',
    slug: 'ExternalCollectionRefresh-list',
    subfolder: 'ExternalCollectionRefresh',
    markdownFile: 'external-collection-refresh-list.md',
    parentVirtualNodeTitle: 'ExternalCollectionRefresh',
  },
  {
    key: 'upgrade-alias-update',
    title: 'upgrade',
    slug: 'Global-upgrade',
    subfolder: 'Global',
    markdownFile: 'upgrade.md',
    parentVirtualNodeTitle: 'Global',
  },
  {
    key: 'uninstall',
    title: 'uninstall',
    slug: 'Global-uninstall',
    subfolder: 'Global',
    markdownFile: 'uninstall.md',
    parentVirtualNodeTitle: 'Global',
  },
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

function isVirtualNodeRecord(record) {
  const typeField = record.fields?.Type;
  const values = Array.isArray(typeField) ? typeField : (typeField ? [typeField] : []);
  return values.includes('VirtualNode');
}

function extractParentRecordId(parentField) {
  if (!Array.isArray(parentField) || parentField.length === 0) return '';
  const first = parentField[0];
  if (typeof first === 'string') return first;
  if (first?.record_ids && Array.isArray(first.record_ids) && first.record_ids.length > 0) return first.record_ids[0];
  if (first?.record_id) return first.record_id;
  return '';
}

async function listFolderDocs(folderToken) {
  const files = [];
  let pageToken = null;
  do {
    let url = `${FEISHU_HOST}/open-apis/drive/v1/files?folder_token=${folderToken}&page_size=200`;
    if (pageToken) url += `&page_token=${pageToken}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${await tf.token()}` },
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error(`listFolderDocs ${folderToken}: ${data.msg}`);
    files.push(...(data.data.files || []).filter(f => f.type === 'docx'));
    pageToken = data.data.has_more ? data.data.next_page_token : null;
  } while (pageToken);
  return files;
}

(async () => {
  const result = {
    generatedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    bitable: { app: BITABLE_APP, table: BITABLE_TABLE },
    foldersPath: FOLDERS_PATH,
    markdownDir: MARKDOWN_DIR,
    outputPath: OUTPUT_PATH,
    created: [],
    skipped: [],
    unresolved: [],
    failed: [],
    summary: {},
  };

  let folders;
  try {
    folders = JSON.parse(fs.readFileSync(FOLDERS_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to read ${FOLDERS_PATH}: ${err.message}`);
  }

  const subfolderTokenByName = new Map();
  const subfolderCollisions = [];
  for (const [categoryName, category] of Object.entries(folders?.categories || {})) {
    for (const [subName, sub] of Object.entries(category?.subfolders || {})) {
      if (!sub?.token) continue;
      const existingToken = subfolderTokenByName.get(subName);
      if (existingToken && existingToken !== sub.token) {
        subfolderCollisions.push({ subName, categoryName, existingToken, newToken: sub.token });
        continue;
      }
      subfolderTokenByName.set(subName, sub.token);
    }
  }
  if (subfolderCollisions.length > 0) {
    throw new Error(
      `Subfolder token collision(s) detected while building subfolderTokenByName: ${subfolderCollisions
        .map(c => `${c.subName} [${c.existingToken}] vs [${c.newToken}] in category ${c.categoryName}`)
        .join('; ')}`
    );
  }

  const bw = new BitableWriter({ baseToken: BITABLE_APP, tableId: BITABLE_TABLE });
  const records = await bw.listRecords({ pageSize: 500 });

  const functionRecords = [];
  const virtualNodesByTitle = new Map();
  for (const r of records) {
    const docs = normalizeDocsField(r.fields?.Docs);
    const title = docs.title;
    if (isVirtualNodeRecord(r) && title) {
      if (!virtualNodesByTitle.has(title)) virtualNodesByTitle.set(title, []);
      virtualNodesByTitle.get(title).push(r.record_id);
      continue;
    }

    if (r.fields?.Type === 'Function') {
      functionRecords.push({
        recordId: r.record_id,
        title,
        link: docs.link,
        slug: extractSlug(r),
        parentRecordId: extractParentRecordId(r.fields?.父记录),
      });
    }
  }

  const existingBySlug = new Map();
  const existingByTitleAndParent = new Map();
  for (const rec of functionRecords) {
    if (rec.slug) {
      if (!existingBySlug.has(rec.slug)) existingBySlug.set(rec.slug, []);
      existingBySlug.get(rec.slug).push(rec);
    }
    if (rec.title && rec.parentRecordId) {
      existingByTitleAndParent.set(`${rec.parentRecordId}:${rec.title}`, rec);
    }
  }

  const folderDocCache = new Map();

  for (const spec of NEW_DOC_SPECS) {
    const markdownPath = path.join(MARKDOWN_DIR, spec.markdownFile);
    if (!fs.existsSync(markdownPath)) {
      result.unresolved.push({ key: spec.key, reason: `Missing markdown file ${markdownPath}` });
      continue;
    }

    const folderToken = subfolderTokenByName.get(spec.subfolder);
    if (!folderToken) {
      result.unresolved.push({ key: spec.key, reason: `Missing folder token for subfolder ${spec.subfolder}` });
      continue;
    }

    const parentCandidates = virtualNodesByTitle.get(spec.parentVirtualNodeTitle) || [];
    if (parentCandidates.length !== 1) {
      result.unresolved.push({
        key: spec.key,
        reason: parentCandidates.length === 0
          ? `No VirtualNode record found for ${spec.parentVirtualNodeTitle}`
          : `Ambiguous VirtualNode records for ${spec.parentVirtualNodeTitle}: ${parentCandidates.join(', ')}`,
      });
      continue;
    }
    const parentRecordId = parentCandidates[0];

    const dupBySlug = existingBySlug.get(spec.slug) || [];
    const dupBySlugUnderParent = dupBySlug.filter(x => x.parentRecordId === parentRecordId);

    if (dupBySlugUnderParent.length > 1) {
      result.failed.push({ key: spec.key, reason: `Duplicate existing records for slug ${spec.slug} under parent ${parentRecordId}: ${dupBySlugUnderParent.map(x => x.recordId).join(', ')}` });
      continue;
    }

    if (dupBySlug.length > 0 && dupBySlugUnderParent.length === 0) {
      result.failed.push({
        key: spec.key,
        reason: `Slug ${spec.slug} exists only under wrong parent(s): ${dupBySlug.map(x => `${x.recordId}:${x.parentRecordId || '<none>'}`).join(', ')}`,
      });
      continue;
    }

    const existingRecord = existingByTitleAndParent.get(`${parentRecordId}:${spec.title}`) || dupBySlugUnderParent[0] || null;

    if (existingRecord) {
      result.skipped.push({
        key: spec.key,
        title: spec.title,
        slug: spec.slug,
        parentRecordId,
        recordId: existingRecord.recordId,
        reason: `Function record already exists (recordId=${existingRecord.recordId}, title=${existingRecord.title}, slug=${existingRecord.slug || '<empty>'}). Skipping doc creation to avoid orphan docs.`,
      });
      continue;
    }

    if (!folderDocCache.has(folderToken) && !DRY_RUN) {
      const docs = await listFolderDocs(folderToken);
      folderDocCache.set(folderToken, docs);
    }
    const folderDocs = folderDocCache.get(folderToken) || [];
    const existingDoc = folderDocs.find(x => x.name === spec.title);

    let docId;
    let docLink;

    if (existingDoc) {
      docId = existingDoc.token;
      docLink = `${FEISHU_DOC}/${docId}`;
    } else if (DRY_RUN) {
      docId = '<dry-run-doc-id>';
      docLink = `${FEISHU_DOC}/${docId}`;
    } else {
      const markdown = fs.readFileSync(markdownPath, 'utf8');
      const m2f = new MarkdownToFeishu({ sourceType: 'drive', rootToken: folderToken, baseToken: null });
      const push = await m2f.push_markdown({
        markdown_content: markdown,
        title: spec.title,
        folder_token: folderToken,
      });
      docId = push.document_id;
      docLink = `${FEISHU_DOC}/${docId}`;
      folderDocs.push({ token: docId, name: spec.title, type: 'docx' });
    }

    let recordId = '<dry-run-record-id>';
    if (!DRY_RUN) {
      const created = await bw.createRecord({
        title: spec.title,
        link: docLink,
        type: 'Function',
        addedSince: 'v1.4.x',
        progress: 'Draft',
        targets: ['Zilliz'],
        parentRecordId,
      });
      recordId = created.record_id || created.record?.record_id;
    }

    result.created.push({
      key: spec.key,
      title: spec.title,
      slug: spec.slug,
      parentRecordId,
      folderToken,
      markdownFile: spec.markdownFile,
      docId,
      docLink,
      recordId,
    });
  }

  result.summary = {
    specs: NEW_DOC_SPECS.length,
    created: result.created.length,
    skipped: result.skipped.length,
    unresolved: result.unresolved.length,
    failed: result.failed.length,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));

  console.log('New-docs summary:');
  for (const [k, v] of Object.entries(result.summary)) {
    console.log(`  ${k}: ${v}`);
  }
  console.log(`Result written to ${OUTPUT_PATH}`);

  if (result.failed.length > 0) process.exit(2);
})();
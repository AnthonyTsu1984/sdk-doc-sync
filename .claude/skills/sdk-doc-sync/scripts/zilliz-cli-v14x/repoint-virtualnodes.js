#!/usr/bin/env node
// Repoint v1.4.x VirtualNode Docs links to v1.4.x drive folder URLs.
//
// Inputs:
// - /tmp/v14x-folders.json (created by create-folders.js)
//
// Behavior:
// - Indexes VirtualNode records in v1.4.x bitable by title
// - Updates Docs to https://zilliverse.feishu.cn/drive/folder/<token>
// - Uses updateRecord(recordId, { title, link }) with both fields

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const fs = require('fs');
const BitableWriter = require('../../src/sdk-doc-sync/bitable-writer');

const BITABLE_APP = 'Ly1Tb2SAnaoqSes750ZcNFkOnTd';
const BITABLE_TABLE = 'tblVFXzRMjCj4d0m';
const FEISHU_FOLDER = 'https://zilliverse.feishu.cn/drive/folder';
const FOLDERS_PATH = '/tmp/v14x-folders.json';

function normalizeDocsField(docs) {
  if (!docs) return { title: '', link: '' };
  if (typeof docs === 'string') return { title: docs, link: '' };
  return {
    title: docs.text || docs.title || '',
    link: docs.link || '',
  };
}

function flattenFolderMap(folders) {
  const m = new Map();
  const categories = folders?.categories;
  if (!categories || typeof categories !== 'object') return m;

  for (const [catName, cat] of Object.entries(categories)) {
    if (cat?.token) m.set(catName, cat.token);

    const subfolders = cat?.subfolders;
    if (!subfolders || typeof subfolders !== 'object') continue;

    for (const [subName, sub] of Object.entries(subfolders)) {
      if (sub?.token) m.set(subName, sub.token);
    }
  }
  return m;
}

function isVirtualNodeRecord(record) {
  const typeField = record.fields?.Type;
  const typeValues = Array.isArray(typeField) ? typeField : (typeField ? [typeField] : []);
  return typeValues.includes('VirtualNode');
}

(async () => {
  let folders;
  try {
    const raw = fs.readFileSync(FOLDERS_PATH, 'utf8');
    folders = JSON.parse(raw);
  } catch (err) {
    console.error(`[fatal] Failed to read or parse folders JSON at ${FOLDERS_PATH}: ${err.message}`);
    process.exit(1);
  }

  const titleToFolderToken = flattenFolderMap(folders);

  const bw = new BitableWriter({ baseToken: BITABLE_APP, tableId: BITABLE_TABLE });
  const records = await bw.listRecords({ pageSize: 500 });

  const virtualNodes = [];
  const duplicateTitles = new Map();

  for (const r of records) {
    const docs = normalizeDocsField(r.fields?.Docs);
    const title = docs.title;
    if (!title) continue;
    if (!isVirtualNodeRecord(r)) continue;

    virtualNodes.push({
      recordId: r.record_id,
      title,
      currentLink: docs.link || '',
    });

    const seen = duplicateTitles.get(title) || [];
    seen.push(r.record_id);
    duplicateTitles.set(title, seen);
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  console.log(`Indexed VirtualNode records: ${virtualNodes.length}`);

  for (const [title, ids] of duplicateTitles.entries()) {
    if (ids.length > 1) {
      console.warn(`[warn-duplicate] ${title}: ${ids.join(', ')}`);
    }
  }

  for (const node of virtualNodes) {
    const folderToken = titleToFolderToken.get(node.title);
    if (!folderToken) {
      console.error(`[failed] ${node.title}: no folder token in ${FOLDERS_PATH}`);
      failed++;
      continue;
    }

    const desiredLink = `${FEISHU_FOLDER}/${folderToken}`;
    if (node.currentLink === desiredLink) {
      console.log(`[skip] ${node.title} already points to ${folderToken}`);
      skipped++;
      continue;
    }

    try {
      await bw.updateRecord(node.recordId, { title: node.title, link: desiredLink });
      console.log(`[updated] ${node.title} -> ${folderToken}`);
      updated++;
    } catch (err) {
      console.error(`[failed] ${node.title} (${node.recordId}): ${err.message}`);
      failed++;
    }
  }

  console.log('\nSummary:');
  console.log(`  updated: ${updated}`);
  console.log(`  skipped: ${skipped}`);
  console.log(`  failed:  ${failed}`);
})();

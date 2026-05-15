#!/usr/bin/env node

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const BITABLE_TOKEN = 'XmndbkxkQaigA8soRiCcTT41nMd';
const DRY_RUN = process.argv.includes('--dry-run');

const ELEMENT_FIELDS = [
  'text',
  'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6', 'heading7', 'heading8', 'heading9',
  'bullet', 'ordered', 'todo', 'quote',
];

function extractDocId(url) {
  if (!url) return null;
  const m = decodeURIComponent(url).match(/\/docx\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

async function feishuAPI(method, endpoint, token, body = null) {
  const res = await fetch(`${HOST}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`${endpoint}: ${data.msg} (code ${data.code})`);
  }
  return data.data;
}

function getContainer(block) {
  for (const key of ELEMENT_FIELDS) {
    if (block[key]?.elements) return { key, value: block[key] };
  }
  return null;
}

function normalizeTitle(s) {
  return (s || '').trim().toLowerCase();
}

async function main() {
  console.log(`cpp-add-ptr-type-links${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`Bitable: ${BITABLE_TOKEN}\n`);

  const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
  const token = await new larkTokenFetcher().token();
  const records = await writer.listRecords({ pageSize: 500 });

  const typeMap = new Map();
  const docs = [];

  for (const rec of records) {
    const title = rec.fields?.Docs?.text || '';
    const link = rec.fields?.Docs?.link || '';
    const docId = extractDocId(link);
    if (!docId || !title) continue;

    docs.push({ title, docId });

    const t = rec.fields?.Type;
    if (t === 'Class' || t === 'Enum') {
      typeMap.set(normalizeTitle(title), { title, link, docId });
    }
  }

  const updatesByDoc = new Map();

  for (const doc of docs) {
    const data = await feishuAPI('GET', `/open-apis/docx/v1/documents/${doc.docId}/blocks`, token);
    const blocks = data.items || [];

    for (const block of blocks) {
      if (block.block_type === 14) continue;
      const container = getContainer(block);
      if (!container) continue;

      const oldElements = container.value.elements || [];
      let changed = false;
      const newElements = oldElements.map((el) => {
        const tr = el.text_run;
        if (!tr) return el;

        const style = tr.text_element_style || {};
        if (style.link?.url) return el;
        if (style.inline_code || style.code) return el;

        const content = (tr.content || '').trim();
        const m = /^([A-Za-z_][A-Za-z0-9_]*)Ptr$/.exec(content);
        if (!m) return el;

        const baseName = m[1];
        const base = typeMap.get(normalizeTitle(baseName));
        if (!base) return el;

        if (normalizeTitle(base.title) === normalizeTitle(doc.title)) return el;

        changed = true;
        return {
          ...el,
          text_run: {
            ...tr,
            text_element_style: {
              ...style,
              link: { url: encodeURIComponent(base.link) },
            },
          },
        };
      });

      if (changed) {
        if (!updatesByDoc.has(doc.docId)) updatesByDoc.set(doc.docId, []);
        updatesByDoc.get(doc.docId).push({
          blockId: block.block_id,
          elements: newElements,
          title: doc.title,
        });
      }
    }
  }

  const summary = {
    docsScanned: docs.length,
    docsWithChanges: updatesByDoc.size,
    blocksToPatch: [...updatesByDoc.values()].reduce((n, arr) => n + arr.length, 0),
  };

  if (DRY_RUN) {
    const preview = [];
    for (const [docId, updates] of updatesByDoc.entries()) {
      preview.push({
        docId,
        title: updates[0]?.title || '',
        blocks: updates.length,
      });
    }
    console.log(JSON.stringify({ summary, preview }, null, 2));
    return;
  }

  let patched = 0;
  for (const [docId, updates] of updatesByDoc.entries()) {
    const requests = updates.map((u) => ({
      block_id: u.blockId,
      update_text_elements: { elements: u.elements },
    }));

    for (let i = 0; i < requests.length; i += 20) {
      const batch = requests.slice(i, i + 20);
      await feishuAPI('PATCH', `/open-apis/docx/v1/documents/${docId}/blocks/batch_update`, token, { requests: batch });
      patched += batch.length;
    }
  }

  console.log(JSON.stringify({ summary, blocksPatched: patched }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

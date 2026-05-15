#!/usr/bin/env node

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const BITABLE_TOKEN = 'XmndbkxkQaigA8soRiCcTT41nMd';
const DRY_RUN = process.argv.includes('--dry-run');

const TARGETS = [
  'BatchDescribeCollections()',
  'DescribeReplicas()',
  'Optimize()',
];

function extractDocId(link) {
  if (!link) return null;
  const m = link.match(/\/docx\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

function getText(block) {
  return (block.text?.elements || []).map((e) => e.text_run?.content || '').join('');
}

async function feishuAPI(method, endpoint, token, body) {
  const res = await fetch(`${FEISHU_HOST}${endpoint}`, {
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

async function main() {
  const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
  const token = await new larkTokenFetcher().token();
  const records = await writer.listRecords({ pageSize: 500 });

  const targetRecords = records
    .map((r) => ({
      title: r.fields?.Docs?.text || '',
      link: r.fields?.Docs?.link || '',
      recordId: r.record_id,
    }))
    .filter((r) => TARGETS.includes(r.title))
    .map((r) => ({ ...r, docId: extractDocId(r.link) }))
    .filter((r) => r.docId);

  const patched = [];

  for (const rec of targetRecords) {
    const blocksData = await feishuAPI('GET', `/open-apis/docx/v1/documents/${rec.docId}/blocks`, token);
    const blocks = blocksData.items || [];

    const returnsHeader = blocks.find(
      (b) => b.block_type === 2 && getText(b).trim() === 'RETURNS:'
    );
    if (!returnsHeader) continue;

    const returnLine = blocks.find(
      (b) => b.parent_id === returnsHeader.parent_id && b.block_type === 2 && /^Status with [A-Za-z_][A-Za-z0-9_:<>]*$/.test(getText(b).trim())
    );

    if (!returnLine) continue;

    const text = getText(returnLine).trim();
    const m = /^Status with ([A-Za-z_][A-Za-z0-9_:<>]*)$/.exec(text);
    if (!m) continue;

    const typeName = m[1];

    if (!DRY_RUN) {
      await feishuAPI(
        'PATCH',
        `/open-apis/docx/v1/documents/${rec.docId}/blocks/batch_update`,
        token,
        {
          requests: [
            {
              block_id: returnLine.block_id,
              update_text_elements: {
                elements: [
                  {
                    text_run: {
                      content: 'Status',
                      text_element_style: { italic: true },
                    },
                  },
                  {
                    text_run: {
                      content: ' with ',
                      text_element_style: {},
                    },
                  },
                  {
                    text_run: {
                      content: typeName,
                      text_element_style: { italic: true },
                    },
                  },
                ],
              },
            },
          ],
        }
      );
    }

    patched.push({
      title: rec.title,
      docId: rec.docId,
      blockId: returnLine.block_id,
      typeName,
    });
  }

  console.log(JSON.stringify({ dryRun: DRY_RUN, patched }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

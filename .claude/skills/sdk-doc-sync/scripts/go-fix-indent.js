'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });
const fetch = require('node-fetch');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');
const tf = new larkTokenFetcher();

const INPUT_DOC_IDS = [
  'SfI4d1i4roSMZ5xd18vc7ewAnPc', // Schema
  'LPVNd0HPDoH0ZsxylIncj8egnTd', // Field
  'Xq9Ydn3OJoYrHmxMVOLcMn9onHc', // FieldType
  'G4dTdejt8otbQWxUqvucwKnBnYg', // Function
  'CBg7dbZZ7oxxvJx1eV4cJXWGnbe', // ConsistencyLevel
  'GppedViHro8TJMxQCZ3cJRKRnHg', // IndexType
  'Hl6adortyo5I2nxdGx8cEDJ8noe', // MetricType
  'XV3adWSVho0zgfx6CZDc30GAnMc', // AnnParam
  'IM6xdWbdLo7l9dxR40kcfjfSnVb', // ResourceGroupConfig
];

async function feishuAPI(method, endpoint, body) {
  const token = await tf.token();
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('https://open.feishu.cn' + endpoint, opts);
  const d = await res.json();
  if (d.code !== 0) throw new Error('API [' + d.code + ']: ' + d.msg);
  return d.data;
}
async function delay() { return new Promise(r => setTimeout(r, 350)); }

async function getBlocks(docId) {
  const blocks = [];
  let pt = null;
  do {
    const d = await feishuAPI('GET', '/open-apis/docx/v1/documents/' + docId + '/blocks' + (pt ? '?page_token=' + pt : ''));
    blocks.push(...d.items);
    pt = d.has_more ? d.page_token : null;
  } while (pt);
  return blocks;
}

async function main() {
  for (const docId of INPUT_DOC_IDS) {
    const blocks = await getBlocks(docId);
    const codeBlocks = blocks.filter(b => b.block_type === 14);
    const last = codeBlocks[codeBlocks.length - 1];
    const current = (last.code?.elements || []).map(e => e.text_run?.content || '').join('');
    const fixed = current.replace(/\t/g, '    ');
    if (fixed === current) { console.log(docId + ': no tabs, skip'); await delay(); continue; }

    await feishuAPI('PATCH', '/open-apis/docx/v1/documents/' + docId + '/blocks/batch_update', {
      requests: [{ block_id: last.block_id, update_text_elements: { elements: [{ text_run: { content: fixed, text_element_style: {} } }] } }],
    });
    console.log(docId + ': ✓ tabs → 4 spaces');
    await delay();
  }
  console.log('Done.');
}
main().catch(console.error);

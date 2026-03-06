'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });
const fetch = require('node-fetch');
const larkTokenFetcher = require('../../../../lib/lark-docs/larkTokenFetcher');
const tf = new larkTokenFetcher();

async function getBlocks(docId) {
  const token = await tf.token();
  const r = await fetch('https://open.feishu.cn/open-apis/docx/v1/documents/' + docId + '/blocks', { headers: { Authorization: 'Bearer ' + token } });
  return (await r.json()).data.items;
}

function describeBlock(b) {
  const content = b.block_type === 2 ? b.text : b.block_type === 4 ? b.heading2 : b.block_type === 12 ? b.bullet : null;
  if (content === null || content === undefined) return null;
  const elems = (content.elements || []).map(e => {
    const s = (e.text_run || {}).text_element_style || {};
    const flags = [];
    if (s.bold) flags.push('BOLD');
    if (s.italic) flags.push('ITALIC');
    if (s.inline_code) flags.push('CODE');
    return JSON.stringify((e.text_run || {}).content || '') + (flags.length ? '[' + flags.join(',') + ']' : '');
  }).join(' + ');
  return 'type=' + b.block_type + ': ' + elems.substring(0, 200);
}

async function main() {
  const docId = process.argv[2] || 'ZIm2dVn5noFLpAxRkjbc6jiSnee';
  const blocks = await getBlocks(docId);
  console.log('=== doc', docId, '===');
  blocks.forEach((b, i) => { const d = describeBlock(b); if (d) console.log(i, d); });
}
main().catch(console.error);

'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });
const fetch = require('node-fetch');
const larkTokenFetcher = require('../../../../lib/lark-docs/larkTokenFetcher');
const tf = new larkTokenFetcher();

const BITABLE = 'Yc7gbtmgSal2ewsdqlhcLWVanbh';
const TABLE   = 'tblM12OyAwhSeXiC';

async function feishuAPI(method, endpoint, body) {
  const token = await tf.token();
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('https://open.feishu.cn' + endpoint, opts);
  const data = await res.json();
  if (data.code !== 0) throw new Error('API [' + data.code + ']: ' + data.msg);
  return data.data;
}
async function delay() { return new Promise(r => setTimeout(r, 220)); }

async function rawContent(docId) {
  const token = await tf.token();
  const res = await fetch('https://open.feishu.cn/open-apis/docx/v1/documents/' + docId + '/raw_content', {
    headers: { Authorization: 'Bearer ' + token }
  });
  const d = await res.json();
  return d.data?.content || '';
}

async function main() {
  // Fetch all records
  const records = [];
  let pageToken = null;
  do {
    const url = '/open-apis/bitable/v1/apps/' + BITABLE + '/tables/' + TABLE + '/records/search';
    const data = await feishuAPI('POST', url + (pageToken ? '?page_token=' + pageToken : ''), {
      page_size: 500, field_names: ['Slug', 'Type', 'Docs'],
    });
    records.push(...(data.items || []));
    pageToken = data.has_more ? data.page_token : null;
  } while (pageToken);

  console.log('Total records:', records.length);

  // Check all records that have a doc
  const todos = [];
  let checked = 0;
  for (const rec of records) {
    const type = rec.fields['Type'] || '';
    const slug = rec.fields['Slug']?.value?.[0]?.text || '';
    const docs = rec.fields['Docs'];
    const docId = docs?.token || (docs?.link || '').match(/\/docx\/([A-Za-z0-9]+)/)?.[1];
    if (!docId || type === 'VirtualNode') continue;

    const content = await rawContent(docId);
    checked++;
    if (content.includes('// TODO:')) {
      todos.push({ slug, type, docId });
    }
    if (checked % 20 === 0) process.stderr.write('checked ' + checked + '...\n');
    await delay();
  }

  console.log('\n=== DOCS WITH // TODO: ===');
  for (const t of todos) console.log(t.type + '\t' + t.slug + '\t' + t.docId);
  console.log('\nTotal:', todos.length, 'of', checked, 'checked');
}
main().catch(console.error);

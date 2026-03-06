'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });
const fetch = require('node-fetch');
const larkTokenFetcher = require('../../../../lib/lark-docs/larkTokenFetcher');
const tf = new larkTokenFetcher();

const BITABLE = 'Yc7gbtmgSal2ewsdqlhcLWVanbh';
const TABLE = 'tblM12OyAwhSeXiC';

async function feishuAPI(method, endpoint, body) {
  const token = await tf.token();
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('https://open.feishu.cn' + endpoint, opts);
  const data = await res.json();
  if (data.code !== 0) throw new Error('API [' + data.code + ']: ' + data.msg);
  return data.data;
}
async function delay(ms) { return new Promise(r => setTimeout(r, ms || 250)); }

async function rawContent(docId) {
  const token = await tf.token();
  const res = await fetch('https://open.feishu.cn/open-apis/docx/v1/documents/' + docId + '/raw_content', {
    headers: { Authorization: 'Bearer ' + token }
  });
  const data = await res.json();
  return (data.data && data.data.content) ? data.data.content : '';
}

async function main() {
  // Peek at a few records to understand Type field shape
  const peek = await feishuAPI('POST', '/open-apis/bitable/v1/apps/' + BITABLE + '/tables/' + TABLE + '/records/search', {
    page_size: 5, field_names: ['Slug', 'Type', 'Docs']
  });
  console.log('Type field sample:', JSON.stringify(peek.items[0]?.fields['Type']));
  console.log('Slug field sample:', JSON.stringify(peek.items[0]?.fields['Slug']));

  // Fetch all
  const records = [];
  let pageToken = null;
  do {
    const url = '/open-apis/bitable/v1/apps/' + BITABLE + '/tables/' + TABLE + '/records/search';
    const data = await feishuAPI('POST', url + (pageToken ? '?page_token=' + pageToken : ''), {
      page_size: 500, field_names: ['Slug', 'Type', 'Docs']
    });
    records.push(...(data.items || []));
    pageToken = data.has_more ? data.page_token : null;
  } while (pageToken);

  // Check the 4 duplicate docs
  const dupeIds = [
    { name: 'SearchIterator-1', docId: 'K6obdWvXyoNLbMxNkggc9JyMnPd', recId: 'recvb056zjZWKf' },
    { name: 'SearchIterator-2', docId: 'KAcRdSZNcoSGVYx1tercDcqCnCm', recId: 'recvb05w6qRgge' },
    { name: 'QueryIterator-1',  docId: 'K5PAdhJwGoXdZQxrPJncXebGnwd', recId: 'recvb058wPZ6oQ' },
    { name: 'QueryIterator-2',  docId: 'CzabdWi3Xo0F1hxXBnxcy3W4nWe', recId: 'recvb05x9zXtsv' },
  ];
  console.log('\n=== DUPLICATE DOC CONTENTS ===');
  for (const d of dupeIds) {
    const c = await rawContent(d.docId);
    const lines = c.split('\n').slice(0, 4).join(' | ');
    console.log(d.name + ' (' + d.docId + '): ' + lines.substring(0, 120));
    await delay();
  }

  // Check all records for TODO — detect type format from sample
  console.log('\n=== RECORDS WITH TODO ===');
  const todoDocs = [];
  for (const rec of records) {
    const typeField = rec.fields['Type'];
    // Type may be array of {value} or plain string
    const typeVal = Array.isArray(typeField) ? typeField[0]?.value : (typeField?.value || typeField || '');
    if (typeVal !== 'Function') continue;

    const docs = rec.fields['Docs'];
    const docId = docs?.token || (docs?.link || '').match(/\/docx\/([A-Za-z0-9]+)/)?.[1];
    const slug = rec.fields['Slug']?.value?.[0]?.text || rec.fields['Slug']?.value || '';
    if (!docId) continue;

    const content = await rawContent(docId);
    if (content.includes('// TODO:')) {
      todoDocs.push({ slug, docId });
      console.log('  TODO: ' + slug + ' (' + docId + ')');
    }
    await delay();
  }
  console.log('\nTotal with TODO:', todoDocs.length);
}
main().catch(console.error);

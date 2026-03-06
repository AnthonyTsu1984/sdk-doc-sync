'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });
const fetch = require('node-fetch');
const larkTokenFetcher = require('../../../../lib/lark-docs/larkTokenFetcher');
const tf = new larkTokenFetcher();

const BITABLE = 'Yc7gbtmgSal2ewsdqlhcLWVanbh';
const TABLE = 'tblM12OyAwhSeXiC';
const DELAY = 200;

async function feishuAPI(method, endpoint, body) {
  const token = await tf.token();
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('https://open.feishu.cn' + endpoint, opts);
  const data = await res.json();
  if (data.code !== 0) throw new Error('API [' + data.code + ']: ' + data.msg);
  return data.data;
}
async function delay(ms) { return new Promise(r => setTimeout(r, ms || DELAY)); }

async function fetchAllRecords() {
  const records = [];
  let pageToken = null;
  do {
    const url = '/open-apis/bitable/v1/apps/' + BITABLE + '/tables/' + TABLE + '/records/search';
    const data = await feishuAPI('POST', url + (pageToken ? '?page_token=' + pageToken : ''), {
      page_size: 500,
      field_names: ['Slug', 'Type', 'Docs'],
    });
    records.push(...(data.items || []));
    pageToken = data.has_more ? data.page_token : null;
  } while (pageToken);
  return records;
}

async function rawContent(docId) {
  const token = await tf.token();
  const res = await fetch('https://open.feishu.cn/open-apis/docx/v1/documents/' + docId + '/raw_content', {
    headers: { Authorization: 'Bearer ' + token }
  });
  const data = await res.json();
  return (data.data && data.data.content) ? data.data.content : '';
}

async function main() {
  console.log('Fetching all records...');
  const records = await fetchAllRecords();
  console.log('Total records:', records.length);

  // Group by slug to find duplicates
  const bySlug = {};
  for (const rec of records) {
    const slug = rec.fields['Slug']?.value?.[0]?.text || '';
    const type = rec.fields['Type']?.value || '';
    const docs = rec.fields['Docs'];
    const docId = docs?.token || (docs?.link || '').match(/\/docx\/([A-Za-z0-9]+)/)?.[1];
    const key = slug + '|' + type;
    if (!bySlug[key]) bySlug[key] = [];
    bySlug[key].push({ slug, type, docId, recordId: rec.record_id });
  }

  console.log('\n=== DUPLICATE SLUGS ===');
  for (const [key, recs] of Object.entries(bySlug)) {
    if (recs.length > 1) {
      console.log(key + ':');
      for (const r of recs) console.log('  recordId=' + r.recordId + ' docId=' + r.docId);
    }
  }

  // Check all Function records for TODO
  console.log('\n=== CHECKING FOR //TODO IN FUNCTION DOCS ===');
  const funcRecords = records.filter(r => r.fields['Type']?.value === 'Function');
  const todoDocs = [];
  let checked = 0;
  for (const rec of funcRecords) {
    const slug = rec.fields['Slug']?.value?.[0]?.text || '';
    const docs = rec.fields['Docs'];
    const docId = docs?.token || (docs?.link || '').match(/\/docx\/([A-Za-z0-9]+)/)?.[1];
    if (!docId) continue;
    const content = await rawContent(docId);
    if (content.includes('// TODO:')) {
      todoDocs.push({ slug, docId, recordId: rec.record_id });
      console.log('  TODO: ' + slug + ' (' + docId + ')');
    }
    checked++;
    if (checked % 20 === 0) console.log('  ... checked ' + checked + '/' + funcRecords.length);
    await delay();
  }
  console.log('\nTotal with TODO:', todoDocs.length, 'of', funcRecords.length, 'Function docs checked');
}
main().catch(console.error);

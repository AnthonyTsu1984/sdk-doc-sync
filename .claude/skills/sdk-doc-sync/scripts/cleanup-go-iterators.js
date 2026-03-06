'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });
const fetch = require('node-fetch');
const larkTokenFetcher = require('../../../../lib/lark-docs/larkTokenFetcher');
const tf = new larkTokenFetcher();

const BITABLE = 'Yc7gbtmgSal2ewsdqlhcLWVanbh';
const TABLE   = 'tblM12OyAwhSeXiC';

// Class-type duplicates to DELETE (no parens — wrong kind)
const TO_DELETE = [
  { name: 'SearchIterator (class)', docId: 'KAcRdSZNcoSGVYx1tercDcqCnCm', recId: 'recvb05w6qRgge' },
  { name: 'QueryIterator (class)',  docId: 'CzabdWi3Xo0F1hxXBnxcy3W4nWe', recId: 'recvb05x9zXtsv' },
];

async function feishuAPI(method, endpoint, body) {
  const token = await tf.token();
  const opts = { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('https://open.feishu.cn' + endpoint, opts);
  const data = await res.json();
  if (data.code !== 0) throw new Error('API [' + data.code + ']: ' + data.msg + ' — ' + endpoint);
  return data.data;
}
async function delay() { return new Promise(r => setTimeout(r, 400)); }

async function main() {
  for (const item of TO_DELETE) {
    console.log('Deleting ' + item.name + '...');

    // 1. Delete the Feishu doc
    await feishuAPI('DELETE', '/open-apis/drive/v1/files/' + item.docId + '?type=docx');
    console.log('  ✓ Doc deleted: ' + item.docId);
    await delay();

    // 2. Delete the bitable record
    await feishuAPI('DELETE', '/open-apis/bitable/v1/apps/' + BITABLE + '/tables/' + TABLE + '/records/' + item.recId);
    console.log('  ✓ Record deleted: ' + item.recId);
    await delay();
  }
  console.log('\nDone.');
}
main().catch(console.error);

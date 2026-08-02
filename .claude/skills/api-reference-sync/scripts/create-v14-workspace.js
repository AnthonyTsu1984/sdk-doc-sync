#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const fetch = require('node-fetch');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const SHARED_DRIVE_ROOT = 'EsDFfU9OQlcdBldL1jVcCwpfnPd';

async function getHeaders() {
  const tf = new larkTokenFetcher();
  const token = await tf.token();
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json; charset=utf-8',
  };
}

async function createFolder(name, parentToken) {
  const headers = await getHeaders();
  const url = `${FEISHU_HOST}/open-apis/drive/v1/files/create_folder`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ folder_token: parentToken, name }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`createFolder failed: ${data.msg}`);
  return data.data;
}

async function createBitable(title, folderToken) {
  const headers = await getHeaders();
  const url = `${FEISHU_HOST}/open-apis/drive/v1/files`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title, type: 'bitable', folder_token: folderToken }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`createBitable failed: ${data.msg}`);
  return data.data;
}

async function main() {
  console.log('Creating v1.4.x folder...');
  const folder = await createFolder('v1.4.x', SHARED_DRIVE_ROOT);
  console.log('Created folder:', folder.token, folder.name);

  console.log('Creating v1.4.x bitable...');
  const bitable = await createBitable('CLI (v1.4.x)', folder.token);
  console.log('Created bitable:', bitable.token, bitable.title);

  console.log('\n--- Tokens ---');
  console.log('v1.4.x Drive folder:', folder.token);
  console.log('v1.4.x Bitable:', bitable.token);
}

main().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
'use strict';

/**
 * Batch create CLI docs from control-plane.json and create bitable records.
 * Usage: node batch-create-cli-docs.js <manifest.json>
 *
 * Manifest format:
 * [
 *   {
 *     "resource": "privatelink",
 *     "operation": "list-services",
 *     "folderToken": "Oiv0fRpvQlQ07RdjQObcYtaunVh",
 *     "parentRecordId": "recvjA0WiBL3nZ",
 *     "category": "PrivateLink"
 *   },
 *   ...
 * ]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const BITABLE_TOKEN = 'Lx1bbCdpMaSmJXs8wz5cjsDengf';
const GENERATOR = path.resolve(__dirname, 'generate-cli-docs.js');
const FEISHU_DOC = path.resolve(__dirname, 'feishu-doc.js');

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    console.error('Usage: node batch-create-cli-docs.js <manifest.json>');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const modelPath = '/tmp/control-plane-remote.json';

  for (const item of manifest) {
    const { resource, operation, folderToken, parentRecordId, category } = item;
    const title = operation;
    const slug = `${category}-${operation}`;

    console.log(`\n=== ${slug} ===`);

    // 1. Generate markdown
    const tmpFile = `/tmp/cli-doc-${resource}-${operation}.md`;
    try {
      execSync(`node "${GENERATOR}" --resource ${resource} --operation ${operation} --output "${tmpFile}"`, { stdio: 'inherit' });
    } catch (e) {
      console.error(`Failed to generate markdown for ${slug}:`, e.message);
      continue;
    }

    // 2. Push to Feishu
    let docId;
    try {
      const output = execSync(`node "${FEISHU_DOC}" push "${tmpFile}" --folder ${folderToken} --title "${title}" 2>&1`, { encoding: 'utf8' });
      const match = output.match(/Created document:.*\((\w+)\)/);
      if (match) {
        docId = match[1];
        console.log(`Pushed doc: ${docId}`);
      } else {
        console.error('Could not extract doc ID from push output');
        console.log(output);
        continue;
      }
    } catch (e) {
      console.error(`Failed to push doc for ${slug}:`, e.message);
      continue;
    }

    // 3. Create bitable record
    try {
      const cmd = `node "${FEISHU_DOC}" bitable-create ${BITABLE_TOKEN} \
        --field type=Function \
        --field title=${title} \
        --field link=https://zilliverse.feishu.cn/docx/${docId} \
        --field parentRecordId=${parentRecordId} \
        --field addedSince=v1.4.x \
        --field tag=v1.4.x \
        --field targets=Zilliz`;
      const output = execSync(cmd, { encoding: 'utf8' });
      const match = output.match(/Created:\s+(\w+)/);
      if (match) {
        console.log(`Created bitable record: ${match[1]}`);
      } else {
        console.log(output);
      }
    } catch (e) {
      console.error(`Failed to create bitable record for ${slug}:`, e.message);
    }
  }

  console.log('\n=== Batch complete ===');
}

main().catch(e => { console.error(e); process.exit(1); });

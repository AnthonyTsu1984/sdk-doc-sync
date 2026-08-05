#!/usr/bin/env node
/**
 * One-shot fix: the v0.1.x → v1.3.x copy left one stale cross-reference inside
 * the Backup/export doc that points at the old `zilliz job describe` doc token.
 * post-fix-links.js cannot auto-resolve it because the anchor text reads
 * "zilliz job describe" while the bitable record title is just "describe".
 *
 * Replace old docx token DKW5dWKqcoDIaHxD5dycfhzTnbd
 *      → new docx token HrwTdhnBeoZwoBxokBJcQZWznKh (Job/describe in v1.3.x).
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '..', '..', '.env') });

const fetch            = require('node-fetch');
const larkTokenFetcher = require('../../lib/lark-docs/larkTokenFetcher');

const HOST  = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const tf    = new larkTokenFetcher();
const DOC   = 'MqCqdE8mqotzaXxk8nfcOvHinX0';   // Backup/export doc
const OLD   = 'DKW5dWKqcoDIaHxD5dycfhzTnbd';   // v0.1.x Job/describe
const NEW   = 'HrwTdhnBeoZwoBxokBJcQZWznKh';   // v1.3.x Job/describe
const NEW_URL = `https://zilliverse.feishu.cn/docx/${NEW}`;
const DRY = process.argv.includes('--dry-run');

(async () => {
    const t = await tf.token();

    let pageToken = '';
    let blocks = [];
    do {
        const url = `${HOST}/open-apis/docx/v1/documents/${DOC}/blocks?page_size=500${pageToken ? '&page_token=' + pageToken : ''}`;
        const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + t } });
        const data = await res.json();
        if (data.code !== 0) {
            console.error('list blocks fail:', data.msg);
            process.exit(1);
        }
        blocks = blocks.concat(data.data?.items || []);
        pageToken = data.data?.page_token || '';
    } while (pageToken);

    const updates = [];
    for (const b of blocks) {
        const elements =
            b.text?.elements || b.bullet?.elements ||
            b.heading1?.elements || b.heading2?.elements || b.heading3?.elements ||
            b.heading4?.elements || b.heading5?.elements || b.heading6?.elements ||
            b.callout?.elements || [];
        if (!elements.length) continue;

        let changed = false;
        for (const e of elements) {
            const tr = e.text_run;
            if (!tr) continue;
            const link = tr.text_element_style?.link?.url || '';
            const decoded = link ? decodeURIComponent(link) : '';
            if (decoded.includes(OLD)) {
                tr.text_element_style.link = { url: encodeURIComponent(NEW_URL) };
                changed = true;
                console.log(`  block ${b.block_id}: text="${tr.content}" link rewritten`);
            }
        }
        if (changed) updates.push({ block_id: b.block_id, elements });
    }

    if (updates.length === 0) {
        console.log('No stale link found.');
        return;
    }

    if (DRY) {
        console.log(`(dry run) would patch ${updates.length} block(s)`);
        return;
    }

    for (const u of updates) {
        const res = await fetch(
            `${HOST}/open-apis/docx/v1/documents/${DOC}/blocks/batch_update`,
            {
                method: 'PATCH',
                headers: {
                    'Authorization': 'Bearer ' + t,
                    'Content-Type': 'application/json; charset=utf-8',
                },
                body: JSON.stringify({
                    requests: [{
                        block_id: u.block_id,
                        update_text_elements: { elements: u.elements },
                    }],
                }),
            }
        );
        const data = await res.json();
        if (data.code !== 0) {
            console.error(`PATCH fail (${u.block_id}): ${data.msg}`);
            process.exitCode = 1;
        } else {
            console.log(`  ✔ patched ${u.block_id}`);
        }
    }
})();

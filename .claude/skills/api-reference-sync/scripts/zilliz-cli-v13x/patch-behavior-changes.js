#!/usr/bin/env node
/**
 * Patch v1.3.x docs for behavior/flag changes since v0.1.x.
 *
 * Targets (post v0.1.x → v1.3.4 transition):
 *   1. login           → add --cn flag (synopsis + new bullet)
 *   2. auth status     → add deprecation note pointing at `zilliz whoami`
 *   3. auth switch     → add deprecation note pointing at top-level `zilliz switch`
 *   4. cluster metrics → update --output description to mention default Braille chart
 *
 * Logout description ("clears stored credentials") was already correct in the
 * v0.1.x source, so no patch is required there.
 *
 * Run with `--dry-run` to preview without writing.
 */
'use strict';

const path  = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '..', '..', '.env') });

const fetch            = require('node-fetch');
const larkTokenFetcher = require('../../lib/lark-docs/larkTokenFetcher');

const HOST    = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DRY_RUN = process.argv.includes('--dry-run');
const tf      = new larkTokenFetcher();

// ─── API helpers ──────────────────────────────────────────────────────────────

async function api(method, endpoint, body = null) {
    const t   = await tf.token();
    const opts = {
        method,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${t}`,
        },
    };
    if (body) opts.body = JSON.stringify(body);
    const res  = await fetch(`${HOST}${endpoint}`, opts);
    const data = await res.json();
    if (data.code !== 0) {
        throw new Error(`Feishu API ${method} ${endpoint}: ${data.msg} (code ${data.code})`);
    }
    return data.data;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Block builders ───────────────────────────────────────────────────────────

function tr(content, style = {}) {
    return {
        text_run: {
            content,
            text_element_style: {
                bold:          !!style.bold,
                inline_code:   !!style.inline_code,
                italic:        !!style.italic,
                strikethrough: false,
                underline:     false,
            },
        },
    };
}

function paraBlock(elements) {
    return {
        block_type: 2,
        text: { elements, style: { align: 1, folded: false } },
    };
}

function bulletBlock(elements) {
    return {
        block_type: 12,
        bullet: { elements, style: { align: 1, folded: false } },
    };
}

// ─── Patch 1: login — add --cn flag ───────────────────────────────────────────

async function patchLogin() {
    const docId           = 'KZkqdaHxNo82J9xaZJlcn2KGnTe';
    const synopsisBlockId = 'doxcnTWL3sHuLuSh6AkRnA3uUPd';
    const apiKeyBulletIdx = 5;                    // children[5] = --api-key bullet
    const cnInsertIndex   = apiKeyBulletIdx + 1;  // index 6, before Example heading

    console.log(`\n[login] doc ${docId}`);

    if (DRY_RUN) {
        console.log(`  Would update synopsis ${synopsisBlockId} to add "[--cn]" line`);
        console.log(`  Would insert --cn bullet at index ${cnInsertIndex} in page parent`);
        console.log(`  Would insert child paragraph under new bullet`);
        return;
    }

    // 1. Update synopsis code block
    await api('PATCH', `/open-apis/docx/v1/documents/${docId}/blocks/batch_update`, {
        requests: [{
            block_id: synopsisBlockId,
            update_text_elements: {
                elements: [tr('zilliz login\n[--no-browser]\n[--api-key]\n[--cn]')],
            },
        }],
    });
    console.log(`  ✔ updated synopsis code block`);
    await sleep(300);

    // 2. Insert --cn bullet at index 6
    const cnBullet = bulletBlock([
        tr('--cn ', { bold: true }),
        tr('('),
        tr('boolean', { italic: true }),
        tr(') -'),
    ]);
    const r1 = await api('POST',
        `/open-apis/docx/v1/documents/${docId}/blocks/${docId}/children`,
        { children: [cnBullet], index: cnInsertIndex }
    );
    const newBulletId = r1.children?.[0]?.block_id;
    if (!newBulletId) throw new Error('insert returned no children');
    console.log(`  ✔ inserted --cn bullet (${newBulletId})`);
    await sleep(300);

    // 3. Insert child paragraph
    await api('POST',
        `/open-apis/docx/v1/documents/${docId}/blocks/${newBulletId}/children`,
        { children: [paraBlock([
            tr('Indicates whether to log in to the China cloud (api.cloud.zilliz.com.cn). API key authentication only.'),
        ])], index: 0 }
    );
    console.log(`  ✔ inserted child paragraph`);
}

// ─── Patch 2: auth status — deprecation note ──────────────────────────────────

async function patchAuthStatus() {
    const docId       = 'CGY6dYpcfoZr3cxbXT5cis6UnZf';
    const insertIndex = 2;     // After description (index 1), before Synopsis heading (index 2)

    console.log(`\n[auth status] doc ${docId}`);

    const note = paraBlock([
        tr('Note: ', { bold: true }),
        tr('zilliz auth status', { inline_code: true }),
        tr(' is a deprecated alias kept for backwards compatibility. Use '),
        tr('zilliz whoami', { inline_code: true }),
        tr(' (alias '),
        tr('zilliz info', { inline_code: true }),
        tr(') in new scripts.'),
    ]);

    if (DRY_RUN) {
        console.log(`  Would insert deprecation paragraph at index ${insertIndex}`);
        return;
    }

    await api('POST',
        `/open-apis/docx/v1/documents/${docId}/blocks/${docId}/children`,
        { children: [note], index: insertIndex }
    );
    console.log(`  ✔ inserted deprecation note`);
}

// ─── Patch 3: auth switch — deprecation note ──────────────────────────────────

async function patchAuthSwitch() {
    const docId       = 'WVn4dXc9FocqhRxmuwlcFcTynBg';
    const insertIndex = 2;     // After description (index 1), before Synopsis heading (index 2)

    console.log(`\n[auth switch] doc ${docId}`);

    const note = paraBlock([
        tr('Note: ', { bold: true }),
        tr('zilliz auth switch', { inline_code: true }),
        tr(' is a deprecated alias kept for backwards compatibility. Use the top-level '),
        tr('zilliz switch', { inline_code: true }),
        tr(' command in new scripts.'),
    ]);

    if (DRY_RUN) {
        console.log(`  Would insert deprecation paragraph at index ${insertIndex}`);
        return;
    }

    await api('POST',
        `/open-apis/docx/v1/documents/${docId}/blocks/${docId}/children`,
        { children: [note], index: insertIndex }
    );
    console.log(`  ✔ inserted deprecation note`);
}

// ─── Patch 4: cluster metrics — Braille chart default note ────────────────────

async function patchClusterMetrics() {
    const docId       = 'BVHRdq4miotjdVxI72fcI7XznKc';
    const outputDescId = 'doxcnefCh0xbP5OJQTgygPkrF8c';   // "Indicates the output format. Possible values:"

    console.log(`\n[cluster metrics] doc ${docId}`);

    if (DRY_RUN) {
        console.log(`  Would update --output description ${outputDescId} to mention default chart`);
        return;
    }

    await api('PATCH', `/open-apis/docx/v1/documents/${docId}/blocks/batch_update`, {
        requests: [{
            block_id: outputDescId,
            update_text_elements: {
                elements: [
                    tr('Indicates the output format. When this option is omitted, results are rendered as an in-terminal Braille chart visualization (since v1.3.1). Explicit values:'),
                ],
            },
        }],
    });
    console.log(`  ✔ updated --output description`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
    console.log(`patch-behavior-changes${DRY_RUN ? ' (DRY RUN)' : ''}`);
    try {
        await patchLogin();
        await patchAuthStatus();
        await patchAuthSwitch();
        await patchClusterMetrics();
        console.log(`\nDone.`);
    } catch (e) {
        console.error(`\nFATAL: ${e.message}`);
        process.exit(1);
    }
})();

#!/usr/bin/env node
/**
 * Check all C++ docs for comments (Feishu drive comments API).
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const BitableWriter = require('../../../../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../../../../lib/lark-docs/larkTokenFetcher');

const BITABLE_TOKEN = 'XmndbkxkQaigA8soRiCcTT41nMd';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const tokenFetcher = new larkTokenFetcher();

async function feishuAPI(endpoint) {
    const token = await tokenFetcher.token();
    const res = await fetch(FEISHU_HOST + endpoint, {
        headers: { Authorization: 'Bearer ' + token }
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error(data.msg + ' (code ' + data.code + ')');
    return data.data;
}

async function delay(ms = 300) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const recs = await writer.listRecords({ pageSize: 500 });

    const cppRecs = recs.filter(r => {
        const t = r.fields['Targets'];
        return t && (Array.isArray(t) ? t.includes('milvus-sdk-cpp') : t === 'milvus-sdk-cpp')
            && r.fields['Type'] !== 'VirtualNode';
    });

    console.log('Scanning', cppRecs.length, 'C++ docs for comments...\n');

    const withComments = [];

    for (const rec of cppRecs) {
        const title = rec.fields['Docs']?.text || '(untitled)';
        const link  = rec.fields['Docs']?.link  || '';
        const docId = link.match(/\/docx\/([A-Za-z0-9]+)/)?.[1];
        if (!docId) {
            console.log('SKIP (no docId):', title);
            continue;
        }

        let data;
        try {
            // Drive comments API: GET /open-apis/drive/v1/files/{file_token}/comments
            data = await feishuAPI(`/open-apis/drive/v1/files/${docId}/comments?file_type=docx&is_whole=false&page_size=50`);
            await delay();
        } catch (e) {
            console.error('ERROR', title, e.message);
            continue;
        }

        const items = data.items || [];
        const activeComments = items.filter(c => !c.is_solved);
        const solvedComments = items.filter(c => c.is_solved);

        if (items.length > 0) {
            withComments.push({
                title,
                docId,
                link,
                total: items.length,
                active: activeComments.length,
                solved: solvedComments.length,
                comments: items.map(c => ({
                    id: c.comment_id,
                    solved: c.is_solved,
                    replies: (c.reply_list?.replies || []).map(r =>
                        r.content?.elements?.map(e => e.text_run?.text || '').join('') || ''
                    )
                }))
            });
            console.log(`[COMMENTS] ${title}: ${items.length} comment(s) (${activeComments.length} active, ${solvedComments.length} solved)`);
        }
    }

    console.log('\n=== Summary: C++ docs with comments ===\n');
    if (withComments.length === 0) {
        console.log('No comments found on any C++ doc.');
        return;
    }

    for (const d of withComments) {
        console.log(`\n## ${d.title}`);
        console.log(`   Link: ${d.link}`);
        console.log(`   Comments: ${d.total} total (${d.active} active, ${d.solved} solved)`);
        for (const c of d.comments) {
            const status = c.solved ? '[solved]' : '[active]';
            console.log(`   ${status}`);
            for (const reply of c.replies) {
                if (reply.trim()) console.log(`     > ${reply.trim()}`);
            }
        }
    }

    console.log(`\nTotal docs with comments: ${withComments.length}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

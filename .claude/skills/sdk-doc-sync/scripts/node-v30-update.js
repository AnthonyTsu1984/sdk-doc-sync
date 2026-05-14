#!/usr/bin/env node
/**
 * Update v3.0.x docs for 8 methods with type changes.
 *
 * Usage: node scripts/node-v30-update.js [--dry-run] [--only=name]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env'), quiet: true });

const fetch = require('node-fetch');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const BITABLE_TOKEN = 'LlrPbysPZau2dGsSVuicHmvCn0e';
const DELAY_MS = 500;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY = args.find(a => a.startsWith('--only='))?.split('=')[1];

const tokenFetcher = new larkTokenFetcher();
const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

const delay = (ms = DELAY_MS) => new Promise(r => setTimeout(r, ms));

// ── API helpers ──────────────────────────────────────────────────────────────

async function api(method, endpoint, body = null) {
    const token = await tokenFetcher.token();
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${FEISHU_HOST}${endpoint}`, opts);
    const data = await res.json();
    if (data.code !== 0) {
        throw new Error(`API error: ${data.msg} (code ${data.code})\n${JSON.stringify(data, null, 2)}`);
    }
    return data.data;
}

async function getBlocks(docId) {
    const data = await api('GET', `/open-apis/docx/v1/documents/${docId}/blocks`);
    await delay();
    return data.items || [];
}

async function batchUpdate(docId, requests) {
    if (DRY_RUN) {
        console.log(`    [DRY RUN] batch_update on ${docId} → ${requests.length} request(s)`);
        return;
    }
    await api('PATCH', `/open-apis/docx/v1/documents/${docId}/blocks/batch_update`, { requests });
    await delay();
}

async function insertChildren(docId, parentId, children, index) {
    if (DRY_RUN) {
        console.log(`    [DRY RUN] insert ${children.length} child(ren) under ${parentId} at index ${index}`);
        return [];
    }
    const data = await api('POST', `/open-apis/docx/v1/documents/${docId}/blocks/${parentId}/children`, {
        children,
        index,
    });
    await delay();
    return data.children || [];
}

function textRun(content, opts = {}) {
    return {
        text_run: {
            content,
            text_element_style: {
                bold: !!opts.bold,
                italic: !!opts.italic,
                inline_code: !!opts.code,
                strikethrough: false,
                underline: false,
            },
        },
    };
}

function paragraphBlock(elements) {
    return {
        block_type: 2,
        text: { elements, style: { align: 1, folded: false } },
    };
}

function bulletBlock(name, type) {
    return {
        block_type: 12,
        bullet: {
            elements: [
                textRun(name, { bold: true }),
                textRun(' ('),
                textRun(type, { italic: true }),
                textRun(') -'),
            ],
            style: { align: 1, folded: false },
        },
    };
}

async function setCodeContent(docId, blockId, newContent) {
    return batchUpdate(docId, [{
        block_id: blockId,
        update_text_elements: { elements: [textRun(newContent)] },
    }]);
}

// ── Block finders ────────────────────────────────────────────────────────────

function findBlockByContent(blocks, predicate) {
    for (const b of blocks) {
        const text = b.text?.elements?.map(e => e.text_run?.content).join('') || '';
        if (predicate(text, b)) return b;
    }
    return null;
}

function getTextContent(block) {
    if (!block) return '';
    return (block.text?.elements || block.code?.elements || [])
        .map(e => e.text_run?.content || '').join('');
}

// ── Updates ──────────────────────────────────────────────────────────────────

async function updateCreateCollection() {
    const docId = 'Z55qdPU2foS8h0xLs6QcWg6enrC';
    const recordId = 'recu4NXGK3hXLU';
    console.log(`\n[createCollection] ${docId}`);

    // Fetch blocks to find structure
    const blocks = await getBlocks(docId);
    const root = blocks.find(b => b.block_type === 1);
    const rootChildren = root.children;

    // Find Request Syntax code block
    const reqSyntaxHeading = findBlockByContent(blocks, t => t.trim() === 'Request Syntax');
    const reqSyntaxIdx = rootChildren.indexOf(reqSyntaxHeading?.block_id);
    const reqSyntaxCodeId = rootChildren[reqSyntaxIdx + 1];

    // Find PARAMETERS heading
    const paramsHeading = findBlockByContent(blocks, t => t.trim() === 'PARAMETERS:');
    const paramsIdx = rootChildren.indexOf(paramsHeading?.block_id);

    // Count parameter bullets after PARAMETERS heading
    let paramCount = 0;
    for (let i = paramsIdx + 1; i < rootChildren.length; i++) {
        const b = blocks.find(x => x.block_id === rootChildren[i]);
        if (b?.block_type === 12) paramCount++;
        else break;
    }
    const insertIdx = paramsIdx + 1 + paramCount;

    // 1. Update Request Syntax code
    const oldReqSyntax = getTextContent(blocks.find(b => b.block_id === reqSyntaxCodeId));
    const newReqSyntax = oldReqSyntax
        .replace("    functions?: FunctionObject[],", "    functions?: FunctionObject[],\n    external_source?: string,\n    external_spec?: string,\n    do_physical_backfill?: boolean,\n    file_resource_ids?: Array<number | string>,");
    console.log('  · update Request Syntax code');
    await setCodeContent(docId, reqSyntaxCodeId, newReqSyntax);

    // 2. Insert new parameter bullets
    const newBullets = [
        bulletBlock('external_source', 'string'),
        bulletBlock('external_spec', 'string'),
        bulletBlock('do_physical_backfill', 'boolean'),
        bulletBlock('file_resource_ids', 'Array<number | string>'),
    ];
    console.log(`  · insert 4 parameter bullets at root idx ${insertIdx}`);
    const inserted = await insertChildren(docId, docId, newBullets, insertIdx);

    if (!DRY_RUN && inserted.length) {
        const descriptions = [
            'The external source path. Optional.',
            'The external spec configuration. Optional.',
            'Whether to physically backfill external data. Optional.',
            'The external file resource IDs. Optional.',
        ];
        for (let i = 0; i < inserted.length; i++) {
            await insertChildren(docId, inserted[i].block_id, [
                paragraphBlock([textRun(descriptions[i])]),
            ], 0);
        }
    }

    // 3. Update bitable
    console.log('  · update bitable record');
    if (!DRY_RUN) {
        await writer.updateRecord(recordId, {
            title: 'createCollection()',
            link: `https://zilliverse.feishu.cn/docx/${docId}`,
            lastModified: 'v3.0.x',
        });
        await delay();
    }
}

async function updateUpsert() {
    const docId = 'LEptdqqfcoqdtCx0LO1c3yxvnBo';
    const recordId = 'recu4NX3TVG1Bl';
    console.log(`\n[upsert] ${docId}`);

    const blocks = await getBlocks(docId);
    const root = blocks.find(b => b.block_type === 1);
    const rootChildren = root.children;

    const reqSyntaxHeading = findBlockByContent(blocks, t => t.trim() === 'Request Syntax');
    const reqSyntaxIdx = rootChildren.indexOf(reqSyntaxHeading?.block_id);
    const reqSyntaxCodeId = rootChildren[reqSyntaxIdx + 1];

    const paramsHeading = findBlockByContent(blocks, t => t.trim() === 'PARAMETERS:');
    const paramsIdx = rootChildren.indexOf(paramsHeading?.block_id);

    let paramCount = 0;
    for (let i = paramsIdx + 1; i < rootChildren.length; i++) {
        const b = blocks.find(x => x.block_id === rootChildren[i]);
        if (b?.block_type === 12) paramCount++;
        else break;
    }
    const insertIdx = paramsIdx + 1 + paramCount;

    // 1. Update Request Syntax
    const oldReqSyntax = getTextContent(blocks.find(b => b.block_id === reqSyntaxCodeId));
    const newReqSyntax = oldReqSyntax.includes('field_ops')
        ? oldReqSyntax
        : oldReqSyntax.replace(
            "    partition_name?: string,",
            "    partition_name?: string,\n    field_ops?: FieldPartialUpdateOp[],"
        );
    console.log('  · update Request Syntax code');
    await setCodeContent(docId, reqSyntaxCodeId, newReqSyntax);

    // 2. Insert field_ops bullet
    console.log(`  · insert field_ops bullet at root idx ${insertIdx}`);
    const inserted = await insertChildren(docId, docId, [bulletBlock('field_ops', 'FieldPartialUpdateOp[]')], insertIdx);

    if (!DRY_RUN && inserted[0]) {
        await insertChildren(docId, inserted[0].block_id, [
            paragraphBlock([textRun('Partial update operations for array fields. Optional.')]),
        ], 0);
    }

    // 3. Update bitable
    console.log('  · update bitable record');
    if (!DRY_RUN) {
        await writer.updateRecord(recordId, {
            title: 'upsert()',
            link: `https://zilliverse.feishu.cn/docx/${docId}`,
            lastModified: 'v3.0.x',
        });
        await delay();
    }
}

async function updateSearch() {
    const docId = 'HYv3d0NiRoc09Bx4rz0cIhqknb5';
    const recordId = 'recu4NX1YflTzw';
    console.log(`\n[search] ${docId}`);

    const blocks = await getBlocks(docId);
    const root = blocks.find(b => b.block_type === 1);
    const rootChildren = root.children;

    const reqSyntaxHeading = findBlockByContent(blocks, t => t.trim() === 'Request Syntax');
    const reqSyntaxIdx = rootChildren.indexOf(reqSyntaxHeading?.block_id);
    const reqSyntaxCodeId = rootChildren[reqSyntaxIdx + 1];

    const paramsHeading = findBlockByContent(blocks, t => t.trim() === 'PARAMETERS:');
    const paramsIdx = rootChildren.indexOf(paramsHeading?.block_id);

    let paramCount = 0;
    for (let i = paramsIdx + 1; i < rootChildren.length; i++) {
        const b = blocks.find(x => x.block_id === rootChildren[i]);
        if (b?.block_type === 12) paramCount++;
        else break;
    }
    const insertIdx = paramsIdx + 1 + paramCount;

    // 1. Update Request Syntax
    const oldReqSyntax = getTextContent(blocks.find(b => b.block_id === reqSyntaxCodeId));
    const newReqSyntax = oldReqSyntax.includes('order_by_fields')
        ? oldReqSyntax
        : oldReqSyntax.replace(
            "    offset?: number,",
            "    offset?: number,\n    order_by_fields?: OrderByFields,"
        );
    console.log('  · update Request Syntax code');
    await setCodeContent(docId, reqSyntaxCodeId, newReqSyntax);

    // 2. Insert order_by_fields bullet
    console.log(`  · insert order_by_fields bullet at root idx ${insertIdx}`);
    const inserted = await insertChildren(docId, docId, [bulletBlock('order_by_fields', 'OrderByFields')], insertIdx);

    if (!DRY_RUN && inserted[0]) {
        await insertChildren(docId, inserted[0].block_id, [
            paragraphBlock([textRun('The fields to order the search results by. Optional.')]),
        ], 0);
    }

    // 3. Update bitable
    console.log('  · update bitable record');
    if (!DRY_RUN) {
        await writer.updateRecord(recordId, {
            title: 'search()',
            link: `https://zilliverse.feishu.cn/docx/${docId}`,
            lastModified: 'v3.0.x',
        });
        await delay();
    }
}

async function updateQuery() {
    const docId = 'Nle5dNFMuoy3MgxGIFGcJDWtnpg';
    const recordId = 'recu4NWZSVy49a';
    console.log(`\n[query] ${docId}`);

    const blocks = await getBlocks(docId);
    const root = blocks.find(b => b.block_type === 1);
    const rootChildren = root.children;

    const reqSyntaxHeading = findBlockByContent(blocks, t => t.trim() === 'Request Syntax');
    const reqSyntaxIdx = rootChildren.indexOf(reqSyntaxHeading?.block_id);
    const reqSyntaxCodeId = rootChildren[reqSyntaxIdx + 1];

    const paramsHeading = findBlockByContent(blocks, t => t.trim() === 'PARAMETERS:');
    const paramsIdx = rootChildren.indexOf(paramsHeading?.block_id);

    let paramCount = 0;
    for (let i = paramsIdx + 1; i < rootChildren.length; i++) {
        const b = blocks.find(x => x.block_id === rootChildren[i]);
        if (b?.block_type === 12) paramCount++;
        else break;
    }
    const insertIdx = paramsIdx + 1 + paramCount;

    // 1. Update Request Syntax
    const oldReqSyntax = getTextContent(blocks.find(b => b.block_id === reqSyntaxCodeId));
    let newReqSyntax = oldReqSyntax;
    if (!oldReqSyntax.includes('order_by_fields')) {
        newReqSyntax = newReqSyntax.replace(
            "    offset?: number,",
            "    offset?: number,\n    order_by_fields?: OrderByFields,"
        );
    }
    if (!newReqSyntax.includes('order_by')) {
        newReqSyntax = newReqSyntax.replace(
            "    order_by_fields?: OrderByFields,",
            "    order_by_fields?: OrderByFields,\n    order_by?: OrderByFields,"
        );
    }
    console.log('  · update Request Syntax code');
    await setCodeContent(docId, reqSyntaxCodeId, newReqSyntax);

    // 2. Insert bullets
    const bullets = [];
    if (!getTextContent(blocks.find(b => b.block_id === rootChildren[insertIdx - 1])).includes('order_by_fields')) {
        bullets.push(bulletBlock('order_by_fields', 'OrderByFields'));
    }
    if (!getTextContent(blocks.find(b => b.block_id === rootChildren[insertIdx - 1])).includes('order_by')) {
        bullets.push(bulletBlock('order_by', 'OrderByFields'));
    }

    if (bullets.length) {
        console.log(`  · insert ${bullets.length} parameter bullet(s) at root idx ${insertIdx}`);
        const inserted = await insertChildren(docId, docId, bullets, insertIdx);
        if (!DRY_RUN && inserted.length) {
            const descriptions = [
                'The fields to order the query results by. Optional.',
                'Alias for order_by_fields. Optional.',
            ];
            for (let i = 0; i < inserted.length; i++) {
                await insertChildren(docId, inserted[i].block_id, [
                    paragraphBlock([textRun(descriptions[i])]),
                ], 0);
            }
        }
    }

    // 3. Update bitable
    console.log('  · update bitable record');
    if (!DRY_RUN) {
        await writer.updateRecord(recordId, {
            title: 'query()',
            link: `https://zilliverse.feishu.cn/docx/${docId}`,
            lastModified: 'v3.0.x',
        });
        await delay();
    }
}

async function updateHybridSearch() {
    const docId = 'Ph9ldBswooKwebxKI9EcqSu4nlc';
    const recordId = 'recuF2epyTbGWv';
    console.log(`\n[hybridSearch] ${docId}`);

    const blocks = await getBlocks(docId);
    const root = blocks.find(b => b.block_type === 1);
    const rootChildren = root.children;

    const reqSyntaxHeading = findBlockByContent(blocks, t => t.trim() === 'Request Syntax');
    const reqSyntaxIdx = rootChildren.indexOf(reqSyntaxHeading?.block_id);
    const reqSyntaxCodeId = rootChildren[reqSyntaxIdx + 1];

    const paramsHeading = findBlockByContent(blocks, t => t.trim() === 'PARAMETERS:');
    const paramsIdx = rootChildren.indexOf(paramsHeading?.block_id);

    let paramCount = 0;
    for (let i = paramsIdx + 1; i < rootChildren.length; i++) {
        const b = blocks.find(x => x.block_id === rootChildren[i]);
        if (b?.block_type === 12) paramCount++;
        else break;
    }
    const insertIdx = paramsIdx + 1 + paramCount;

    // 1. Update Request Syntax
    const oldReqSyntax = getTextContent(blocks.find(b => b.block_id === reqSyntaxCodeId));
    const newReqSyntax = oldReqSyntax.includes('order_by_fields')
        ? oldReqSyntax
        : oldReqSyntax.replace(
            "    offset?: number,",
            "    offset?: number,\n    order_by_fields?: OrderByFields,"
        );
    console.log('  · update Request Syntax code');
    await setCodeContent(docId, reqSyntaxCodeId, newReqSyntax);

    // 2. Insert order_by_fields bullet
    console.log(`  · insert order_by_fields bullet at root idx ${insertIdx}`);
    const inserted = await insertChildren(docId, docId, [bulletBlock('order_by_fields', 'OrderByFields')], insertIdx);

    if (!DRY_RUN && inserted[0]) {
        await insertChildren(docId, inserted[0].block_id, [
            paragraphBlock([textRun('The fields to order the search results by. Optional.')]),
        ], 0);
    }

    // 3. Update bitable
    console.log('  · update bitable record');
    if (!DRY_RUN) {
        await writer.updateRecord(recordId, {
            title: 'hybridSearch()',
            link: `https://zilliverse.feishu.cn/docx/${docId}`,
            lastModified: 'v3.0.x',
        });
        await delay();
    }
}

async function updateSearchIterator() {
    const docId = 'K5APdBqphoQG7vxU4P2ccr5Wnig';
    const recordId = 'recuF2nZA2wTMf';
    console.log(`\n[searchIterator] ${docId}`);

    const blocks = await getBlocks(docId);
    const root = blocks.find(b => b.block_type === 1);
    const rootChildren = root.children;

    const reqSyntaxHeading = findBlockByContent(blocks, t => t.trim() === 'Request Syntax');
    const reqSyntaxIdx = rootChildren.indexOf(reqSyntaxHeading?.block_id);
    const reqSyntaxCodeId = rootChildren[reqSyntaxIdx + 1];

    const paramsHeading = findBlockByContent(blocks, t => t.trim() === 'PARAMETERS:');
    const paramsIdx = rootChildren.indexOf(paramsHeading?.block_id);

    let paramCount = 0;
    for (let i = paramsIdx + 1; i < rootChildren.length; i++) {
        const b = blocks.find(x => x.block_id === rootChildren[i]);
        if (b?.block_type === 12) paramCount++;
        else break;
    }
    const insertIdx = paramsIdx + 1 + paramCount;

    // 1. Update Request Syntax
    const oldReqSyntax = getTextContent(blocks.find(b => b.block_id === reqSyntaxCodeId));
    const newReqSyntax = oldReqSyntax.includes('order_by_fields')
        ? oldReqSyntax
        : oldReqSyntax.replace(
            "    offset?: number,",
            "    offset?: number,\n    order_by_fields?: OrderByFields,"
        );
    console.log('  · update Request Syntax code');
    await setCodeContent(docId, reqSyntaxCodeId, newReqSyntax);

    // 2. Insert order_by_fields bullet
    console.log(`  · insert order_by_fields bullet at root idx ${insertIdx}`);
    const inserted = await insertChildren(docId, docId, [bulletBlock('order_by_fields', 'OrderByFields')], insertIdx);

    if (!DRY_RUN && inserted[0]) {
        await insertChildren(docId, inserted[0].block_id, [
            paragraphBlock([textRun('The fields to order the search results by. Optional.')]),
        ], 0);
    }

    // 3. Update bitable
    console.log('  · update bitable record');
    if (!DRY_RUN) {
        await writer.updateRecord(recordId, {
            title: 'searchIterator()',
            link: `https://zilliverse.feishu.cn/docx/${docId}`,
            lastModified: 'v3.0.x',
        });
        await delay();
    }
}

async function updateQueryIterator() {
    const docId = 'YZ3GdmklAolLnux8LRhcw7hxnvd';
    const recordId = 'recuF2nZ2LE0oj';
    console.log(`\n[queryIterator] ${docId}`);

    const blocks = await getBlocks(docId);
    const root = blocks.find(b => b.block_type === 1);
    const rootChildren = root.children;

    const reqSyntaxHeading = findBlockByContent(blocks, t => t.trim() === 'Request Syntax');
    const reqSyntaxIdx = rootChildren.indexOf(reqSyntaxHeading?.block_id);
    const reqSyntaxCodeId = rootChildren[reqSyntaxIdx + 1];

    const paramsHeading = findBlockByContent(blocks, t => t.trim() === 'PARAMETERS:');
    const paramsIdx = rootChildren.indexOf(paramsHeading?.block_id);

    let paramCount = 0;
    for (let i = paramsIdx + 1; i < rootChildren.length; i++) {
        const b = blocks.find(x => x.block_id === rootChildren[i]);
        if (b?.block_type === 12) paramCount++;
        else break;
    }
    const insertIdx = paramsIdx + 1 + paramCount;

    // 1. Update Request Syntax
    const oldReqSyntax = getTextContent(blocks.find(b => b.block_id === reqSyntaxCodeId));
    const newReqSyntax = oldReqSyntax.includes('element_indices')
        ? oldReqSyntax
        : oldReqSyntax.replace(
            "    batchSize: number,",
            "    batchSize: number,\n    element_indices?: ElementIndices[],"
        );
    console.log('  · update Request Syntax code');
    await setCodeContent(docId, reqSyntaxCodeId, newReqSyntax);

    // 2. Insert element_indices bullet
    console.log(`  · insert element_indices bullet at root idx ${insertIdx}`);
    const inserted = await insertChildren(docId, docId, [bulletBlock('element_indices', 'ElementIndices[]')], insertIdx);

    if (!DRY_RUN && inserted[0]) {
        await insertChildren(docId, inserted[0].block_id, [
            paragraphBlock([textRun('Element indices for the query iterator. Optional.')]),
        ], 0);
    }

    // 3. Update bitable
    console.log('  · update bitable record');
    if (!DRY_RUN) {
        await writer.updateRecord(recordId, {
            title: 'queryIterator()',
            link: `https://zilliverse.feishu.cn/docx/${docId}`,
            lastModified: 'v3.0.x',
        });
        await delay();
    }
}

async function updateDescribeCollection() {
    const docId = 'Z4Kfd0zFkoQCI8xZiRZc1D8anpc';
    const recordId = 'recu4NXMBgD2NV';
    console.log(`\n[describeCollection] ${docId}`);

    const blocks = await getBlocks(docId);
    const root = blocks.find(b => b.block_type === 1);
    const rootChildren = root.children;

    // Find Response code block (should be after RETURNS)
    const returnsHeading = findBlockByContent(blocks, t => t.trim() === 'RETURNS:');
    const returnsIdx = rootChildren.indexOf(returnsHeading?.block_id);
    let respCodeId = null;
    for (let i = returnsIdx + 1; i < rootChildren.length; i++) {
        const b = blocks.find(x => x.block_id === rootChildren[i]);
        if (b?.block_type === 14) {
            respCodeId = b.block_id;
            break;
        }
    }

    if (!respCodeId) {
        console.log('  · Response code block not found, skipping content update');
    } else {
        const oldResp = getTextContent(blocks.find(b => b.block_id === respCodeId));
        const newResp = oldResp.includes('external_source')
            ? oldResp
            : oldResp.replace(
                "    struct_array_fields: FieldSchema[],",
                "    struct_array_fields: FieldSchema[],\n    external_source?: string,\n    external_spec?: string,\n    do_physical_backfill?: boolean,\n    file_resource_ids?: string[],"
            );
        console.log('  · update Response code');
        await setCodeContent(docId, respCodeId, newResp);
    }

    // 3. Update bitable
    console.log('  · update bitable record');
    if (!DRY_RUN) {
        await writer.updateRecord(recordId, {
            title: 'describeCollection()',
            link: `https://zilliverse.feishu.cn/docx/${docId}`,
            lastModified: 'v3.0.x',
        });
        await delay();
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`Node v3.0.x UPDATE — ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
    if (ONLY) console.log(`(filter: only=${ONLY})`);

    const updates = {
        createCollection: updateCreateCollection,
        upsert: updateUpsert,
        search: updateSearch,
        query: updateQuery,
        hybridSearch: updateHybridSearch,
        searchIterator: updateSearchIterator,
        queryIterator: updateQueryIterator,
        describeCollection: updateDescribeCollection,
    };

    for (const [name, fn] of Object.entries(updates)) {
        if (ONLY && name !== ONLY) continue;
        await fn();
    }

    console.log('\nDone.');
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });

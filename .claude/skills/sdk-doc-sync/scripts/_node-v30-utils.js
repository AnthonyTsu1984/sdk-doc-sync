/**
 * Shared helpers for v3.0.x Node SDK doc patching.
 *
 * Extracted from node-v30-update.js so multiple scripts can share the same
 * Feishu doc-API + block-finder primitives.
 *
 * Usage:
 *   const path = require('path');
 *   require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env'), quiet: true });
 *   const utils = require('./_node-v30-utils')({ dryRun: false });
 *   const blocks = await utils.getBlocks(docId);
 *   ...
 */

const fetch = require('node-fetch');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';

function createUtils({ dryRun = false, delayMs = 500 } = {}) {
    const tokenFetcher = new larkTokenFetcher();
    const delay = (ms = delayMs) => new Promise(r => setTimeout(r, ms));

    async function api(method, endpoint, body = null) {
        const token = await tokenFetcher.token();
        const opts = {
            method,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                Authorization: `Bearer ${token}`,
            },
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
        const items = [];
        let pageToken = null;
        do {
            const qs = pageToken ? `?page_token=${encodeURIComponent(pageToken)}&page_size=500` : '?page_size=500';
            const data = await api('GET', `/open-apis/docx/v1/documents/${docId}/blocks${qs}`);
            items.push(...(data.items || []));
            pageToken = data.has_more ? data.page_token : null;
            if (pageToken) await delay();
        } while (pageToken);
        await delay();
        return items;
    }

    async function batchUpdate(docId, requests) {
        if (dryRun) {
            console.log(`    [DRY RUN] batch_update on ${docId} → ${requests.length} request(s)`);
            return;
        }
        await api('PATCH', `/open-apis/docx/v1/documents/${docId}/blocks/batch_update`, { requests });
        await delay();
    }

    async function insertChildren(docId, parentId, children, index) {
        if (dryRun) {
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

    async function deleteChildrenRange(docId, parentId, startIndex, endIndex) {
        if (dryRun) {
            console.log(`    [DRY RUN] delete children of ${parentId} [${startIndex}, ${endIndex})`);
            return;
        }
        await api(
            'DELETE',
            `/open-apis/docx/v1/documents/${docId}/blocks/${parentId}/children/batch_delete`,
            { start_index: startIndex, end_index: endIndex },
        );
        await delay();
    }

    async function setCodeContent(docId, blockId, newContent) {
        return batchUpdate(docId, [{
            block_id: blockId,
            update_text_elements: { elements: [textRun(newContent)] },
        }]);
    }

    return {
        api,
        delay,
        getBlocks,
        batchUpdate,
        insertChildren,
        deleteChildrenRange,
        setCodeContent,
        tokenFetcher,
    };
}

// ── Block builders (pure, no API calls) ─────────────────────────────────────

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
    const elements = [textRun(name, { bold: true })];
    if (type) {
        elements.push(textRun(' ('));
        elements.push(textRun(type, { italic: true }));
        elements.push(textRun(') -'));
    }
    return {
        block_type: 12,
        bullet: {
            elements,
            style: { align: 1, folded: false },
        },
    };
}

function codeBlock(content, language = 49) {
    // language: 29 = javascript, 49 = typescript
    return {
        block_type: 14,
        code: {
            elements: [textRun(content)],
            style: { language, wrap: false },
        },
    };
}

function heading2Block(content) {
    return {
        block_type: 4,
        heading2: {
            elements: [textRun(content)],
            style: { align: 1, folded: false },
        },
    };
}

// ── Block finders ────────────────────────────────────────────────────────────

function findBlockByContent(blocks, predicate) {
    for (const b of blocks) {
        const text = (b.text?.elements || b.heading1?.elements || b.heading2?.elements || b.heading3?.elements || b.bullet?.elements || [])
            .map(e => e.text_run?.content || '').join('');
        if (predicate(text, b)) return b;
    }
    return null;
}

function getTextContent(block) {
    if (!block) return '';
    return (
        block.text?.elements ||
        block.heading1?.elements ||
        block.heading2?.elements ||
        block.heading3?.elements ||
        block.bullet?.elements ||
        block.code?.elements ||
        []
    ).map(e => e.text_run?.content || '').join('');
}

module.exports = createUtils;
module.exports.textRun = textRun;
module.exports.paragraphBlock = paragraphBlock;
module.exports.bulletBlock = bulletBlock;
module.exports.codeBlock = codeBlock;
module.exports.heading2Block = heading2Block;
module.exports.findBlockByContent = findBlockByContent;
module.exports.getTextContent = getTextContent;

#!/usr/bin/env node
/**
 * Export a single Feishu docx to Markdown.
 *
 * Usage:
 *   node .claude/skills/sdk-doc-sync/bin/export-doc.js <doc-token-or-url> [output-file]
 *
 * Example:
 *   node .claude/skills/sdk-doc-sync/bin/export-doc.js PR2adhLOKo3qCtxug65cKieMnUM ./output.md
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../../../..');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';
require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });

const fetch = require('node-fetch');
const FeishuClient = require('../src/feishu/feishu-client');
const DocxReader = require('../src/feishu/docx-reader');
const { docxToIr } = require('../src/document-ir/docx-to-ir');
const { renderMarkdown } = require('../src/document-ir/ir-to-markdown');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

function extractToken(input) {
    const match = input.match(/(?:docx|wiki)\/([^/?#]+)/);
    return match ? match[1] : input;
}

function createDocumentReader({ sourceType = 'drive' } = {}) {
    const tokenFetcher = new larkTokenFetcher();
    const client = new FeishuClient({
        host: process.env.FEISHU_HOST || 'https://open.feishu.cn',
        tokenProvider: () => tokenFetcher.token(),
        transport: ({ url, method, headers, body }) => fetch(url, { method, headers, body }),
    });
    const reader = new DocxReader({ client, sourceType });
    return {
        async readMarkdown(token) {
            const blocks = await reader.expandReferences(await reader.readBlocks(token));
            const ir = docxToIr(blocks, { metadata: { token } });
            return renderMarkdown(ir, { lossy: true }).replace(/import .* from .*/g, '').trim();
        },
    };
}

async function exportDocument({
    input,
    outputFile = 'exported.md',
    documentReader = createDocumentReader(),
    writeFile = (file, content) => fs.writeFileSync(file, content, 'utf8'),
    log = console.log,
} = {}) {
    if (!input) throw new TypeError('input is required');
    const token = extractToken(input);
    log(`Exporting Feishu doc: ${token}`);
    const markdown = await documentReader.readMarkdown(token);
    if (typeof markdown !== 'string' || markdown.length === 0) {
        throw new Error('No markdown returned for document export');
    }
    writeFile(outputFile, markdown);
    log(`Done. Markdown written to: ${path.resolve(outputFile)}`);
    return { token, outputFile, markdown };
}

async function main() {
    const rawInput = process.argv[2];
    const outputFile = process.argv[3] || 'exported.md';

    if (!rawInput) {
        console.error('Usage: node .claude/skills/sdk-doc-sync/bin/export-doc.js <doc-token-or-url> [output-file]');
        process.exit(1);
    }

    await exportDocument({ input: rawInput, outputFile });
}

if (require.main === module) {
    main().catch(err => {
        console.error('Error:', err.message);
        process.exit(1);
    });
}

module.exports = { exportDocument, extractToken, createDocumentReader };

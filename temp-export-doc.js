#!/usr/bin/env node
/**
 * Temp script: export a single Feishu docx to Markdown.
 *
 * Usage:
 *   node temp-export-doc.js <doc-token-or-url> [output-file]
 *
 * Example:
 *   node temp-export-doc.js PR2adhLOKo3qCtxug65cKieMnUM ./output.md
 */

'use strict';

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const FeishuToMarkdown = require('./.claude/skills/sdk-doc-sync/src/feishu-to-markdown');

function extractToken(input) {
    const match = input.match(/(?:docx|wiki)\/([a-zA-Z0-9]+)/);
    return match ? match[1] : input;
}

async function main() {
    const rawInput = process.argv[2];
    const outputFile = process.argv[3] || 'exported.md';

    if (!rawInput) {
        console.error('Usage: node temp-export-doc.js <doc-token-or-url> [output-file]');
        process.exit(1);
    }

    const docToken = extractToken(rawInput);
    console.log(`Exporting Feishu doc: ${docToken}`);

    const converter = new FeishuToMarkdown({
        sourceType: 'drive',
        rootToken: null,
        baseToken: null
    });

    converter.targets = 'all';

    console.log('Fetching document blocks...');
    const blocks = await converter.__fetch_doc_blocks(docToken);

    if (!blocks || blocks.length === 0) {
        console.error('No blocks found or failed to fetch document.');
        process.exit(1);
    }

    converter.page_blocks = blocks;

    const pageBlock = blocks.find(b => b.block_type === 1);
    if (!pageBlock) {
        console.error('No page block (block_type === 1) found in document.');
        process.exit(1);
    }

    converter.blocks = pageBlock.children
        ? pageBlock.children.map(childId => converter.__retrieve_block_by_id(childId)).filter(Boolean)
        : [];

    console.log(`Found ${blocks.length} blocks, ${converter.blocks.length} top-level.`);
    console.log('Converting to markdown...');

    let markdown = await converter.__markdown();

    markdown = markdown.replace(/import .* from .*/g, '').trim();

    fs.writeFileSync(outputFile, markdown, 'utf8');
    console.log(`Done. Markdown written to: ${path.resolve(outputFile)}`);
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});

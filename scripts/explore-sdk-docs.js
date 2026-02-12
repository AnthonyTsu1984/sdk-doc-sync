#!/usr/bin/env node
/**
 * Explore the existing Python SDK reference docs in Feishu Drive.
 *
 * Walks the ACKGfinsNlQCovdK2v1cPxiqnle folder to understand:
 * 1. Folder structure (version-specific folders)
 * 2. Bitable schemas (field names, record structure)
 * 3. Sample doc content (what the actual reference docs look like)
 *
 * Usage: node scripts/explore-sdk-docs.js
 */

const fetch = require('node-fetch');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const ROOT_FOLDER = 'ACKGfinsNlQCovdK2v1cPxiqnle';

const tokenFetcher = new larkTokenFetcher();

async function apiGet(url) {
    const token = await tokenFetcher.token();
    const res = await fetch(url, {
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${token}`,
        },
    });
    return res.json();
}

async function apiPost(url, body) {
    const token = await tokenFetcher.token();
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
    return res.json();
}

async function listFolder(folderToken, indent = '') {
    const url = `${FEISHU_HOST}/open-apis/drive/v1/files?folder_token=${folderToken}&page_size=50`;
    const data = await apiGet(url);

    if (data.code !== 0) {
        console.log(`${indent}  ERROR: ${data.msg}`);
        return [];
    }

    const files = data.data?.files || [];
    files.sort((a, b) => a.name.localeCompare(b.name));
    return files;
}

async function listBitableTables(baseToken) {
    const url = `${FEISHU_HOST}/open-apis/bitable/v1/apps/${baseToken}/tables`;
    const data = await apiGet(url);

    if (data.code !== 0) {
        console.log(`  ERROR listing tables: ${data.msg}`);
        return [];
    }

    return data.data?.items || [];
}

async function listBitableFields(baseToken, tableId) {
    const url = `${FEISHU_HOST}/open-apis/bitable/v1/apps/${baseToken}/tables/${tableId}/fields`;
    const data = await apiGet(url);

    if (data.code !== 0) {
        console.log(`  ERROR listing fields: ${data.msg}`);
        return [];
    }

    return data.data?.items || [];
}

async function sampleBitableRecords(baseToken, tableId, limit = 3) {
    const url = `${FEISHU_HOST}/open-apis/bitable/v1/apps/${baseToken}/tables/${tableId}/records?page_size=${limit}`;
    const data = await apiGet(url);

    if (data.code !== 0) {
        console.log(`  ERROR listing records: ${data.msg}`);
        return [];
    }

    return data.data?.items || [];
}

async function getDocBlocks(docToken, limit = 20) {
    const url = `${FEISHU_HOST}/open-apis/docx/v1/documents/${docToken}/blocks?page_size=${limit}`;
    const data = await apiGet(url);

    if (data.code !== 0) {
        console.log(`  ERROR fetching blocks: ${data.msg}`);
        return [];
    }

    return data.data?.items || [];
}

// Use FeishuToMarkdown to get full markdown of a doc
async function getDocMarkdown(docToken) {
    const FeishuToMarkdown = require('../src/feishu-to-markdown');
    // We need a bitable to use F2M, but we can use the raw block fetching
    // Just fetch blocks and summarize structure
    const blocks = await getDocBlocks(docToken, 100);
    return blocks;
}

async function run() {
    console.log('='.repeat(70));
    console.log('  Exploring Python SDK Reference Docs in Feishu');
    console.log('='.repeat(70));

    // Phase 1: List root folder contents
    console.log(`\n--- Phase 1: Root Folder (${ROOT_FOLDER}) ---\n`);
    const rootFiles = await listFolder(ROOT_FOLDER);

    const folders = [];
    const bitables = [];
    const docs = [];

    for (const file of rootFiles) {
        const icon = file.type === 'folder' ? '📁' : file.type === 'bitable' ? '📊' : file.type === 'docx' ? '📄' : '📎';
        console.log(`  ${icon} ${file.name} (${file.type}, token: ${file.token})`);

        if (file.type === 'folder') folders.push(file);
        if (file.type === 'bitable') bitables.push(file);
        if (file.type === 'docx') docs.push(file);
    }

    // Phase 2: Explore version folders
    console.log(`\n--- Phase 2: Version Folders (${folders.length} found) ---\n`);

    const sampleVersionFolder = folders.length > 0 ? folders[folders.length - 1] : null; // Latest version

    for (const folder of folders) {
        const children = await listFolder(folder.token);
        const docCount = children.filter(c => c.type === 'docx').length;
        const subFolderCount = children.filter(c => c.type === 'folder').length;
        console.log(`  📁 ${folder.name}: ${docCount} docs, ${subFolderCount} subfolders`);

        // Show first few docs in the latest version
        if (folder === sampleVersionFolder) {
            console.log(`\n    Contents of ${folder.name}:`);
            for (const child of children.slice(0, 15)) {
                const icon = child.type === 'folder' ? '📁' : '📄';
                console.log(`      ${icon} ${child.name} (${child.type}, token: ${child.token})`);
            }
            if (children.length > 15) {
                console.log(`      ... and ${children.length - 15} more`);
            }

            // Explore a subfolder if there is one
            const subFolder = children.find(c => c.type === 'folder');
            if (subFolder) {
                const subChildren = await listFolder(subFolder.token);
                console.log(`\n    Contents of ${folder.name}/${subFolder.name}:`);
                for (const child of subChildren.slice(0, 10)) {
                    const icon = child.type === 'folder' ? '📁' : '📄';
                    console.log(`      ${icon} ${child.name} (${child.type}, token: ${child.token})`);
                }
                if (subChildren.length > 10) {
                    console.log(`      ... and ${subChildren.length - 10} more`);
                }
            }
        }
    }

    // Phase 3: Explore bitables
    console.log(`\n--- Phase 3: Bitables (${bitables.length} found) ---\n`);

    for (const bitable of bitables) {
        console.log(`  📊 ${bitable.name} (token: ${bitable.token})`);

        const tables = await listBitableTables(bitable.token);
        for (const table of tables) {
            console.log(`\n    Table: ${table.name} (id: ${table.table_id})`);

            // List fields
            const fields = await listBitableFields(bitable.token, table.table_id);
            console.log(`    Fields (${fields.length}):`);
            for (const field of fields) {
                const typeNames = { 1: 'Text', 2: 'Number', 3: 'Select', 4: 'MultiSelect', 5: 'Date', 7: 'Checkbox', 11: 'Person', 13: 'Phone', 15: 'URL', 17: 'Attachment', 18: 'Link', 19: 'Formula', 20: 'DuplexLink', 22: 'Location', 23: 'GroupChat', 1001: 'Created Time', 1002: 'Modified Time', 1003: 'Created By', 1004: 'Modified By', 1005: 'AutoNumber' };
                const typeName = typeNames[field.type] || `type_${field.type}`;
                console.log(`      - ${field.field_name} (${typeName})`);
            }

            // Sample records
            const records = await sampleBitableRecords(bitable.token, table.table_id, 3);
            if (records.length > 0) {
                console.log(`\n    Sample records (first ${records.length}):`);
                for (const record of records) {
                    console.log(`      Record ${record.record_id}:`);
                    for (const [key, value] of Object.entries(record.fields)) {
                        const display = typeof value === 'object' ? JSON.stringify(value).slice(0, 120) : String(value).slice(0, 120);
                        console.log(`        ${key}: ${display}`);
                    }
                    console.log('');
                }
            }
        }
    }

    // Phase 4: Sample a doc from the latest version folder
    if (sampleVersionFolder) {
        console.log(`\n--- Phase 4: Sample Doc Content ---\n`);
        const children = await listFolder(sampleVersionFolder.token);
        const sampleDoc = children.find(c => c.type === 'docx');

        if (sampleDoc) {
            console.log(`  Reading: ${sampleDoc.name} (token: ${sampleDoc.token})`);
            const blocks = await getDocBlocks(sampleDoc.token, 50);

            console.log(`  Total blocks: ${blocks.length}\n`);
            console.log('  Block structure:');
            for (const block of blocks) {
                const typeNames = { 1: 'page', 2: 'text', 3: 'h1', 4: 'h2', 5: 'h3', 6: 'h4', 12: 'bullet', 13: 'ordered', 14: 'code', 15: 'quote', 17: 'todo', 22: 'divider', 27: 'image', 31: 'table' };
                const typeName = typeNames[block.block_type] || `type_${block.block_type}`;

                let content = '';
                const key = Object.keys(block).find(k => k !== 'block_id' && k !== 'block_type' && k !== 'parent_id' && k !== 'children' && k !== 'page');
                if (key && block[key]?.elements) {
                    content = block[key].elements
                        .map(e => e.text_run?.content || e.mention_doc?.title || '')
                        .join('')
                        .slice(0, 80);
                }

                const childCount = block.children ? ` (${block.children.length} children)` : '';
                console.log(`    ${typeName.padEnd(8)} ${content}${childCount}`);
            }
        }
    }

    console.log('\n' + '='.repeat(70));
    console.log('  Exploration complete');
    console.log('='.repeat(70));
}

run().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});

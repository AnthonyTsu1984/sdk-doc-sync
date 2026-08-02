#!/usr/bin/env node
// Repoint v1.3.x bitable Docs links so each record points at the new v1.3.x
// drive content instead of the legacy v0.1.x docs.
//
// 106 docx records  -> repoint to corresponding new docx token (from /tmp/v13x-doc-copy-mapping.json)
//  24 VirtualNode records -> repoint to corresponding v1.3.x folder URL (from /tmp/v13x-folders.json)
//
// Idempotent: safe to re-run; prints a [skip-already-pointed] line for records
// already at the desired link, [updated] for changes.

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const fs            = require('fs');
const BitableWriter = require('../../src/sdk-doc-sync/bitable-writer');

const V13X_BITABLE  = 'Rr4lbWr8baQj5psICV9cEFa2nYe';
const V13X_TABLE    = 'tblpQmRZvCES9KCF';
const FEISHU_DOC    = 'https://zilliverse.feishu.cn/docx';
const FEISHU_FOLDER = 'https://zilliverse.feishu.cn/drive/folder';

const folders   = JSON.parse(fs.readFileSync('/tmp/v13x-folders.json', 'utf8'));
const copyMap   = JSON.parse(fs.readFileSync('/tmp/v13x-doc-copy-mapping.json', 'utf8'));
const mapping   = JSON.parse(fs.readFileSync('/tmp/v13x-bitable-mapping.json', 'utf8'));

// old docx token -> new docx token
const oldToNew = new Map(copyMap.copied.map(c => [c.oldToken, c.newToken]));

// folder name -> folder token (categories + subcategories, so 3+24 entries)
const folderTokens = new Map();
for (const [catName, cat] of Object.entries(folders.categories)) {
    folderTokens.set(catName, cat.token);
    for (const [subName, sub] of Object.entries(cat.subfolders)) {
        folderTokens.set(subName, sub.token);
    }
}

function extractDocxToken(link) {
    const m = (link || '').match(/\/docx\/([A-Za-z0-9]+)/);
    return m ? m[1] : null;
}

(async () => {
    const bw = new BitableWriter({ baseToken: V13X_BITABLE, tableId: V13X_TABLE });

    let docxOk = 0, docxSkip = 0, docxFail = 0;
    let virtOk = 0, virtSkip = 0, virtFail = 0;

    const allRecords = mapping.mapping;
    console.log(`Total records: ${allRecords.length}`);

    for (let i = 0; i < allRecords.length; i++) {
        const r        = allRecords[i];
        const link     = r.v13DocsLink?.link || '';
        const idx      = `[${i+1}/${allRecords.length}]`;
        const recId    = r.v13RecordId;
        const title    = r.title;

        if (/^http:\/\/[^./?#:]+$/i.test(link)) {
            // VirtualNode placeholder (malformed http://Name)
            const folderToken = folderTokens.get(title);
            if (!folderToken) {
                console.error(`${idx} VIRT-FAIL no folder for "${title}"`);
                virtFail++;
                continue;
            }
            const newLink = `${FEISHU_FOLDER}/${folderToken}`;
            if (link === newLink) {
                console.log(`${idx} VIRT skip-pointed  ${title}`);
                virtSkip++;
                continue;
            }
            try {
                await bw.updateRecord(recId, { title, link: newLink });
                console.log(`${idx} VIRT updated  ${title} -> ${folderToken}`);
                virtOk++;
            } catch (err) {
                console.error(`${idx} VIRT-FAIL ${title}: ${err.message}`);
                virtFail++;
            }
        } else if (link.startsWith(`${FEISHU_FOLDER}/`)) {
            // VirtualNode already repointed
            console.log(`${idx} VIRT skip-pointed  ${title}`);
            virtSkip++;
            continue;
        } else {
            // Docx record
            const oldTok = extractDocxToken(link);
            if (!oldTok) {
                console.error(`${idx} DOCX-FAIL ${title}: cannot parse old docx token from "${link}"`);
                docxFail++;
                continue;
            }
            const newTok = oldToNew.get(oldTok);
            if (!newTok) {
                console.error(`${idx} DOCX-FAIL ${title}: no copy mapping for old token ${oldTok}`);
                docxFail++;
                continue;
            }
            const desired = `${FEISHU_DOC}/${newTok}`;
            if (link === desired) {
                console.log(`${idx} DOCX skip-pointed  ${title}`);
                docxSkip++;
                continue;
            }
            try {
                await bw.updateRecord(recId, { title, link: desired });
                console.log(`${idx} DOCX updated  ${title}  ${oldTok} -> ${newTok}`);
                docxOk++;
            } catch (err) {
                console.error(`${idx} DOCX-FAIL ${title}: ${err.message}`);
                docxFail++;
            }
        }
    }

    console.log('\nSummary:');
    console.log(`  docx updated/skipped/failed: ${docxOk} / ${docxSkip} / ${docxFail}`);
    console.log(`  virt updated/skipped/failed: ${virtOk} / ${virtSkip} / ${virtFail}`);
})();

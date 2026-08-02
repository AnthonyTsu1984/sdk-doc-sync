#!/usr/bin/env node
// Read /tmp/v01x-inventory.json (raw FOLDER and BITABLE dumps from inventory-v01x.js)
// and produce a structured manifest:
//   - doc → category mapping (every docx in the folder, with its parent + grandparent folders)
//   - bitable record classification (VirtualNode = folder pointer, Function/Class/Module = doc record)
//   - orphan docs (in folder but not in bitable)
//   - broken records (point to a docId not in the folder)

const fs   = require('fs');
const path = require('path');

const RAW = fs.readFileSync('/tmp/v01x-inventory.json', 'utf8');

// The dump file actually contains raw stdout from the inventory script:
//   ===FOLDER===
//   { ...json... }
//   ===BITABLE===
//   [ ...json... ]
//   ===STATS===
//   ...
const folderJson  = RAW.match(/===FOLDER===\n([\s\S]*?)\n===BITABLE===/)[1];
const bitableJson = RAW.match(/===BITABLE===\n([\s\S]*?)\n===STATS===/)[1];
const folder  = JSON.parse(folderJson);
const records = JSON.parse(bitableJson);

// 1. Flatten folder tree → list of docs with breadcrumb
const allDocs = [];                                                              // {token, name, category, subcategory, parentFolderToken}
const allFolders = [{ name: 'v0.1.x ROOT', token: folder.root, path: '/' }];

for (const [catName, cat] of Object.entries(folder.categories)) {
    allFolders.push({ name: catName, token: cat.token, path: `/${catName}` });
    for (const [subName, sub] of Object.entries(cat.subfolders || {})) {
        allFolders.push({ name: subName, token: sub.token, path: `/${catName}/${subName}` });
        for (const d of sub.docs || []) {
            allDocs.push({
                token: d.token, name: d.name, category: catName, subcategory: subName,
                parentFolderToken: sub.token, depth: 2,
            });
        }
        for (const [innerName, inner] of Object.entries(sub.subfolders || {})) {
            allFolders.push({ name: innerName, token: inner.token, path: `/${catName}/${subName}/${innerName}` });
            for (const d of inner.docs || []) {
                allDocs.push({
                    token: d.token, name: d.name, category: catName, subcategory: subName,
                    innerCategory: innerName, parentFolderToken: inner.token, depth: 3,
                });
            }
        }
    }
    for (const stray of cat.strayDocs || []) {
        allDocs.push({
            token: stray.token, name: stray.name, category: catName, subcategory: '(top-level)',
            parentFolderToken: cat.token, depth: 1,
        });
    }
}

// 2. Build doc-token → record index, classify records
//    A record is a "VirtualNode" if its docs link is a /drive/folder/ URL (or its
//    Type field says VirtualNode). Otherwise it's a docx-pointing record.
function extractDocToken(link) {
    if (!link) return null;
    const m1 = link.match(/\/docx\/([A-Za-z0-9]+)/);
    if (m1) return { kind: 'docx', token: m1[1] };
    const m2 = link.match(/\/drive\/folder\/([A-Za-z0-9]+)/);
    if (m2) return { kind: 'folder', token: m2[1] };
    return { kind: 'unknown', token: link };
}

const docTokenIndex = new Map(allDocs.map(d => [d.token, d]));
const folderTokenIndex = new Map(allFolders.map(f => [f.token, f]));

const recDocxRecords    = [];                                                    // records pointing to a docx
const recVirtualRecords = [];                                                    // records pointing to a folder
const recBrokenRecords  = [];                                                    // records pointing to nothing we know about
const recNoLinkRecords  = [];                                                    // records with no link at all

for (const r of records) {
    const link = r.fields.docs;
    if (!link) {
        recNoLinkRecords.push(r);
        continue;
    }
    const x = extractDocToken(link);
    if (x.kind === 'docx') {
        const matched = docTokenIndex.get(x.token);
        if (matched) {
            recDocxRecords.push({ ...r, _doc: matched });
        } else {
            recBrokenRecords.push({ ...r, _link: link, _reason: 'docx token not in folder' });
        }
    } else if (x.kind === 'folder') {
        const matched = folderTokenIndex.get(x.token);
        if (matched) {
            recVirtualRecords.push({ ...r, _folder: matched });
        } else {
            recBrokenRecords.push({ ...r, _link: link, _reason: 'folder token not in tree' });
        }
    } else {
        recBrokenRecords.push({ ...r, _link: link, _reason: 'unrecognized link format' });
    }
}

// 3. Orphans: docs in folder with no record
const linkedDocTokens = new Set(recDocxRecords.map(r => r._doc.token));
const orphanDocs = allDocs.filter(d => !linkedDocTokens.has(d.token));

// 4. Group docs by full path for migration planning
const byPath = {};
for (const d of allDocs) {
    const p = d.depth === 3
            ? `/${d.category}/${d.subcategory}/${d.innerCategory}`
            : `/${d.category}/${d.subcategory}`;
    (byPath[p] ??= []).push(d);
}

// 5. Print + write manifest
const manifest = {
    generatedAt: new Date().toISOString(),
    sourceFolder: folder.root,
    stats: {
        totalFolders: allFolders.length,
        totalDocs: allDocs.length,
        totalRecords: records.length,
        recDocxRecords: recDocxRecords.length,
        recVirtualRecords: recVirtualRecords.length,
        recBrokenRecords: recBrokenRecords.length,
        recNoLinkRecords: recNoLinkRecords.length,
        orphanDocs: orphanDocs.length,
    },
    folders: allFolders,
    docsByPath: byPath,
    recordsByDocToken: Object.fromEntries(recDocxRecords.map(r => [r._doc.token, {
        recordId: r.recordId, title: r.fields.title, type: r.fields.type, parent: r.fields.parent,
        addedSince: r.fields.addedSince, deprecateSince: r.rawFields['Deprecate Since'],
        progress: r.fields.progress, tag: r.fields.tag, targets: r.fields.targets,
        description: r.fields.description, docName: r._doc.name, category: r._doc.category, subcategory: r._doc.subcategory,
    }])),
    virtualNodeRecords: recVirtualRecords.map(r => ({
        recordId: r.recordId, title: r.fields.title, type: r.fields.type,
        folderName: r._folder.name, folderPath: r._folder.path, folderToken: r._folder.token,
    })),
    brokenRecords: recBrokenRecords.map(r => ({
        recordId: r.recordId, title: r.fields.title, type: r.fields.type, link: r._link, reason: r._reason,
    })),
    noLinkRecords: recNoLinkRecords.map(r => ({
        recordId: r.recordId, title: r.fields.title, type: r.fields.type,
    })),
    orphanDocs,
};

console.log('=== STATS ===');
for (const [k, v] of Object.entries(manifest.stats)) console.log(`  ${k}: ${v}`);

console.log('\n=== FOLDERS (full tree) ===');
for (const f of allFolders) console.log(`  ${f.path}  [${f.token}]`);

console.log('\n=== DOCS BY PATH ===');
for (const [p, docs] of Object.entries(byPath)) {
    console.log(`  ${p}  (${docs.length} docs)`);
    for (const d of docs) console.log(`    - ${d.name}  [${d.token}]`);
}

console.log('\n=== VIRTUAL NODE RECORDS (folder pointers) ===');
for (const r of recVirtualRecords) {
    console.log(`  ${r.fields.title}  -> ${r._folder.path}  [rec=${r.recordId}]`);
}

console.log('\n=== BROKEN RECORDS ===');
for (const r of recBrokenRecords) {
    console.log(`  ${r.fields.title}  reason=${r._reason}  link=${r._link?.slice(0, 80)}`);
}

console.log('\n=== NO-LINK RECORDS ===');
for (const r of recNoLinkRecords) {
    console.log(`  ${r.fields.title}  type=${JSON.stringify(r.fields.type)?.slice(0, 60)}`);
}

console.log('\n=== ORPHAN DOCS (in folder but no record) ===');
for (const d of orphanDocs) {
    const p = d.depth === 3 ? `/${d.category}/${d.subcategory}/${d.innerCategory}` : `/${d.category}/${d.subcategory}`;
    console.log(`  ${d.name}  ${p}  [${d.token}]`);
}

const outPath = '/tmp/v01x-manifest.json';
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
console.log(`\nManifest written to ${outPath}`);

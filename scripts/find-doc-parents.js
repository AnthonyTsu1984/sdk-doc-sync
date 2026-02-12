#!/usr/bin/env node
/**
 * Find the parent folder for each of the 6 Feishu documents.
 * Uses the Drive API batch_query endpoint to get metadata including parent tokens,
 * then resolves parent folder names.
 */

const fetch = require('node-fetch');
const path = require('path');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';

const DOCS = {
    drop_collection:          'QNB4d2q2ZorIApxpnzqczW2HnL7',
    rename_collection:        'IeiIdJ71Pox2OjxMiOzczUTenud',
    drop_partition:           'EMI8dM8uooIAFPxVfffcoqRwnZf',
    drop_role:                'Vmxpd3MttodOE3x3V11cVTeunDh',
    drop_database_properties: 'UPVjdLtz1ogFeKxP45wcqyKincc',
    transfer_replica:         'ZDV3dsgcqoyclVxMTWDcnexmnmg',
};

const tokenFetcher = new larkTokenFetcher();

/**
 * Batch query document metadata via Drive API
 */
async function batchQueryMeta(docTokens) {
    const token = await tokenFetcher.token();
    const url = `${FEISHU_HOST}/open-apis/drive/v1/metas/batch_query`;

    const request_docs = docTokens.map(t => ({
        docs_token: t,
        docs_type: 'docx',
    }));

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ request_docs }),
    });

    const data = await res.json();
    if (data.code !== 0) {
        throw new Error(`batch_query failed: code=${data.code}, msg=${data.msg}`);
    }

    return data.data?.metas || [];
}

/**
 * Get folder metadata (name) for a folder token
 */
async function getFolderMeta(folderToken) {
    const token = await tokenFetcher.token();
    const url = `${FEISHU_HOST}/open-apis/drive/v1/metas/batch_query`;

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
            request_docs: [{
                docs_token: folderToken,
                docs_type: 'folder',
            }],
        }),
    });

    const data = await res.json();
    if (data.code !== 0) {
        console.error(`  Warning: folder meta query failed for ${folderToken}: code=${data.code}, msg=${data.msg}`);
        return null;
    }

    const metas = data.data?.metas || [];
    return metas.length > 0 ? metas[0] : null;
}

/**
 * List contents of a folder to find a doc by token
 */
async function listFolder(folderToken) {
    const token = await tokenFetcher.token();
    const url = `${FEISHU_HOST}/open-apis/drive/v1/files?folder_token=${folderToken}&page_size=200`;
    const res = await fetch(url, {
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${token}`,
        },
    });
    const data = await res.json();
    if (data.code !== 0) {
        console.error(`  Warning: list folder failed for ${folderToken}: code=${data.code}, msg=${data.msg}`);
        return [];
    }
    return data.data?.files || [];
}

async function run() {
    console.log('Fetching Feishu access token...');
    await tokenFetcher.fetchToken();

    const docNames = Object.keys(DOCS);
    const docTokens = Object.values(DOCS);

    // Step 1: Batch query all 6 documents to get their metadata
    console.log('\n--- Step 1: Batch query document metadata ---');
    const metas = await batchQueryMeta(docTokens);

    console.log(`Got metadata for ${metas.length} documents.\n`);

    // Build a map: docToken -> meta
    const metaByToken = {};
    for (const meta of metas) {
        metaByToken[meta.docs_token] = meta;
    }

    // Collect unique parent folder tokens
    const parentTokens = new Set();
    for (const docToken of docTokens) {
        const meta = metaByToken[docToken];
        if (meta) {
            // The owner_id field may contain the parent, but let's check all available fields
            if (meta.owner_id) parentTokens.add(meta.owner_id);
        }
    }

    // Step 2: For each doc, try to find its parent folder using the document's properties
    console.log('--- Step 2: Document details ---\n');

    // Collect all unique parent folder tokens from the metas to resolve names
    const folderTokenCache = {};

    for (const name of docNames) {
        const docToken = DOCS[name];
        const meta = metaByToken[docToken];

        console.log(`Document: ${name}`);
        console.log(`  Token: ${docToken}`);

        if (meta) {
            console.log(`  Title: ${meta.title}`);
            console.log(`  Type: ${meta.docs_type}`);
            console.log(`  Owner ID: ${meta.owner_id || 'N/A'}`);

            // Print all available meta fields for debugging
            const fields = Object.keys(meta).filter(k => !['docs_token'].includes(k));
            for (const field of fields) {
                if (!['title', 'docs_type', 'owner_id'].includes(field)) {
                    console.log(`  ${field}: ${JSON.stringify(meta[field])}`);
                }
            }
        } else {
            console.log('  (no metadata returned)');
        }
        console.log();
    }

    // Step 3: Try the explorer/v2 folder meta approach to get parent info
    // The Drive API v1 metas may not have parent folder info directly.
    // Let's try getting each doc's info via the docx API which may have parent info.
    console.log('--- Step 3: Query via docx document API for parent info ---\n');

    for (const name of docNames) {
        const docToken = DOCS[name];
        const token = await tokenFetcher.token();

        // Try the docx v1 document endpoint - it returns the document with folder info
        const url = `${FEISHU_HOST}/open-apis/docx/v1/documents/${docToken}`;
        const res = await fetch(url, {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Bearer ${token}`,
            },
        });

        const data = await res.json();

        if (data.code === 0 && data.data?.document) {
            const doc = data.data.document;
            console.log(`Document: ${name}`);
            console.log(`  Title: ${doc.title}`);
            console.log(`  Document ID: ${doc.document_id}`);

            // Print all document-level fields
            for (const [key, value] of Object.entries(doc)) {
                if (!['title', 'document_id'].includes(key)) {
                    console.log(`  ${key}: ${JSON.stringify(value)}`);
                }
            }
            console.log();
        } else {
            console.log(`Document: ${name} - failed to fetch: code=${data.code}, msg=${data.msg}\n`);
        }
    }

    // Step 4: Use the wiki get_node API in case these are wiki docs
    console.log('--- Step 4: Try wiki get_node API ---\n');

    for (const name of docNames) {
        const docToken = DOCS[name];
        const token = await tokenFetcher.token();

        const url = `${FEISHU_HOST}/open-apis/wiki/v2/spaces/get_node?token=${docToken}`;
        const res = await fetch(url, {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Bearer ${token}`,
            },
        });

        const data = await res.json();

        if (data.code === 0 && data.data?.node) {
            const node = data.data.node;
            console.log(`Document: ${name}`);
            console.log(`  Title: ${node.title}`);
            console.log(`  Node token: ${node.node_token}`);
            console.log(`  Parent node token: ${node.parent_node_token}`);
            console.log(`  Space ID: ${node.space_id}`);
            console.log(`  Obj type: ${node.obj_type}`);
            console.log(`  Obj token: ${node.obj_token}`);

            // Resolve parent node name
            if (node.parent_node_token) {
                const parentUrl = `${FEISHU_HOST}/open-apis/wiki/v2/spaces/get_node?token=${node.parent_node_token}`;
                const parentRes = await fetch(parentUrl, {
                    headers: {
                        'Content-Type': 'application/json; charset=utf-8',
                        'Authorization': `Bearer ${token}`,
                    },
                });
                const parentData = await parentRes.json();
                if (parentData.code === 0 && parentData.data?.node) {
                    console.log(`  Parent title: ${parentData.data.node.title}`);
                } else {
                    console.log(`  Parent title: (could not resolve)`);
                }
            }
            console.log();
        } else {
            // Not a wiki doc, or no access
            console.log(`Document: ${name} - not a wiki node (code=${data.code})`);

            // Step 5 fallback: Use drive/explorer API for parent folder
            const explorerUrl = `${FEISHU_HOST}/open-apis/drive/explorer/v2/file/${docToken}`;
            const explorerRes = await fetch(explorerUrl, {
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Authorization': `Bearer ${token}`,
                },
            });
            const explorerData = await explorerRes.json();
            if (explorerData.code === 0) {
                console.log(`  Explorer data: ${JSON.stringify(explorerData.data, null, 2)}`);
            }
            console.log();
        }
    }

    // Step 5: Use the drive/v1/files API with the batch_query parent info
    // The batch_query should have returned a 'parent_token' or similar field.
    // If not, let's try listing known version folders to find which contains these docs.
    console.log('--- Step 5: Search known version folders ---\n');

    // Known version folder structure from existing scripts
    const ROOT_FOLDER = 'ACKGfinsNlQCovdK2v1cPxiqnle';
    console.log(`Listing root folder (${ROOT_FOLDER})...`);

    try {
        const rootFiles = await listFolder(ROOT_FOLDER);
        const versionFolders = rootFiles.filter(f => f.type === 'folder');
        console.log(`Found ${versionFolders.length} version folders:\n`);

        for (const vFolder of versionFolders.sort((a, b) => a.name.localeCompare(b.name))) {
            console.log(`Version: ${vFolder.name} (${vFolder.token})`);

            // List the version folder to find MilvusClient or similar
            const vFiles = await listFolder(vFolder.token);
            const subfolders = vFiles.filter(f => f.type === 'folder');

            for (const sub of subfolders) {
                // List each subfolder's contents
                const subFiles = await listFolder(sub.token);

                for (const category of subFiles.filter(f => f.type === 'folder')) {
                    const categoryFiles = await listFolder(category.token);
                    const matchingDocs = categoryFiles.filter(f =>
                        docTokens.includes(f.token)
                    );

                    if (matchingDocs.length > 0) {
                        for (const doc of matchingDocs) {
                            const docName = docNames[docTokens.indexOf(doc.token)];
                            console.log(`  FOUND: ${docName} (${doc.token}) in ${vFolder.name} > ${sub.name} > ${category.name}`);
                        }
                    }
                }

                // Also check direct children of subfolders
                const directMatches = subFiles.filter(f => docTokens.includes(f.token));
                if (directMatches.length > 0) {
                    for (const doc of directMatches) {
                        const docName = docNames[docTokens.indexOf(doc.token)];
                        console.log(`  FOUND: ${docName} (${doc.token}) in ${vFolder.name} > ${sub.name}`);
                    }
                }
            }

            // Check direct children of version folder too
            const directMatches = vFiles.filter(f => docTokens.includes(f.token));
            if (directMatches.length > 0) {
                for (const doc of directMatches) {
                    const docName = docNames[docTokens.indexOf(doc.token)];
                    console.log(`  FOUND: ${docName} (${doc.token}) in ${vFolder.name}`);
                }
            }

            console.log();
        }
    } catch (err) {
        console.error(`Error searching folders: ${err.message}`);
    }

    console.log('Done.');
}

run().catch(err => { console.error(err); process.exit(1); });

#!/usr/bin/env node
/**
 * Merge specs/openapi-milvus.json and specs/openapi-cloud.json
 * back into specs/openapi.json.
 *
 * Merge rules:
 *   - info:       from milvus file (primary), title reset to original
 *   - tags:       milvus tags first, then cloud tags (deduped by name)
 *   - paths:      milvus paths first, then cloud paths
 *   - components: from milvus file (all schemas/params live there)
 *   - servers:    from milvus file
 *
 * Usage:
 *   node scripts/merge-openapi.js [--dry-run] [--output <path>]
 *
 * Options:
 *   --dry-run          Print stats without writing
 *   --output <path>    Write to a custom path (default: specs/openapi.json)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IN_MILVUS = path.join(ROOT, 'specs', 'openapi-milvus.json');
const IN_CLOUD  = path.join(ROOT, 'specs', 'openapi-cloud.json');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const outputArg = args.find(a => a.startsWith('--output='))?.split('=')[1]
               || (args.indexOf('--output') !== -1 ? args[args.indexOf('--output') + 1] : null);
const OUTPUT = outputArg
    ? path.resolve(outputArg)
    : path.join(ROOT, 'specs', 'openapi.json');

function main() {
    console.log('OpenAPI Merge');
    console.log('=============\n');
    if (DRY_RUN) console.log('  *** DRY RUN ***\n');

    if (!fs.existsSync(IN_MILVUS)) {
        console.error(`Missing: ${IN_MILVUS}`);
        process.exit(1);
    }
    if (!fs.existsSync(IN_CLOUD)) {
        console.error(`Missing: ${IN_CLOUD}`);
        process.exit(1);
    }

    const milvus = JSON.parse(fs.readFileSync(IN_MILVUS, 'utf8'));
    const cloud  = JSON.parse(fs.readFileSync(IN_CLOUD,  'utf8'));

    // Merge tags: milvus first, then cloud (dedup by name)
    const seenTags = new Set();
    const mergedTags = [];
    for (const tag of [...(milvus.tags || []), ...(cloud.tags || [])]) {
        if (!seenTags.has(tag.name)) {
            seenTags.add(tag.name);
            mergedTags.push(tag);
        }
    }

    // Merge paths: milvus first, then cloud
    const mergedPaths = {
        ...(milvus.paths || {}),
        ...(cloud.paths  || {}),
    };

    // Build merged spec
    const merged = {
        openapi:    milvus.openapi,
        info:       { ...milvus.info, title: 'Restful API copy' },
        tags:       mergedTags,
        paths:      mergedPaths,
        components: milvus.components,   // all schemas/params are milvus-only
        servers:    milvus.servers || [],
    };

    const mergedJson = JSON.stringify(merged, null, '\t');

    const milvusPathCount = Object.keys(milvus.paths || {}).length;
    const cloudPathCount  = Object.keys(cloud.paths  || {}).length;
    const totalPathCount  = Object.keys(mergedPaths).length;

    console.log(`Milvus input:  ${IN_MILVUS}`);
    console.log(`  Paths: ${milvusPathCount}, Tags: ${(milvus.tags || []).length}`);
    console.log(`Cloud input:   ${IN_CLOUD}`);
    console.log(`  Paths: ${cloudPathCount}, Tags: ${(cloud.tags || []).length}`);
    console.log(`\nOutput:        ${OUTPUT}`);
    console.log(`  Total paths: ${totalPathCount}, Total tags: ${mergedTags.length}`);
    console.log(`  Size: ~${(mergedJson.length / 1024).toFixed(0)}KB\n`);

    if (!DRY_RUN) {
        fs.writeFileSync(OUTPUT, mergedJson + '\n');
        console.log('Done. Merged file written.');
    } else {
        console.log('Would write merged file.');
    }
}

main();

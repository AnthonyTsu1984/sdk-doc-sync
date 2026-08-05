#!/usr/bin/env node
/**
 * Split specs/openapi.json into two focused files:
 *
 *   specs/openapi-milvus.json  — /v2/vectordb/* and /v1/vector/* paths
 *                                 (Milvus server REST API)
 *   specs/openapi-cloud.json   — everything else
 *                                 (Zilliz Cloud management API)
 *
 * Usage:
 *   node scripts/split-openapi.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'specs', 'openapi.json');
const OUT_MILVUS = path.join(ROOT, 'specs', 'openapi-milvus.json');
const OUT_CLOUD = path.join(ROOT, 'specs', 'openapi-cloud.json');

const DRY_RUN = process.argv.includes('--dry-run');

// Paths starting with these prefixes belong to the Milvus server
const MILVUS_PREFIXES = ['/v2/vectordb/', '/v1/vector/'];

function isMilvusPath(p) {
    return MILVUS_PREFIXES.some(prefix => p.startsWith(prefix));
}

// Collect all tag names referenced by a paths object
function tagsUsed(paths) {
    const used = new Set();
    for (const methods of Object.values(paths)) {
        for (const op of Object.values(methods)) {
            for (const tag of (op.tags || [])) used.add(tag);
        }
    }
    return used;
}

function main() {
    console.log('OpenAPI Split');
    console.log('=============\n');
    if (DRY_RUN) console.log('  *** DRY RUN ***\n');

    const spec = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
    const allPaths = spec.paths || {};
    const allTags  = spec.tags  || [];

    // Partition paths
    const milvusPaths = {};
    const cloudPaths  = {};
    for (const [p, val] of Object.entries(allPaths)) {
        if (isMilvusPath(p)) milvusPaths[p] = val;
        else                  cloudPaths[p]  = val;
    }

    // Filter tag metadata to only those used by each file
    const milvusTagNames = tagsUsed(milvusPaths);
    const cloudTagNames  = tagsUsed(cloudPaths);
    const milvusTags = allTags.filter(t => milvusTagNames.has(t.name));
    const cloudTags  = allTags.filter(t => cloudTagNames.has(t.name));

    // Shared top-level fields
    const base = {
        openapi: spec.openapi,
        info:    spec.info,
        tags:    null,   // set per file
        paths:   null,   // set per file
        servers: spec.servers || [],
    };

    // Milvus file: all components belong here (schemas + params are all milvus-only)
    const milvusSpec = {
        ...base,
        info:       { ...spec.info, title: 'Milvus RESTful API' },
        tags:       milvusTags,
        paths:      milvusPaths,
        components: spec.components,
    };

    // Cloud file: components.securitySchemes only (schemas/params not used here)
    const cloudSpec = {
        ...base,
        info:       { ...spec.info, title: 'Zilliz Cloud RESTful API' },
        tags:       cloudTags,
        paths:      cloudPaths,
        components: {
            securitySchemes: spec.components?.securitySchemes,
        },
    };

    const milvusJson = JSON.stringify(milvusSpec, null, '\t');
    const cloudJson  = JSON.stringify(cloudSpec,  null, '\t');

    console.log(`Source:         ${SOURCE}`);
    console.log(`  Total paths:  ${Object.keys(allPaths).length}`);
    console.log(`  Total tags:   ${allTags.length}\n`);
    console.log(`Milvus output:  ${OUT_MILVUS}`);
    console.log(`  Paths: ${Object.keys(milvusPaths).length}, Tags: ${milvusTags.length}, Components: ${Object.keys(spec.components?.schemas || {}).length} schemas\n`);
    console.log(`Cloud output:   ${OUT_CLOUD}`);
    console.log(`  Paths: ${Object.keys(cloudPaths).length}, Tags: ${cloudTags.length}, Components: securitySchemes only\n`);

    if (!DRY_RUN) {
        fs.writeFileSync(OUT_MILVUS, milvusJson + '\n');
        fs.writeFileSync(OUT_CLOUD,  cloudJson  + '\n');
        console.log('Done. Files written.');
        console.log(`  openapi-milvus.json: ${(milvusJson.length / 1024).toFixed(0)}KB`);
        console.log(`  openapi-cloud.json:  ${(cloudJson.length  / 1024).toFixed(0)}KB`);
    } else {
        console.log(`Would write openapi-milvus.json (~${(milvusJson.length / 1024).toFixed(0)}KB)`);
        console.log(`Would write openapi-cloud.json  (~${(cloudJson.length  / 1024).toFixed(0)}KB)`);
    }
}

main();

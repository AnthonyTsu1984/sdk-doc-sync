#!/usr/bin/env node
/**
 * verify-openapi.js — Compare OpenAPI spec against Go implementation
 *
 * Parses request_v2.go structs and compares JSON tags + binding:"required"
 * against specs/openapi-milvus.json.
 *
 * Usage:
 *   node scripts/verify-openapi.js [--live]
 *
 * Options:
 *   --live   Send test requests to a live Milvus/Zilliz endpoint (uses .env)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT      = path.resolve(__dirname, '..');
const SPEC_PATH = path.join(ROOT, 'specs', 'openapi-milvus.json');
const GO_SRC    = path.join(ROOT, 'repos', 'milvus', 'internal', 'distributed',
                            'proxy', 'httpserver', 'request_v2.go');

const doLive = process.argv.includes('--live');

// ─── Parse Go structs ────────────────────────────────────────────────────────

function parseGoStructs(src) {
    const structs = {};
    const lines = src.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const headerMatch = lines[i].match(/^type\s+(\w+)\s+struct\s*\{/);
        if (!headerMatch) continue;

        const name = headerMatch[1];
        const fields = [];
        let depth = 1;

        for (let j = i + 1; j < lines.length && depth > 0; j++) {
            const line = lines[j];
            // Count braces (outside backtick tags)
            for (const ch of line) {
                if (ch === '{') depth++;
                else if (ch === '}') depth--;
            }
            if (depth <= 0) break;
            // Only parse top-level fields (depth === 1)
            if (depth !== 1) continue;

            const tagMatch = line.match(/json:"(\w+)(?:,omitempty)?"/);
            if (!tagMatch) continue;
            const jsonName = tagMatch[1];
            const nameMatch = line.trim().match(/^(\w+)/);
            if (!nameMatch) continue;
            const goName = nameMatch[1];
            const required = /binding:"required"/.test(line);
            fields.push({ goName, jsonName, required });
        }

        structs[name] = fields;
    }
    return structs;
}

// ─── Map endpoints to Go structs ─────────────────────────────────────────────
// Based on handler_v2.go route registrations

const endpointToStruct = {
    '/v2/vectordb/entities/search':     'SearchReqV2',
    '/v2/vectordb/entities/query':      'QueryReqV2',
    '/v2/vectordb/entities/get':        'CollectionIDReq',
    '/v2/vectordb/entities/delete':     'CollectionFilterReq',
    '/v2/vectordb/entities/insert':     'CollectionDataReq',
    '/v2/vectordb/entities/upsert':     'CollectionDataReq',
    '/v2/vectordb/entities/hybrid_search': 'HybridSearchReq',

    '/v2/vectordb/collections/compact':               'CompactReq',
    '/v2/vectordb/collections/get_compaction_state':   'GetCompactionStateReq',

    '/v2/vectordb/users/create':          'PasswordReq',
    '/v2/vectordb/users/update_password': 'NewPasswordReq',

    '/v2/vectordb/resource_groups/create':   'ResourceGroupReq',
    '/v2/vectordb/resource_groups/drop':     'ResourceGroupReq',
    '/v2/vectordb/resource_groups/describe': 'ResourceGroupReq',
    '/v2/vectordb/resource_groups/alter':    'UpdateResourceGroupReq',

    '/v2/vectordb/roles/create':  'RoleReq',
    '/v2/vectordb/roles/drop':    'RoleReq',
    '/v2/vectordb/roles/describe':'RoleReq',

    '/v2/vectordb/roles/grant_privilege':  'GrantReq',
    '/v2/vectordb/roles/revoke_privilege': 'GrantReq',

    '/v2/vectordb/aliases/drop': 'AliasReq',
};

// ─── Compare ─────────────────────────────────────────────────────────────────

function resolveSpecSchema(spec, apiPath) {
    const entry = spec.paths[apiPath];
    if (!entry || !entry.post || !entry.post.requestBody) return null;
    let schema = entry.post.requestBody.content['application/json'].schema;
    if (schema.$ref) {
        const name = schema.$ref.split('/').pop();
        schema = spec.components.schemas[name];
    }
    return schema;
}

function compare(structs, spec) {
    let issues = 0;
    const ok = [];

    for (const [ep, structName] of Object.entries(endpointToStruct)) {
        const goStruct = structs[structName];
        if (!goStruct) {
            console.log(`[WARN] Go struct ${structName} not found`);
            continue;
        }

        const schema = resolveSpecSchema(spec, ep);
        if (!schema) {
            console.log(`[WARN] Spec path ${ep} not found`);
            continue;
        }

        const specProps = Object.keys(schema.properties || {});
        const specRequired = new Set(schema.required || []);
        const epIssues = [];

        // Check Go fields exist in spec
        for (const f of goStruct) {
            if (f.jsonName === '-') continue;
            if (!specProps.includes(f.jsonName)) {
                epIssues.push(`  MISSING in spec: ${f.jsonName}${f.required ? ' (REQUIRED)' : ''}`);
            } else if (f.required && !specRequired.has(f.jsonName)) {
                epIssues.push(`  REQUIRED mismatch: ${f.jsonName} is required in Go but not in spec`);
            } else if (!f.required && specRequired.has(f.jsonName)) {
                epIssues.push(`  REQUIRED mismatch: ${f.jsonName} is required in spec but not in Go`);
            }
        }

        // Check for spec fields not in Go (extras are OK for documentation but worth noting)
        const goFields = new Set(goStruct.map(f => f.jsonName));
        // Known acceptable differences: dbName (header fallback), ids (search alt input)
        const allowedExtras = new Set(['dbName', 'ids']);
        for (const sp of specProps) {
            if (!goFields.has(sp) && !allowedExtras.has(sp)) {
                epIssues.push(`  EXTRA in spec: ${sp} (not in Go struct)`);
            }
        }

        if (epIssues.length > 0) {
            console.log(`\n[ISSUES] ${ep} (${structName}):`);
            epIssues.forEach(i => console.log(i));
            issues += epIssues.length;
        } else {
            ok.push(ep);
        }
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`OK: ${ok.length} endpoints, Issues: ${issues}`);
    if (ok.length > 0) {
        console.log('\nPassing endpoints:');
        ok.forEach(e => console.log(`  ✓ ${e}`));
    }
    return issues;
}

// ─── Live verification ───────────────────────────────────────────────────────

async function liveVerify(spec) {
    require('dotenv').config({ path: path.join(ROOT, '.env') });

    const endpoint = process.env.ZILLIZ_CLUSTER_ENDPOINT || process.env.MILVUS_ENDPOINT;
    const apiKey = process.env.ZILLIZ_API_KEY;
    const credential = process.env.ZILLIZ_CLUSTER_CREDENTIAL || process.env.MILVUS_CREDENTIAL;

    if (!endpoint) {
        console.log('\n[SKIP] No endpoint configured in .env');
        return;
    }

    const fetch = require('node-fetch');
    const baseUrl = endpoint.replace(/\/$/, '');

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    } else if (credential) {
        headers['Authorization'] = `Bearer ${credential}`;
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`Live verification against: ${baseUrl}`);

    // Test cases: each sends a minimal request and checks the server accepts
    // the field (doesn't return "unknown field" errors)
    const tests = [
        {
            name: 'search accepts data (required) without annsField',
            path: '/v2/vectordb/entities/search',
            body: { collectionName: '_verify_test_', data: [[0.1, 0.2]] },
            // We expect collection-not-found, NOT a field validation error
            expectNotFieldError: true,
        },
        {
            name: 'query accepts exprParams',
            path: '/v2/vectordb/entities/query',
            body: { collectionName: '_verify_test_', filter: 'id > 0', exprParams: { val: 1 } },
            expectNotFieldError: true,
        },
        {
            name: 'query works without filter (not required)',
            path: '/v2/vectordb/entities/query',
            body: { collectionName: '_verify_test_', limit: 1 },
            expectNotFieldError: true,
        },
        {
            name: 'insert accepts partialUpdate',
            path: '/v2/vectordb/entities/insert',
            body: { collectionName: '_verify_test_', data: [{ id: 1 }], partialUpdate: true },
            expectNotFieldError: true,
        },
        {
            name: 'delete accepts exprParams',
            path: '/v2/vectordb/entities/delete',
            body: { collectionName: '_verify_test_', filter: 'id > 0', exprParams: {} },
            expectNotFieldError: true,
        },
        {
            name: 'compact accepts boolean isClustering',
            path: '/v2/vectordb/collections/compact',
            body: { collectionName: '_verify_test_', isClustering: true },
            expectNotFieldError: true,
        },
    ];

    for (const t of tests) {
        try {
            const url = `${baseUrl}${t.path}`;
            const resp = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(t.body),
            });
            const json = await resp.json();
            const code = json.code || 0;
            const msg = (json.message || '').toLowerCase();

            // Field validation errors typically say "unknown field" or "cannot unmarshal"
            const isFieldError = msg.includes('unknown field') ||
                                 msg.includes('cannot unmarshal') ||
                                 msg.includes('invalid character');

            if (isFieldError) {
                console.log(`  ✗ ${t.name}`);
                console.log(`    Response: code=${code} msg=${json.message}`);
            } else {
                console.log(`  ✓ ${t.name} (code=${code})`);
            }
        } catch (err) {
            console.log(`  ? ${t.name}: ${err.message}`);
        }
    }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    console.log('Parsing Go structs from request_v2.go...');
    const goSrc = fs.readFileSync(GO_SRC, 'utf8');
    const structs = parseGoStructs(goSrc);
    console.log(`Found ${Object.keys(structs).length} structs`);

    console.log('\nLoading OpenAPI spec...');
    const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));

    const issues = compare(structs, spec);

    if (doLive) {
        await liveVerify(spec);
    }

    process.exit(issues > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });

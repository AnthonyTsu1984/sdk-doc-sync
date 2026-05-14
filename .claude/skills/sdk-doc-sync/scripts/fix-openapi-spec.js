#!/usr/bin/env node
/**
 * fix-openapi-spec.js — Batch fix OpenAPI spec to match Go implementation
 *
 * Source of truth: repos/milvus/.../httpserver/request_v2.go
 * Target: specs/openapi-milvus.json
 *
 * Usage:
 *   node scripts/fix-openapi-spec.js [--dry-run]
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT      = path.resolve(__dirname, '..');
const SPEC_PATH = path.join(ROOT, 'specs', 'openapi-milvus.json');
const MERGE     = path.join(ROOT, 'scripts', 'merge-openapi.js');

const dryRun = process.argv.includes('--dry-run');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getSchema(spec, apiPath) {
    const entry = spec.paths[apiPath];
    if (!entry || !entry.post || !entry.post.requestBody) {
        console.error(`  [SKIP] No requestBody for ${apiPath}`);
        return null;
    }
    return entry.post.requestBody.content['application/json'].schema;
}

function setRequired(schema, fields) {
    const old = schema.required || [];
    schema.required = fields;
    return `required: [${old}] → [${fields}]`;
}

function addProp(schema, name, def) {
    if (!schema.properties) schema.properties = {};
    if (schema.properties[name]) {
        return `  [EXISTS] ${name}`;
    }
    schema.properties[name] = def;
    return `  + ${name} (${def.type || 'object'})`;
}

function removeProp(schema, name) {
    if (!schema.properties || !schema.properties[name]) {
        return `  [MISSING] ${name}`;
    }
    delete schema.properties[name];
    if (schema.required) {
        const idx = schema.required.indexOf(name);
        if (idx !== -1) schema.required.splice(idx, 1);
    }
    return `  - ${name}`;
}

function fixType(schema, name, newType) {
    if (!schema.properties || !schema.properties[name]) {
        return `  [MISSING] ${name}`;
    }
    const old = schema.properties[name].type;
    schema.properties[name].type = newType;
    return `  ${name}: ${old} → ${newType}`;
}

const log = [];
function section(title) { log.push(`\n=== ${title} ===`); console.log(`\n=== ${title} ===`); }
function note(msg) { log.push(msg); console.log(msg); }

// ─── Main ────────────────────────────────────────────────────────────────────

const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));

// ─── Phase 1: Critical — Wrong Required Markers & Missing Core Params ────────

section('Phase 1a: Fix search required (annsField→data)');
{
    const s = getSchema(spec, '/v2/vectordb/entities/search');
    if (s) {
        note(setRequired(s, ['collectionName', 'data']));
    }
}

section('Phase 1b: Fix query — filter not required, add missing params');
{
    const s = getSchema(spec, '/v2/vectordb/entities/query');
    if (s) {
        note(setRequired(s, ['collectionName']));
        note(addProp(s, 'exprParams', {
            type: 'object',
            description: 'Expression template parameter values for parameterized filter expressions.',
        }));
        note(addProp(s, 'consistencyLevel', {
            type: 'string',
            description: 'Consistency level. Possible values are **Strong**, **Session**, **Bounded**, and **Eventually**.',
            enum: ['Strong', 'Session', 'Bounded', 'Eventually'],
        }));
    }
}

section('Phase 1c: Fix hybrid_search — add missing top-level params');
{
    const s = getSchema(spec, '/v2/vectordb/entities/hybrid_search');
    if (s) {
        note(addProp(s, 'offset', {
            type: 'integer',
            description: 'Number of records to skip in the search results.',
        }));
        note(addProp(s, 'groupingField', {
            type: 'string',
            description: 'Name of the field to group search results by.',
        }));
    }
}

section('Phase 1d: Fix hybrid_search sub-search — add exprParams');
{
    const s = getSchema(spec, '/v2/vectordb/entities/hybrid_search');
    if (s && s.properties && s.properties.search && s.properties.search.items) {
        const itemSchema = s.properties.search.items;
        note(addProp(itemSchema, 'exprParams', {
            type: 'object',
            description: 'Expression template parameter values for parameterized filter expressions.',
        }));
    }
}

section('Phase 1e: Fix delete — add exprParams');
{
    const s = getSchema(spec, '/v2/vectordb/entities/delete');
    if (s) {
        note(addProp(s, 'exprParams', {
            type: 'object',
            description: 'Expression template parameter values for parameterized filter expressions.',
        }));
    }
}

section('Phase 1f: Fix insert and upsert — add partialUpdate');
{
    for (const ep of ['/v2/vectordb/entities/insert', '/v2/vectordb/entities/upsert']) {
        const s = getSchema(spec, ep);
        if (s) {
            note(`[${ep}]`);
            note(addProp(s, 'partialUpdate', {
                type: 'boolean',
                description: 'Whether to enable partial updates. When enabled, only the specified fields are updated.',
            }));
        }
    }
}

section('Phase 1g: Fix get — add partitionName (singular)');
{
    const s = getSchema(spec, '/v2/vectordb/entities/get');
    if (s) {
        note(addProp(s, 'partitionName', {
            type: 'string',
            description: 'Name of the partition to get entities from.',
        }));
    }
}

section('Phase 1h: Fix compact — isClustering type');
{
    const s = getSchema(spec, '/v2/vectordb/collections/compact');
    if (s) {
        note(fixType(s, 'isClustering', 'boolean'));
    }
}

section('Phase 1i: Fix get_compaction_state — jobID type');
{
    // Go: JobID int64 `json:"jobID"` — JSON number, not string
    const s = getSchema(spec, '/v2/vectordb/collections/get_compaction_state');
    if (s) {
        note(fixType(s, 'jobID', 'integer'));
    }
}

// ─── Phase 2: Important — Missing Required Markers ───────────────────────────

section('Phase 2: Fix missing required markers');

const requiredFixes = [
    ['/v2/vectordb/users/create', ['userName', 'password']],
    ['/v2/vectordb/users/update_password', ['userName', 'password', 'newPassword']],
    ['/v2/vectordb/resource_groups/create', ['name']],  // already correct per agent
    ['/v2/vectordb/resource_groups/drop', ['name']],
    ['/v2/vectordb/resource_groups/describe', ['name']],
    ['/v2/vectordb/resource_groups/alter', ['resource_groups']],
    ['/v2/vectordb/resource_groups/transfer_replica', ['sourceRgName', 'targetRgName', 'collectionName', 'replicaNum']],
];

for (const [ep, required] of requiredFixes) {
    const s = getSchema(spec, ep);
    if (s) {
        note(`[${ep}]`);
        note(setRequired(s, required));
    }
}

// Fix collections/fields/add — uses $ref, need to find the component schema
section('Phase 2: Fix AddCollectionFieldRequest required');
{
    // The path uses a $ref to AddCollectionFieldRequest — resolve it
    const entry = spec.paths['/v2/vectordb/collections/fields/add'];
    if (entry) {
        const bodySchema = entry.post.requestBody.content['application/json'].schema;
        // Could be a $ref or inline
        if (bodySchema.$ref) {
            const refName = bodySchema.$ref.split('/').pop();
            const compSchema = spec.components.schemas[refName];
            if (compSchema) {
                note(`[component: ${refName}]`);
                note(setRequired(compSchema, ['collectionName', 'schema']));
            }
        } else {
            note(setRequired(bodySchema, ['collectionName', 'schema']));
        }
    }
}

section('Phase 2: Fix AlterFieldPropertiesRequest — remove fieldParams from required');
{
    const entry = spec.paths['/v2/vectordb/collections/fields/alter_properties'];
    if (entry) {
        const bodySchema = entry.post.requestBody.content['application/json'].schema;
        if (bodySchema.$ref) {
            const refName = bodySchema.$ref.split('/').pop();
            const compSchema = spec.components.schemas[refName];
            if (compSchema && compSchema.required) {
                const old = [...compSchema.required];
                compSchema.required = compSchema.required.filter(f => f !== 'fieldParams');
                note(`[component: ${refName}]`);
                note(`required: [${old}] → [${compSchema.required}]`);
            }
        } else if (bodySchema.required) {
            bodySchema.required = bodySchema.required.filter(f => f !== 'fieldParams');
        }
    }
}

section('Phase 2: Fix FunctionSchema component required');
{
    const funcSchema = spec.components && spec.components.schemas && spec.components.schemas.FunctionSchema;
    if (funcSchema) {
        note(setRequired(funcSchema, ['name', 'type', 'inputFieldNames', 'outputFieldNames']));
    } else {
        note('[SKIP] FunctionSchema component not found');
    }
}

// ─── Phase 3: Important — Missing dbName on Role/Privilege Endpoints ─────────

section('Phase 3: Add dbName to role/privilege endpoints');

const roleEndpoints = [
    '/v2/vectordb/roles/create',
    '/v2/vectordb/roles/drop',
    '/v2/vectordb/roles/describe',
    '/v2/vectordb/roles/list',
    '/v2/vectordb/roles/grant_privilege',
    '/v2/vectordb/roles/revoke_privilege',
];

for (const ep of roleEndpoints) {
    const s = getSchema(spec, ep);
    if (s) {
        note(`[${ep}]`);
        note(addProp(s, 'dbName', {
            type: 'string',
            description: 'Name of the database. If not specified, the default database is used.',
        }));
    }
}

// ─── Phase 4: Cleanup ────────────────────────────────────────────────────────

section('Phase 4a: advanced_search — mark deprecated');
{
    const entry = spec.paths['/v2/vectordb/entities/advanced_search'];
    if (entry && entry.post) {
        entry.post.deprecated = true;
        if (!entry.post.description) entry.post.description = '';
        if (!entry.post.description.includes('hybrid_search')) {
            entry.post.description = 'Deprecated. Use /v2/vectordb/entities/hybrid_search instead. ' + entry.post.description;
        }
        note('Marked advanced_search as deprecated');
    }
}

section('Phase 4b: aliases/drop — remove extra collectionName');
{
    // Go AliasReq only has dbName + aliasName
    const s = getSchema(spec, '/v2/vectordb/aliases/drop');
    if (s) {
        note(removeProp(s, 'collectionName'));
    }
}

section('Phase 4c: databases/alter vs databases/alter_properties alignment');
{
    // Both map to same handler — check if both exist and align them
    const alter = spec.paths['/v2/vectordb/databases/alter'];
    const alterProps = spec.paths['/v2/vectordb/databases/alter_properties'];
    if (alter && alterProps) {
        note('Both databases/alter and databases/alter_properties exist — verifying alignment');
        // They should reference the same schema or have equivalent schemas
        const s1 = alter.post.requestBody?.content?.['application/json']?.schema;
        const s2 = alterProps.post.requestBody?.content?.['application/json']?.schema;
        if (s1 && s2) {
            if (JSON.stringify(s1) === JSON.stringify(s2)) {
                note('Schemas already match');
            } else {
                note('Schemas differ — making alter reference alter_properties schema');
                // Copy the more complete schema
                if (s2.$ref) {
                    alter.post.requestBody.content['application/json'].schema = { ...s2 };
                } else if (s1.$ref) {
                    alterProps.post.requestBody.content['application/json'].schema = { ...s1 };
                } else {
                    // Both inline — use the one with more properties
                    const p1 = Object.keys(s1.properties || {}).length;
                    const p2 = Object.keys(s2.properties || {}).length;
                    if (p2 > p1) {
                        alter.post.requestBody.content['application/json'].schema = JSON.parse(JSON.stringify(s2));
                        note(`Copied alter_properties schema (${p2} props) → alter`);
                    } else if (p1 > p2) {
                        alterProps.post.requestBody.content['application/json'].schema = JSON.parse(JSON.stringify(s1));
                        note(`Copied alter schema (${p1} props) → alter_properties`);
                    }
                }
            }
        }
    } else {
        note(`[SKIP] alter: ${!!alter}, alter_properties: ${!!alterProps}`);
    }
}

// ─── Write ───────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60));
console.log(`Total changes logged: ${log.length}`);

if (dryRun) {
    console.log('[dry-run] No files written.');
} else {
    const json = JSON.stringify(spec, null, '\t') + '\n';
    fs.writeFileSync(SPEC_PATH, json);
    console.log(`Written: ${SPEC_PATH}`);
    console.log('Running merge-openapi.js...');
    execSync(`node ${MERGE}`, { stdio: 'inherit' });
    console.log('Done.');
}

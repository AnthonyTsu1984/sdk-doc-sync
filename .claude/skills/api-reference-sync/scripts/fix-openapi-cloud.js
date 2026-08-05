#!/usr/bin/env node
/**
 * fix-openapi-cloud.js — Batch fix OpenAPI cloud spec to match Java implementation
 *
 * Source of truth: repos/zilliz-cloud/.../controller/request/*.java
 * Target: specs/openapi-cloud.json
 *
 * Usage:
 *   node scripts/fix-openapi-cloud.js [--dry-run]
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT      = path.resolve(__dirname, '..');
const SPEC_PATH = path.join(ROOT, 'specs', 'openapi-cloud.json');
const MERGE     = path.join(ROOT, 'scripts', 'merge-openapi.js');

const dryRun = process.argv.includes('--dry-run');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Get requestBody schema for a POST/PUT/PATCH path */
function getSchema(spec, apiPath, method = 'post') {
    const entry = spec.paths[apiPath];
    if (!entry || !entry[method] || !entry[method].requestBody) {
        console.error(`  [SKIP] No requestBody for ${method.toUpperCase()} ${apiPath}`);
        return null;
    }
    return entry[method].requestBody.content['application/json'].schema;
}

/** Get parameters array for a GET path */
function getParams(spec, apiPath) {
    const entry = spec.paths[apiPath];
    if (!entry || !entry.get || !entry.get.parameters) {
        console.error(`  [SKIP] No parameters for GET ${apiPath}`);
        return null;
    }
    return entry.get.parameters;
}

function setRequired(schema, fields) {
    const old = schema.required || [];
    schema.required = fields;
    return `required: [${old}] → [${fields}]`;
}

function clearRequired(schema) {
    const old = schema.required || [];
    delete schema.required;
    return `required: [${old}] → (cleared)`;
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

function renameProp(schema, oldName, newName) {
    if (!schema.properties || !schema.properties[oldName]) {
        return `  [MISSING] ${oldName}`;
    }
    schema.properties[newName] = schema.properties[oldName];
    delete schema.properties[oldName];
    // Update required array
    if (schema.required) {
        const idx = schema.required.indexOf(oldName);
        if (idx !== -1) schema.required[idx] = newName;
    }
    return `  ${oldName} → ${newName}`;
}

/** Rename a query parameter in a parameters array */
function renameParam(params, oldName, newName) {
    const param = params.find(p => p.name === oldName && p.in === 'query');
    if (!param) return `  [MISSING] query param ${oldName}`;
    param.name = newName;
    return `  ${oldName} → ${newName}`;
}

/** Fix a query parameter's type */
function fixParamType(params, name, newType) {
    const param = params.find(p => p.name === name && p.in === 'query');
    if (!param) return `  [MISSING] query param ${name}`;
    const old = param.schema ? param.schema.type : '(none)';
    if (!param.schema) param.schema = {};
    param.schema.type = newType;
    return `  ${name}: ${old} → ${newType}`;
}

/** Add a query parameter to a parameters array */
function addParam(params, name, type, description, opts = {}) {
    const existing = params.find(p => p.name === name && p.in === 'query');
    if (existing) return `  [EXISTS] query param ${name}`;
    const param = {
        name,
        in: 'query',
        description,
        required: false,
        schema: { type },
    };
    if (opts['x-i18n']) param['x-i18n'] = opts['x-i18n'];
    // Insert before the last header param (Authorization is usually last)
    const lastHeaderIdx = params.findLastIndex(p => p.in === 'header');
    if (lastHeaderIdx >= 0) {
        params.splice(lastHeaderIdx, 0, param);
    } else {
        params.push(param);
    }
    return `  + ${name} (${type})`;
}

const log = [];
function section(title) { log.push(`\n=== ${title} ===`); console.log(`\n=== ${title} ===`); }
function note(msg) { log.push(msg); console.log(msg); }

// ─── Recursive rename helper for examples/responses ──────────────────────────

/** Deep-rename a key in all nested objects (for fixing example values) */
function deepRenameKey(obj, oldKey, newKey) {
    if (!obj || typeof obj !== 'object') return 0;
    let count = 0;
    if (Array.isArray(obj)) {
        for (const item of obj) count += deepRenameKey(item, oldKey, newKey);
        return count;
    }
    if (oldKey in obj) {
        obj[newKey] = obj[oldKey];
        delete obj[oldKey];
        count++;
    }
    for (const val of Object.values(obj)) {
        count += deepRenameKey(val, oldKey, newKey);
    }
    return count;
}

// ─── Main ────────────────────────────────────────────────────────────────────

const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));

// ─── Phase 1: Critical — Field Name Mismatches ──────────────────────────────

section('Phase 1a: POST /v2/alertRules — rename fields + add missing');
{
    const s = getSchema(spec, '/v2/alertRules');
    if (s) {
        note(renameProp(s, 'comparisonOperator', 'comparisonMethod'));
        note(renameProp(s, 'targetClusterIds', 'targetInstanceIds'));
        note(addProp(s, 'metricUnit', {
            type: 'string',
            description: 'The unit of the metric (e.g., "bytes", "percent").',
            'x-i18n': { 'zh-CN': { description: '指标单位（如 "bytes"、"percent"）。' } },
        }));
        note(addProp(s, 'repeatIntervalSeconds', {
            type: 'integer',
            description: 'The interval in seconds between repeated alert notifications.',
            'x-i18n': { 'zh-CN': { description: '重复告警通知的间隔时间（秒）。' } },
        }));
    }
    // Also fix examples/responses in the entire alertRules POST entry
    const entry = spec.paths['/v2/alertRules'];
    if (entry && entry.post) {
        let c = deepRenameKey(entry.post.responses, 'comparisonOperator', 'comparisonMethod');
        c += deepRenameKey(entry.post.responses, 'targetClusterIds', 'targetInstanceIds');
        c += deepRenameKey(entry.post.requestBody, 'comparisonOperator', 'comparisonMethod');
        // Note: requestBody examples may use comparisonMethod already — only rename comparisonOperator
        if (c) note(`  Fixed ${c} occurrences in examples/responses`);
    }
}

section('Phase 1b: PUT /v2/alertRules/{ALERT_RULE_ID} — rename fields, remove projectId, clear required');
{
    const s = getSchema(spec, '/v2/alertRules/{ALERT_RULE_ID}', 'put');
    if (s) {
        note(renameProp(s, 'comparisonOperator', 'comparisonMethod'));
        note(renameProp(s, 'targetClusterIds', 'targetInstanceIds'));
        note(removeProp(s, 'projectId'));
        note(addProp(s, 'metricUnit', {
            type: 'string',
            description: 'The unit of the metric (e.g., "bytes", "percent").',
            'x-i18n': { 'zh-CN': { description: '指标单位（如 "bytes"、"percent"）。' } },
        }));
        note(addProp(s, 'repeatIntervalSeconds', {
            type: 'integer',
            description: 'The interval in seconds between repeated alert notifications.',
            'x-i18n': { 'zh-CN': { description: '重复告警通知的间隔时间（秒）。' } },
        }));
        if (s.required) {
            note(clearRequired(s));
        } else {
            note('  (no required array to clear)');
        }
    }
    // Fix examples/responses
    const entry = spec.paths['/v2/alertRules/{ALERT_RULE_ID}'];
    if (entry && entry.put) {
        let c = deepRenameKey(entry.put.responses, 'comparisonOperator', 'comparisonMethod');
        c += deepRenameKey(entry.put.responses, 'targetClusterIds', 'targetInstanceIds');
        c += deepRenameKey(entry.put.requestBody, 'comparisonOperator', 'comparisonMethod');
        if (c) note(`  Fixed ${c} occurrences in examples/responses`);
    }
}

// Also fix GET /v2/alertRules response examples and GET /v2/alertRules/{ID} responses
section('Phase 1b-extra: Fix comparisonOperator/targetClusterIds in all alertRules responses');
{
    for (const p of ['/v2/alertRules', '/v2/alertRules/{ALERT_RULE_ID}']) {
        const entry = spec.paths[p];
        if (!entry) continue;
        for (const method of ['get', 'delete']) {
            if (!entry[method]) continue;
            let c = deepRenameKey(entry[method].responses, 'comparisonOperator', 'comparisonMethod');
            c += deepRenameKey(entry[method].responses, 'targetClusterIds', 'targetInstanceIds');
            if (c) note(`  [${method.toUpperCase()} ${p}] Fixed ${c} occurrences in responses`);
        }
    }
    // Also fix response schemas that define comparisonOperator/targetClusterIds as property names
    for (const p of ['/v2/alertRules', '/v2/alertRules/{ALERT_RULE_ID}']) {
        const entry = spec.paths[p];
        if (!entry) continue;
        for (const method of Object.keys(entry)) {
            if (method === 'parameters') continue;
            const op = entry[method];
            if (!op || !op.responses) continue;
            // Traverse response schemas to rename property definitions
            for (const resp of Object.values(op.responses)) {
                if (!resp.content) continue;
                for (const ct of Object.values(resp.content)) {
                    if (!ct.schema) continue;
                    renameInSchema(ct.schema, 'comparisonOperator', 'comparisonMethod');
                    renameInSchema(ct.schema, 'targetClusterIds', 'targetInstanceIds');
                }
            }
        }
    }
}

/** Recursively rename a property key in schema definitions */
function renameInSchema(schema, oldKey, newKey) {
    if (!schema || typeof schema !== 'object') return;
    if (Array.isArray(schema)) {
        for (const item of schema) renameInSchema(item, oldKey, newKey);
        return;
    }
    // Rename in properties
    if (schema.properties && schema.properties[oldKey]) {
        schema.properties[newKey] = schema.properties[oldKey];
        delete schema.properties[oldKey];
    }
    // Recurse into all sub-schemas
    for (const key of ['properties', 'items', 'allOf', 'oneOf', 'anyOf', 'additionalProperties']) {
        if (schema[key]) renameInSchema(schema[key], oldKey, newKey);
    }
    // Recurse into property values
    if (schema.properties) {
        for (const prop of Object.values(schema.properties)) {
            renameInSchema(prop, oldKey, newKey);
        }
    }
}

section('Phase 1c: GET /v2/backups — rename startTime→start, endTime→end');
{
    const params = getParams(spec, '/v2/backups');
    if (params) {
        note(renameParam(params, 'startTime', 'start'));
        note(renameParam(params, 'endTime', 'end'));
    }
}

section('Phase 1d: GET /v1/clusters — rename current→currentPage');
{
    const params = getParams(spec, '/v1/clusters');
    if (params) {
        note(renameParam(params, 'current', 'currentPage'));
    }
}

// ─── Phase 2: Missing Required Markers ───────────────────────────────────────

section('Phase 2a: POST /v2/projects — add required [projectName, plan]');
{
    const s = getSchema(spec, '/v2/projects');
    if (s) {
        note(setRequired(s, ['projectName', 'plan']));
    }
}

section('Phase 2b: PATCH /v2/projects/{projectId} — add required [plan]');
{
    const s = getSchema(spec, '/v2/projects/{projectId}', 'patch');
    if (s) {
        note(setRequired(s, ['plan']));
    }
}

// ─── Phase 3: Missing Fields ─────────────────────────────────────────────────

section('Phase 3a: GET /v2/clusters — add regionId query param');
{
    const params = getParams(spec, '/v2/clusters');
    if (params) {
        note(addParam(params, 'regionId', 'string',
            'The ID of the cloud region. If specified, only clusters in that region are returned.',
            { 'x-i18n': { 'zh-CN': { description: '云区域 ID。若指定，则仅返回该区域内的集群。' } } }
        ));
    }
}

section('Phase 3b: POST /v2/clusters/createDedicated — add BYOC fields');
{
    const s = getSchema(spec, '/v2/clusters/createDedicated');
    if (s) {
        note(addProp(s, 'labels', {
            type: 'object',
            description: 'Key-value labels for BYOC cluster identification.',
            'x-i18n': { 'zh-CN': { description: 'BYOC 集群标识键值对标签。' } },
            additionalProperties: { type: 'string' },
        }));
        note(addProp(s, 'bucketInfo', {
            type: 'object',
            description: 'Custom bucket configuration for BYOC clusters.',
            'x-i18n': { 'zh-CN': { description: 'BYOC 集群的自定义存储桶配置。' } },
            properties: {
                bucketName: {
                    type: 'string',
                    description: 'The name of the custom storage bucket.',
                },
                prefix: {
                    type: 'string',
                    description: 'The prefix path within the bucket.',
                },
            },
        }));
        note(addProp(s, 'keyIdentifier', {
            type: 'string',
            description: 'The key identifier for encryption in BYOC clusters.',
            'x-i18n': { 'zh-CN': { description: 'BYOC 集群加密的密钥标识符。' } },
        }));
    }
}

// ─── Phase 4: Type Fixes ─────────────────────────────────────────────────────

section('Phase 4a: GET /v2/backups — fix pageSize and currentPage types to integer');
{
    const params = getParams(spec, '/v2/backups');
    if (params) {
        note(fixParamType(params, 'pageSize', 'integer'));
        note(fixParamType(params, 'currentPage', 'integer'));
    }
}

section('Phase 4b: GET /v2/alertRules — verify param types');
{
    const params = getParams(spec, '/v2/alertRules');
    if (params) {
        // pageSize and currentPage should be integer (already correct per spec)
        const ps = params.find(p => p.name === 'pageSize');
        const cp = params.find(p => p.name === 'currentPage');
        if (ps && ps.schema && ps.schema.type === 'integer') {
            note('  pageSize: already integer ✓');
        } else if (ps) {
            note(fixParamType(params, 'pageSize', 'integer'));
        }
        if (cp && cp.schema && cp.schema.type === 'integer') {
            note('  currentPage: already integer ✓');
        } else if (cp) {
            note(fixParamType(params, 'currentPage', 'integer'));
        }
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

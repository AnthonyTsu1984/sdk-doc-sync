#!/usr/bin/env node
/**
 * verify-openapi-cloud.js — Verify OpenAPI cloud spec against Java implementation
 *
 * Parses Java request DTOs and compares field names, types, and validation
 * annotations against specs/openapi-cloud.json.
 *
 * Usage:
 *   node scripts/verify-openapi-cloud.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT      = path.resolve(__dirname, '..');
const SPEC_PATH = path.join(ROOT, 'specs', 'openapi-cloud.json');
const JAVA_DIR  = path.join(ROOT,
    'repos/zilliz-cloud/vdc/global/cloud-control-api/src/main/java/com/zilliz/cloud/control/api/controller/request');

// ─── Java DTO parser ─────────────────────────────────────────────────────────

/** Minimal Java DTO field parser — extracts field names, types, and annotations */
function parseJavaDTO(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const src = fs.readFileSync(filePath, 'utf8');
    const fields = [];

    // Match field declarations: annotations* [access] [final] type name (= default)?;
    const fieldRe = /(?:(@\w+(?:\([^)]*\))?[\s\n]*)*)\s+(?:private\s+|protected\s+|public\s+)?(?:final\s+)?(\w[\w<>,\s]*?)\s+(\w+)\s*(?:=\s*[^;]+)?;/g;
    let m;
    while ((m = fieldRe.exec(src)) !== null) {
        const annotations = m[1] || '';
        const type = m[2].trim();
        const name = m[3].trim();
        // Skip static/final/class-level
        if (['serialVersionUID', 'class', 'interface'].includes(name)) continue;
        if (type === 'class' || type === 'interface') continue;

        const required = /(@NotBlank|@NotNull|@NotEmpty)/.test(annotations);
        const javaType = type
            .replace(/\s+/g, '')
            .replace(/List<(.+)>/, 'array:$1')
            .replace(/Map<(.+)>/, 'object');

        fields.push({ name, javaType, type, required, annotations: annotations.trim() });
    }
    return { file: path.basename(filePath), fields };
}

/** Map Java type to OpenAPI type */
function javaToOpenApiType(javaType) {
    const normalized = javaType.replace(/\s+/g, '');
    if (/^(Integer|Long|int|long)$/.test(normalized)) return 'integer';
    if (/^(Float|Double|float|double|BigDecimal)$/.test(normalized)) return 'number';
    if (/^(Boolean|boolean)$/.test(normalized)) return 'boolean';
    if (/^String$/.test(normalized)) return 'string';
    if (/^List\b/.test(normalized) || /^array:/.test(normalized)) return 'array';
    if (/^Map\b/.test(normalized)) return 'object';
    return 'object'; // complex types
}

// ─── Spec helpers ────────────────────────────────────────────────────────────

function getRequestBodySchema(spec, apiPath, method = 'post') {
    const entry = spec.paths[apiPath];
    if (!entry || !entry[method]) return null;
    const rb = entry[method].requestBody;
    if (!rb || !rb.content) return null;
    return rb.content['application/json']?.schema || null;
}

function getQueryParams(spec, apiPath) {
    const entry = spec.paths[apiPath];
    if (!entry || !entry.get) return null;
    return (entry.get.parameters || []).filter(p => p.in === 'query');
}

// ─── Endpoint-DTO mapping ────────────────────────────────────────────────────

const ENDPOINT_MAP = [
    // [method, path, dtoFileName, schemaType]
    ['post', '/v2/alertRules', 'CreateAlertRuleRequest.java', 'body'],
    ['put',  '/v2/alertRules/{ALERT_RULE_ID}', 'UpdateAlertRuleRequest.java', 'body'],
    ['get',  '/v2/alertRules', 'ListAlertRulesRequest.java', 'query'],
    ['get',  '/v2/backups', 'ListBackupRequest.java', 'query'],
    ['get',  '/v1/clusters', 'ListClusterRequest.java', 'query'],
    ['get',  '/v2/clusters', 'ListClusterRequest.java', 'query'],
    ['post', '/v2/projects', 'CreateProjectRequest.java', 'body'],
    ['patch', '/v2/projects/{projectId}', 'UpdateProjectPlanRequest.java', 'body'],
    ['post', '/v2/clusters/createDedicated', 'CreateDedicatedClusterRequest.java', 'body'],
];

// ─── Main ────────────────────────────────────────────────────────────────────

const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));

let issues = 0;
let checked = 0;

for (const [method, apiPath, dtoFile, schemaType] of ENDPOINT_MAP) {
    const dto = parseJavaDTO(path.join(JAVA_DIR, dtoFile));
    if (!dto) {
        console.log(`\n⚠  ${method.toUpperCase()} ${apiPath} — DTO not found: ${dtoFile}`);
        issues++;
        continue;
    }

    console.log(`\n── ${method.toUpperCase()} ${apiPath} ← ${dtoFile} ──`);

    if (schemaType === 'body') {
        const schema = getRequestBodySchema(spec, apiPath, method);
        if (!schema) {
            console.log('  ⚠  No requestBody schema in spec');
            issues++;
            continue;
        }

        const specProps = schema.properties || {};
        const specRequired = new Set(schema.required || []);

        for (const field of dto.fields) {
            checked++;
            const prop = specProps[field.name];
            if (!prop) {
                console.log(`  ✗  MISSING field: ${field.name} (${field.type})`);
                issues++;
                continue;
            }

            const expectedType = javaToOpenApiType(field.javaType);
            if (prop.type && prop.type !== expectedType) {
                console.log(`  ✗  TYPE mismatch: ${field.name} — spec: ${prop.type}, java: ${expectedType} (${field.type})`);
                issues++;
            }

            if (field.required && !specRequired.has(field.name)) {
                console.log(`  ✗  REQUIRED missing: ${field.name} (@NotBlank/@NotNull in Java)`);
                issues++;
            }
        }

        // Check for extra spec fields not in Java DTO
        for (const specField of Object.keys(specProps)) {
            if (!dto.fields.find(f => f.name === specField)) {
                console.log(`  ?  EXTRA in spec: ${specField} (not in Java DTO — may be inherited or path param)`);
            }
        }

        console.log(`  ✓  ${dto.fields.length} Java fields checked`);

    } else if (schemaType === 'query') {
        const queryParams = getQueryParams(spec, apiPath);
        if (!queryParams) {
            console.log('  ⚠  No query parameters in spec');
            issues++;
            continue;
        }

        const specParamMap = new Map(queryParams.map(p => [p.name, p]));

        for (const field of dto.fields) {
            checked++;
            const param = specParamMap.get(field.name);
            if (!param) {
                console.log(`  ✗  MISSING query param: ${field.name} (${field.type})`);
                issues++;
                continue;
            }

            const expectedType = javaToOpenApiType(field.javaType);
            if (param.schema && param.schema.type && param.schema.type !== expectedType) {
                console.log(`  ✗  TYPE mismatch: ${field.name} — spec: ${param.schema.type}, java: ${expectedType} (${field.type})`);
                issues++;
            }
        }

        console.log(`  ✓  ${dto.fields.length} Java fields checked`);
    }
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60));
console.log(`Checked: ${checked} fields across ${ENDPOINT_MAP.length} endpoints`);
if (issues > 0) {
    console.log(`Issues: ${issues}`);
    process.exit(1);
} else {
    console.log('All checks passed ✓');
}

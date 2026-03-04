#!/usr/bin/env node
/**
 * OpenAPI Spec Editor CLI
 *
 * Usage:
 *   node scripts/edit-openapi.js <subcommand> [options]
 *
 * Global options:
 *   --spec <path>    Target spec file (default: specs/openapi-milvus.json)
 *   --dry-run        Print changes without writing
 *   --no-merge       Skip regenerating openapi.json after edits
 *   --help, -h       Print usage
 *
 * Subcommands (read-only):
 *   list-paths  [--tag <name>] [--grep <pattern>]
 *   show-path   <path>
 *   list-tags
 *   show-schema <name>
 *
 * Subcommands (path-level edits):
 *   add-path    --path <path> --tag <tag> --summary <text> [--description <text>] [--deprecated]
 *   edit-path   <path> [--summary <text>] [--description <text>] [--tag <tag>] [--deprecated true|false]
 *   rename-path <old-path> <new-path>
 *
 * Subcommands (field-level edits):
 *   add-field    --path <path> --field <name> --type <type> [--required] [--description <text>] [--schema <ComponentName>]
 *   remove-field --path <path> --field <name> [--schema <ComponentName>]
 *   fix-type     --path <path> --field <name> --type <new-type> [--schema <ComponentName>]
 *   rename-field --path <path> --field <name> --new-name <name>
 *
 * Subcommands (tag management):
 *   add-tag    --name <name> [--description <text>]
 *   remove-tag --name <name>
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT         = path.resolve(__dirname, '..');
const DEFAULT_SPEC = path.join(ROOT, 'specs', 'openapi-milvus.json');
const MERGE_SCRIPT = path.join(ROOT, 'scripts', 'merge-openapi.js');

const AUTH_HEADER = { $ref: '#/components/parameters/AuthorizationHeader' };
const EMPTY_SUCCESS = {
    '200': {
        description: 'None',
        content: {
            'application/json': {
                schema: {
                    anyOf: [
                        { $ref: '#/components/schemas/EmptyResponse' },
                        { $ref: '#/components/schemas/ErrorResponse' },
                    ]
                },
                examples: {
                    '1': { summary: 'success', 'x-target-response': 'OPTION 1', value: { code: 0, data: {} } },
                    '2': { summary: 'failure', 'x-target-response': 'OPTION 2', value: { code: 800, message: 'not enough permission' } },
                }
            }
        }
    }
};

// ─── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
    const raw = argv.slice(2);
    const opts = {
        subcommand: null,
        positional: [],
        spec: DEFAULT_SPEC,
        dryRun: false,
        noMerge: false,
    };

    for (let i = 0; i < raw.length; i++) {
        const a = raw[i];
        if (a === '--help' || a === '-h') { printUsage(); process.exit(0); }
        else if (a === '--dry-run')  opts.dryRun  = true;
        else if (a === '--no-merge') opts.noMerge = true;
        else if (a === '--required') opts.required = true;
        else if (a === '--deprecated') {
            const next = raw[i+1];
            if (next === 'true' || next === 'false') { opts.deprecatedValue = next === 'true'; i++; }
            else opts.deprecated = true;
        }
        else if (a === '--spec'  && raw[i+1]) opts.spec        = path.resolve(raw[++i]);
        else if (a === '--tag'   && raw[i+1]) opts.tag         = raw[++i];
        else if (a === '--grep'  && raw[i+1]) opts.grep        = raw[++i];
        else if (a === '--path'  && raw[i+1]) opts.path        = raw[++i];
        else if (a === '--name'  && raw[i+1]) opts.name        = raw[++i];
        else if (a === '--summary'     && raw[i+1]) opts.summary     = raw[++i];
        else if (a === '--description' && raw[i+1]) opts.description = raw[++i];
        else if (a === '--field'    && raw[i+1]) opts.field    = raw[++i];
        else if (a === '--type'     && raw[i+1]) opts.type     = raw[++i];
        else if (a === '--new-name' && raw[i+1]) opts.newName  = raw[++i];
        else if (a === '--schema'   && raw[i+1]) opts.schema   = raw[++i];
        else if (!a.startsWith('--')) {
            if (!opts.subcommand) opts.subcommand = a;
            else opts.positional.push(a);
        }
    }
    return opts;
}

// ─── Load / write ─────────────────────────────────────────────────────────────

function loadSpec(specPath) {
    if (!fs.existsSync(specPath)) {
        console.error(`Spec not found: ${specPath}`);
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(specPath, 'utf8'));
}

function writeSpec(spec, specPath, dryRun, noMerge, diff) {
    const json = JSON.stringify(spec, null, '\t') + '\n';
    if (dryRun) {
        console.log('[dry-run] Would write:', specPath);
        if (diff) console.log(diff);
        return;
    }
    fs.writeFileSync(specPath, json);
    console.log('Written:', specPath);
    if (!noMerge) {
        console.log('Running merge-openapi.js...');
        execSync(`node ${MERGE_SCRIPT}`, { stdio: 'inherit' });
    }
}

// ─── resolveTarget ────────────────────────────────────────────────────────────
// Returns the `properties` object to mutate (and the required array if inline).

function resolveTarget(spec, opts) {
    if (opts.schema) {
        const s = spec.components && spec.components.schemas && spec.components.schemas[opts.schema];
        if (!s) { console.error(`Schema not found: ${opts.schema}`); process.exit(1); }
        if (!s.properties) s.properties = {};
        return { props: s.properties, required: s.required || (s.required = []) };
    }
    if (!opts.path) { console.error('--path or --schema is required'); process.exit(1); }
    const entry = spec.paths[opts.path];
    if (!entry) { console.error(`Path not found: ${opts.path}`); process.exit(1); }
    const post = entry.post;
    if (!post || !post.requestBody) { console.error('No requestBody on that path'); process.exit(1); }
    const schema = post.requestBody.content['application/json'].schema;
    if (!schema.properties) schema.properties = {};
    if (!schema.required)   schema.required   = [];
    return { props: schema.properties, required: schema.required };
}

// ─── Commands (read-only) ─────────────────────────────────────────────────────

function listPaths(spec, opts) {
    let paths = Object.keys(spec.paths || {});
    if (opts.tag) {
        paths = paths.filter(p => {
            const post = spec.paths[p].post;
            return post && post.tags && post.tags.includes(opts.tag);
        });
    }
    if (opts.grep) {
        const re = new RegExp(opts.grep, 'i');
        paths = paths.filter(p => re.test(p));
    }
    console.log(`${paths.length} path(s):`);
    paths.forEach(p => console.log(' ', p));
}

function showPath(spec, pathStr) {
    const entry = spec.paths[pathStr];
    if (!entry) { console.error(`Not found: ${pathStr}`); process.exit(1); }
    console.log(JSON.stringify(entry, null, 2));
}

function listTags(spec) {
    const counts = {};
    for (const [, entry] of Object.entries(spec.paths || {})) {
        const post = entry.post;
        if (post && post.tags) {
            post.tags.forEach(t => { counts[t] = (counts[t] || 0) + 1; });
        }
    }
    const tags = (spec.tags || []).map(t => t.name);
    // include any used-but-not-declared tags
    Object.keys(counts).forEach(t => { if (!tags.includes(t)) tags.push(t); });
    tags.forEach(t => console.log(`  [${(counts[t] || 0).toString().padStart(3)}]  ${t}`));
}

function showSchema(spec, name) {
    const s = spec.components && spec.components.schemas && spec.components.schemas[name];
    if (!s) { console.error(`Schema not found: ${name}`); process.exit(1); }
    console.log(JSON.stringify(s, null, 2));
}

// ─── Commands (path-level edits) ──────────────────────────────────────────────

function addPath(spec, opts) {
    if (!opts.path)    { console.error('--path is required');    process.exit(1); }
    if (!opts.tag)     { console.error('--tag is required');     process.exit(1); }
    if (!opts.summary) { console.error('--summary is required'); process.exit(1); }
    if (spec.paths[opts.path]) {
        console.error(`Path already exists: ${opts.path}`);
        process.exit(1);
    }

    const entry = {
        post: {
            summary: opts.summary,
            deprecated: opts.deprecated || false,
            description: opts.description || '',
            'x-i18n': { 'zh-CN': { summary: '', description: '' } },
            tags: [opts.tag],
            parameters: [AUTH_HEADER],
            requestBody: {
                content: {
                    'application/json': {
                        schema: { type: 'object', properties: {}, required: [] },
                        example: {},
                    }
                }
            },
            responses: EMPTY_SUCCESS,
        }
    };

    const diff = `+ ${opts.path}\n  summary: "${opts.summary}"\n  tag: "${opts.tag}"`;
    spec.paths[opts.path] = entry;
    return diff;
}

function editPath(spec, pathStr, opts) {
    const entry = spec.paths[pathStr];
    if (!entry) { console.error(`Path not found: ${pathStr}`); process.exit(1); }
    const post = entry.post;
    const changes = [];

    if (opts.summary !== undefined) {
        changes.push(`summary: "${post.summary}" → "${opts.summary}"`);
        post.summary = opts.summary;
    }
    if (opts.description !== undefined) {
        changes.push(`description: updated`);
        post.description = opts.description;
    }
    if (opts.tag !== undefined) {
        changes.push(`tag: "${(post.tags || []).join(',')}" → "${opts.tag}"`);
        post.tags = [opts.tag];
    }
    if (opts.deprecatedValue !== undefined) {
        changes.push(`deprecated: ${post.deprecated} → ${opts.deprecatedValue}`);
        post.deprecated = opts.deprecatedValue;
    } else if (opts.deprecated) {
        changes.push(`deprecated: ${post.deprecated} → true`);
        post.deprecated = true;
    }

    if (changes.length === 0) { console.log('Nothing to change.'); return null; }
    return `edit ${pathStr}:\n` + changes.map(c => `  ${c}`).join('\n');
}

function renamePath(spec, oldPath, newPath) {
    if (!spec.paths[oldPath]) { console.error(`Path not found: ${oldPath}`); process.exit(1); }
    if (spec.paths[newPath])  { console.error(`Target already exists: ${newPath}`); process.exit(1); }

    // Rebuild paths object preserving order
    const newPaths = {};
    for (const [k, v] of Object.entries(spec.paths)) {
        newPaths[k === oldPath ? newPath : k] = v;
    }
    spec.paths = newPaths;
    return `rename: ${oldPath} → ${newPath}`;
}

// ─── Commands (field-level edits) ─────────────────────────────────────────────

function addField(spec, opts) {
    if (!opts.field) { console.error('--field is required'); process.exit(1); }
    if (!opts.type)  { console.error('--type is required');  process.exit(1); }

    const { props, required } = resolveTarget(spec, opts);
    if (props[opts.field]) {
        console.error(`Field already exists: ${opts.field}`);
        process.exit(1);
    }

    const fieldDef = { type: opts.type };
    if (opts.description) fieldDef.description = opts.description;
    props[opts.field] = fieldDef;

    if (opts.required && !required.includes(opts.field)) {
        required.push(opts.field);
    }

    const target = opts.schema ? `schema ${opts.schema}` : `path ${opts.path}`;
    return `add field "${opts.field}" (${opts.type}) to ${target}`;
}

function removeField(spec, opts) {
    if (!opts.field) { console.error('--field is required'); process.exit(1); }
    const { props, required } = resolveTarget(spec, opts);
    if (!props[opts.field]) {
        console.error(`Field not found: ${opts.field}`);
        process.exit(1);
    }
    delete props[opts.field];
    const idx = required.indexOf(opts.field);
    if (idx !== -1) required.splice(idx, 1);
    const target = opts.schema ? `schema ${opts.schema}` : `path ${opts.path}`;
    return `remove field "${opts.field}" from ${target}`;
}

function fixType(spec, opts) {
    if (!opts.field) { console.error('--field is required'); process.exit(1); }
    if (!opts.type)  { console.error('--type is required');  process.exit(1); }
    const { props } = resolveTarget(spec, opts);
    if (!props[opts.field]) {
        console.error(`Field not found: ${opts.field}`);
        process.exit(1);
    }
    const old = props[opts.field].type;
    props[opts.field].type = opts.type;
    const target = opts.schema ? `schema ${opts.schema}` : `path ${opts.path}`;
    return `fix type of "${opts.field}" in ${target}: ${old} → ${opts.type}`;
}

function renameField(spec, opts) {
    if (!opts.field)   { console.error('--field is required');    process.exit(1); }
    if (!opts.newName) { console.error('--new-name is required'); process.exit(1); }
    if (!opts.path)    { console.error('--path is required (schema rename not supported)'); process.exit(1); }

    const entry = spec.paths[opts.path];
    if (!entry) { console.error(`Path not found: ${opts.path}`); process.exit(1); }
    const post = entry.post;
    const content = post.requestBody && post.requestBody.content['application/json'];
    if (!content) { console.error('No requestBody on that path'); process.exit(1); }
    const schema = content.schema;

    // 1. Rename in schema properties
    if (schema && schema.properties && schema.properties[opts.field]) {
        schema.properties[opts.newName] = schema.properties[opts.field];
        delete schema.properties[opts.field];
        // update required list
        if (schema.required) {
            const idx = schema.required.indexOf(opts.field);
            if (idx !== -1) schema.required[idx] = opts.newName;
        }
    }

    // 2. Rename in inline example
    if (content.example && opts.field in content.example) {
        content.example[opts.newName] = content.example[opts.field];
        delete content.example[opts.field];
    }

    // 3. Rename in named examples
    if (content.examples) {
        for (const ex of Object.values(content.examples)) {
            if (ex.value && opts.field in ex.value) {
                ex.value[opts.newName] = ex.value[opts.field];
                delete ex.value[opts.field];
            }
        }
    }

    // 4. Rename in response examples (best effort)
    if (post.responses) {
        for (const resp of Object.values(post.responses)) {
            const respContent = resp.content && resp.content['application/json'];
            if (!respContent) continue;
            if (respContent.example && opts.field in respContent.example) {
                respContent.example[opts.newName] = respContent.example[opts.field];
                delete respContent.example[opts.field];
            }
            if (respContent.examples) {
                for (const ex of Object.values(respContent.examples)) {
                    if (ex.value && opts.field in ex.value) {
                        ex.value[opts.newName] = ex.value[opts.field];
                        delete ex.value[opts.field];
                    }
                }
            }
        }
    }

    return `rename field "${opts.field}" → "${opts.newName}" in ${opts.path}`;
}

// ─── Commands (tag management) ────────────────────────────────────────────────

function addTag(spec, opts) {
    if (!opts.name) { console.error('--name is required'); process.exit(1); }
    if (!spec.tags) spec.tags = [];
    if (spec.tags.find(t => t.name === opts.name)) {
        console.error(`Tag already exists: ${opts.name}`);
        process.exit(1);
    }
    const tag = {
        name: opts.name,
        'x-i18n': { 'zh-CN': { description: '' } },
    };
    if (opts.description) {
        tag.description = opts.description;
        tag['x-i18n']['zh-CN'].description = '';
    }
    spec.tags.push(tag);
    return `add tag "${opts.name}"`;
}

function removeTag(spec, opts) {
    if (!opts.name) { console.error('--name is required'); process.exit(1); }
    // Check if in use
    for (const [p, entry] of Object.entries(spec.paths || {})) {
        const post = entry.post;
        if (post && post.tags && post.tags.includes(opts.name)) {
            console.error(`Tag "${opts.name}" is still used by: ${p}`);
            process.exit(1);
        }
    }
    const before = (spec.tags || []).length;
    spec.tags = (spec.tags || []).filter(t => t.name !== opts.name);
    if (spec.tags.length === before) {
        console.error(`Tag not found: ${opts.name}`);
        process.exit(1);
    }
    return `remove tag "${opts.name}"`;
}

// ─── Usage ────────────────────────────────────────────────────────────────────

function printUsage() {
    console.log(`
Usage: node scripts/edit-openapi.js <subcommand> [options]

Global options:
  --spec <path>    Target spec (default: specs/openapi-milvus.json)
  --dry-run        Print changes without writing
  --no-merge       Skip regenerating openapi.json after edits
  --help, -h       Print this help

Read-only:
  list-paths  [--tag <name>] [--grep <pattern>]
  show-path   <path>
  list-tags
  show-schema <name>

Path-level edits:
  add-path    --path <path> --tag <tag> --summary <text> [--description <text>] [--deprecated]
  edit-path   <path> [--summary <text>] [--description <text>] [--tag <tag>] [--deprecated true|false]
  rename-path <old-path> <new-path>

Field-level edits (--schema targets components/schemas; default targets path requestBody):
  add-field    --path <path>|--schema <Name> --field <name> --type <type> [--required] [--description <text>]
  remove-field --path <path>|--schema <Name> --field <name>
  fix-type     --path <path>|--schema <Name> --field <name> --type <new-type>
  rename-field --path <path> --field <name> --new-name <name>

Tag management:
  add-tag    --name <name> [--description <text>]
  remove-tag --name <name>
`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
    const opts = parseArgs(process.argv);

    if (!opts.subcommand) {
        printUsage();
        process.exit(0);
    }

    const spec = loadSpec(opts.spec);
    const cmd  = opts.subcommand;

    // Read-only commands
    if (cmd === 'list-paths')  { listPaths(spec, opts); return; }
    if (cmd === 'show-path')   { showPath(spec, opts.positional[0] || opts.path); return; }
    if (cmd === 'list-tags')   { listTags(spec); return; }
    if (cmd === 'show-schema') { showSchema(spec, opts.positional[0] || opts.name); return; }

    // Write commands
    let diff;
    if (cmd === 'add-path') {
        diff = addPath(spec, opts);
    } else if (cmd === 'edit-path') {
        const pathStr = opts.positional[0] || opts.path;
        if (!pathStr) { console.error('edit-path requires a path argument'); process.exit(1); }
        diff = editPath(spec, pathStr, opts);
        if (!diff) return;
    } else if (cmd === 'rename-path') {
        const [oldPath, newPath] = opts.positional;
        if (!oldPath || !newPath) { console.error('rename-path requires <old-path> <new-path>'); process.exit(1); }
        diff = renamePath(spec, oldPath, newPath);
    } else if (cmd === 'add-field') {
        diff = addField(spec, opts);
    } else if (cmd === 'remove-field') {
        diff = removeField(spec, opts);
    } else if (cmd === 'fix-type') {
        diff = fixType(spec, opts);
    } else if (cmd === 'rename-field') {
        diff = renameField(spec, opts);
    } else if (cmd === 'add-tag') {
        diff = addTag(spec, opts);
    } else if (cmd === 'remove-tag') {
        diff = removeTag(spec, opts);
    } else {
        console.error(`Unknown subcommand: ${cmd}`);
        printUsage();
        process.exit(1);
    }

    writeSpec(spec, opts.spec, opts.dryRun, opts.noMerge, diff);
}

main();

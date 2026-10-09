'use strict';

const fs = require('fs');
const path = require('path');
const BaseScanner = require('./base-scanner');

// Documentation categories for public ClientV2 methods, derived from the
// milvus-io/web-content API_Reference/milvus-sdk-rust/v3.0.x page tree
// (121 method pages, one category each; extracted 2026-10-08). The v2.6.x
// track shares the subset minus DataImport/FileResources/Snapshots. PR
// intake resolves a method page identity through this category; a public
// ClientV2 method absent here surfaces through COVERAGE_UNTRACKED_METHODS.
const RUST_CLIENT_METHOD_CATEGORIES = {
    add_collection_field: 'Collections',
    add_collection_function: 'Collections',
    add_collection_struct_field: 'Collections',
    add_file_resource: 'FileResources',
    add_function_field: 'Collections',
    add_privileges_to_group: 'Authentication',
    alter_alias: 'Collections',
    alter_collection_field_properties: 'Collections',
    alter_collection_function: 'Collections',
    alter_collection_properties: 'Collections',
    alter_database_properties: 'Database',
    alter_index_properties: 'Management',
    alter_role: 'Authentication',
    batch_describe_collections: 'Collections',
    check_health: 'Management',
    compact: 'Management',
    create_alias: 'Collections',
    create_collection: 'Collections',
    create_database: 'Database',
    create_index: 'Management',
    create_partition: 'Partitions',
    create_privilege_group: 'Authentication',
    create_resource_group: 'ResourceGroup',
    create_role: 'Authentication',
    create_simple_collection: 'Collections',
    create_snapshot: 'Snapshots',
    create_user: 'Authentication',
    delete: 'Vector',
    describe_alias: 'Collections',
    describe_collection: 'Collections',
    describe_database: 'Database',
    describe_index: 'Management',
    describe_replicas: 'ResourceGroup',
    describe_resource_group: 'ResourceGroup',
    describe_role: 'Authentication',
    describe_snapshot: 'Snapshots',
    describe_user: 'Authentication',
    drop_alias: 'Collections',
    drop_collection: 'Collections',
    drop_collection_field: 'Collections',
    drop_collection_field_properties: 'Collections',
    drop_collection_function: 'Collections',
    drop_collection_properties: 'Collections',
    drop_database: 'Database',
    drop_database_properties: 'Database',
    drop_function_field: 'Collections',
    drop_index: 'Management',
    drop_index_properties: 'Management',
    drop_partition: 'Partitions',
    drop_privilege_group: 'Authentication',
    drop_resource_group: 'ResourceGroup',
    drop_role: 'Authentication',
    drop_snapshot: 'Snapshots',
    drop_user: 'Authentication',
    dump_messages: 'CDC',
    flush: 'Management',
    flush_all: 'Management',
    get: 'Vector',
    get_collection_stats: 'Collections',
    get_compaction_plans: 'Management',
    get_compaction_state: 'Management',
    get_flush_all_state: 'Management',
    get_import_progress: 'DataImport',
    get_load_state: 'Collections',
    get_partition_stats: 'Partitions',
    get_refresh_external_collection_progress: 'Management',
    get_replicate_configuration: 'CDC',
    get_replicate_info: 'CDC',
    get_restore_snapshot_state: 'Snapshots',
    get_server_version: 'Management',
    server_version: 'Management',
    sdk_version: 'Management',
    grant_privilege: 'Authentication',
    grant_role: 'Authentication',
    has_collection: 'Collections',
    has_partition: 'Partitions',
    hybrid_search: 'Vector',
    insert: 'Vector',
    list_aliases: 'Collections',
    list_collections: 'Collections',
    list_databases: 'Database',
    list_file_resources: 'FileResources',
    list_import_jobs: 'DataImport',
    list_indexes: 'Management',
    list_partitions: 'Partitions',
    list_persistent_segments: 'Management',
    list_privilege_groups: 'Authentication',
    list_query_segments: 'Management',
    list_refresh_external_collection_jobs: 'Management',
    list_resource_groups: 'ResourceGroup',
    list_restore_snapshot_jobs: 'Snapshots',
    list_roles: 'Authentication',
    list_snapshots: 'Snapshots',
    list_users: 'Authentication',
    load_collection: 'Collections',
    load_partitions: 'Partitions',
    optimize: 'Management',
    pin_snapshot_data: 'Snapshots',
    query: 'Vector',
    query_iterator: 'Vector',
    refresh_external_collection: 'Management',
    refresh_load: 'Collections',
    release_collection: 'Collections',
    release_partitions: 'Partitions',
    remove_file_resource: 'FileResources',
    remove_privileges_from_group: 'Authentication',
    rename_collection: 'Collections',
    restore_snapshot: 'Snapshots',
    revoke_privilege: 'Authentication',
    revoke_role: 'Authentication',
    run_analyzer: 'Vector',
    search: 'Vector',
    search_iterator: 'Vector',
    transfer_node: 'ResourceGroup',
    transfer_replica: 'ResourceGroup',
    truncate_collection: 'Collections',
    unpin_snapshot_data: 'Snapshots',
    update_password: 'Authentication',
    update_replicate_configuration: 'CDC',
    update_resource_groups: 'ResourceGroup',
    update_user: 'Authentication',
    upsert: 'Vector',
    use_database: 'Database',
};

// Type/enum symbols that own their own page: the literal types/ tree plus
// the type pages nested in category folders and the BulkImport module page
// (web-content v3.0.x census 2026-10-08; the v2.6.x track is a subset).
const TYPE_CATEGORIES = {
    ClientTelemetry: 'Client',
    ClientV2: 'Client',
    ConnectConfig: 'Client',
    MilvusClientV2Session: 'Client',
    RetryConfig: 'Client',
    TelemetryConfig: 'Client',
    DataType: 'Collections',
    IndexType: 'Management',
    MetricType: 'Management',
    SDKVersion: 'Management',
    BulkImport: 'DataImport',
    AggregationMetricValue: 'types',
    CollectionDesc: 'types',
    ConsistencyLevel: 'types',
    EntityRow: 'types',
    FieldPartialUpdateOp: 'types',
    FilterTemplateValue: 'types',
    FunctionChain: 'types',
    FunctionScore: 'types',
    Highlighter: 'types',
    IndexDesc: 'types',
    IndexParam: 'types',
    OrderByField: 'types',
    SearchAggregation: 'types',
    SearchVectors: 'types',
};

// Balanced-brace slice starting at the `{` located at or after `fromIndex`.
// Returns { body, end } or null when the opening brace never appears.
function sliceBraceBlock(content, fromIndex) {
    const open = content.indexOf('{', fromIndex);
    if (open === -1) return null;
    let depth = 0;
    for (let i = open; i < content.length; i++) {
        const ch = content[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return { body: content.slice(open + 1, i), end: i };
        }
    }
    return null;
}

function lineAt(content, index) {
    return content.slice(0, index).split('\n').length;
}

// ClientV2 methods documented on the MilvusClientV2 container page
// (Constructor / Runtime configuration / Method index sections), not on
// standalone category pages — excluded from the coverage gate. 2026-10-08
// adjudication: `server_version` maps to the GetServerVersion page (source
// method name differs from the page name); `list_compaction_tasks` has no
// page at all and legitimately stays in COVERAGE_UNTRACKED_METHODS.
const RUST_CONTAINER_PAGE_METHODS = new Set([
    'new',
    'set_rpc_deadline',
    'set_retry_param',
    'telemetry',
    'session',
    'current_database',
]);

// Page titles are PascalCase while source methods are snake_case; every
// pair matches mechanical conversion except the evidence-derived exceptions
// below (source server_version documents the GetServerVersion page).
const RUST_METHOD_PAGE_NAME_EXCEPTIONS = {
    server_version: 'GetServerVersion',
    sdk_version: 'SDKVersion',
};

// Module pages that document their struct plus flattened request builder
// fields (web-content evidence: DataImport/BulkImport's REQUEST FIELDS list
// BulkImportRequest's fields). The page symbol's params carry the union plus
// the constructor's positional params; BulkImportConfig's own section is not
// part of the verified REQUEST FIELDS surface.
const TYPE_FIELD_UNIONS = {
    BulkImport: ['BulkImportRequest'],
};

// Pages that flatten a sub-request's builder fields into the parent's
// REQUEST FIELDS (web-content evidence 2026-10-09 review: HybridSearch lists
// SubSearchRequest's vector_field/vectors/... at top level). The method's
// params carry the union so page verification covers every declared field.
const REQUEST_FIELD_UNIONS = {
    HybridSearchRequest: ['SubSearchRequest'],
};

// Convenience request structs that own a method-style page documenting the
// builder + fields (dispatched through another client method via From).
const REQUEST_TYPE_PAGES = {
    CreateSimpleCollectionRequest: 'Collections',
};
const REQUEST_TYPE_PAGE_NAMES = {
    CreateSimpleCollectionRequest: 'CreateSimpleCollection',
};

// Type page titles that differ from the source type name.
const RUST_TYPE_PAGE_NAME_EXCEPTIONS = {
    ClientV2: 'MilvusClientV2',
};

function pascalCase(snakeName) {
    return snakeName
        .split('_')
        .filter(Boolean)
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join('');
}

class RustScanner extends BaseScanner {
    constructor(opts) {
        super(opts);
    }

    _defaultExcludes() {
        return ['.git', '**/.git/**', '**/tests/**', '**/test/**', '**/target/**', '**/benches/**', '**/examples/**', 'src/v1/**', 'src/proto/**'];
    }

    async scan() {
        const allFiles = this._walkFiles(['.rs']);

        // Phase 1: public ClientV2 methods from the client impl blocks, plus
        // the BulkImport REST client (module-page identity, no category gate).
        const methods = [];
        for (const file of allFiles) {
            const relPath = path.relative(this.rootDir, file);
            if (/^src\/v2\/client\.rs$/.test(relPath) || /^src\/v2\/client\//.test(relPath)) {
                methods.push(...this._extractImplMethods(fs.readFileSync(file, 'utf-8'), relPath, 'ClientV2'));
            }
        }
        const bulkImportFile = allFiles.find((f) => path.relative(this.rootDir, f) === 'src/v2/bulk_import.rs');
        if (bulkImportFile) {
            methods.push(...this._extractImplMethods(
                fs.readFileSync(bulkImportFile, 'utf-8'),
                'src/v2/bulk_import.rs',
                'BulkImport',
            ));
        }

        // Phase 2: request structs feed method params (REQUEST FIELDS).
        const requestIndex = this._indexRequestStructs(allFiles);
        for (const method of methods) {
            if (method.requestClass) {
                const unionNames = [method.requestClass, ...(REQUEST_FIELD_UNIONS[method.requestClass] || [])];
                const fields = [];
                const seen = new Set();
                for (const name of unionNames) {
                    const request = requestIndex.get(name);
                    if (!request) continue;
                    method.requestSourcePath = method.requestSourcePath || request.filePath;
                    for (const field of request.fields) {
                        if (seen.has(field.name)) continue;
                        seen.add(field.name);
                        fields.push(field);
                    }
                }
                if (fields.length > 0) method.params = fields.map((field) => ({ name: field.name, type: field.type }));
            }
        }

        // Phase 3: type/enum symbols that own a page, with categories, plus
        // page-owning convenience request types (params = builder fields).
        const types = this._extractTypeSymbols(allFiles);
        for (const type of types) {
            const unionSources = TYPE_FIELD_UNIONS[type.name];
            if (!unionSources) continue;
            const seen = new Set((type.params || []).map((field) => field.name));
            const extra = [];
            for (const source of unionSources) {
                const request = requestIndex.get(source);
                if (!request) continue;
                for (const field of request.fields) {
                    if (seen.has(field.name)) continue;
                    seen.add(field.name);
                    extra.push({ name: field.name, type: field.type });
                }
            }
            const constructor = methods.find((method) => method.parentClass === type.name && method.name === 'new');
            if (constructor) {
                for (const param of constructor.params || []) {
                    if (seen.has(param.name)) continue;
                    seen.add(param.name);
                    extra.push(param);
                }
            }
            type.params = [...(type.params || []), ...extra];
            type.fields = [...(type.fields || []), ...extra];
        }
        for (const [requestName, category] of Object.entries(REQUEST_TYPE_PAGES)) {
            const request = requestIndex.get(requestName);
            if (!request) continue;
            types.push({
                kind: 'class',
                name: requestName,
                signature: `pub struct ${requestName}`,
                params: request.fields.map((field) => ({ name: field.name, type: field.type })),
                fields: request.fields,
                filePath: request.filePath,
                lineNumber: 1,
                category,
                pageName: REQUEST_TYPE_PAGE_NAMES[requestName] || requestName.replace(/Request$/, ''),
            });
        }

        // Coverage gate mirrors the java scanner: a public ClientV2 method
        // absent from RUST_CLIENT_METHOD_CATEGORIES is invisible to PR page
        // resolution — surface it instead of skipping silently.
        const untracked = [];
        for (const symbol of methods) {
            if (symbol.parentClass === 'ClientV2') {
                const category = RUST_CLIENT_METHOD_CATEGORIES[symbol.name];
                if (category) {
                    symbol.category = category;
                    symbol.pageName = RUST_METHOD_PAGE_NAME_EXCEPTIONS[symbol.name] || pascalCase(symbol.name);
                } else if (!RUST_CONTAINER_PAGE_METHODS.has(symbol.name)) untracked.push(symbol.name);
            } else if (symbol.parentClass === 'BulkImport') {
                const category = RUST_CLIENT_METHOD_CATEGORIES[symbol.name];
                if (category) {
                    symbol.category = category;
                    symbol.pageName = RUST_METHOD_PAGE_NAME_EXCEPTIONS[symbol.name] || pascalCase(symbol.name);
                }
            }
        }
        this.lastScanDiagnostics = untracked.length > 0
            ? [{
                level: 'warn',
                code: 'COVERAGE_UNTRACKED_METHODS',
                message: `${untracked.length} public ClientV2 method(s) are not in RUST_CLIENT_METHOD_CATEGORIES and will be invisible to PR page resolution: ${untracked.join(', ')}.`,
                methods: [...untracked],
            }]
            : [];

        return [...methods, ...types];
    }

    // Extract `impl <TypeName> { ... }` blocks and the pub fns inside them.
    _extractImplMethods(content, filePath, typeName) {
        const symbols = [];
        const implNeedle = `impl ${typeName} {`;
        let searchFrom = 0;
        for (;;) {
            const implAt = content.indexOf(implNeedle, searchFrom);
            if (implAt === -1) break;
            const block = sliceBraceBlock(content, implAt + implNeedle.length - 1);
            if (!block) break;
            const bodyOffset = implAt + implNeedle.length;
            const fnRegex = /pub\s+(?:async\s+)?fn\s+(\w+)(?:<[^>]*>)?\s*\(/g;
            let fnMatch;
            while ((fnMatch = fnRegex.exec(block.body)) !== null) {
                const symbolIndexInBody = fnMatch.index;
                const parsed = this._parseSignatureTail(block.body, fnMatch.index + fnMatch[0].length);
                if (!parsed) continue;
                const returnTypeMatch = /\)\s*(?:->\s*([^{;]+?))?\s*(?:where|{)/.exec(parsed.tail);
                const returnType = returnTypeMatch && returnTypeMatch[1] ? returnTypeMatch[1].trim() : '';
                const requestClass = this._requestClassFromParams(parsed.params);
                symbols.push({
                    kind: 'method',
                    name: fnMatch[1],
                    parentClass: typeName,
                    signature: `pub ${parsed.isAsync ? 'async ' : ''}fn ${fnMatch[1]}(${parsed.params})${returnType ? ` -> ${returnType}` : ''}`,
                    params: this._positionalParams(parsed.params),
                    requestClass,
                    filePath,
                    lineNumber: lineAt(content, bodyOffset + symbolIndexInBody),
                });
            }
            searchFrom = block.end;
        }
        return symbols;
    }

    // From the `(` after an fn name, capture the balanced parameter list and
    // the tail up to the fn body/where clause. Returns null on unbalanced.
    _parseSignatureTail(body, openParenAt) {
        let depth = 0;
        let i = openParenAt - 1;
        for (; i < body.length; i++) {
            const ch = body[i];
            if (ch === '(') depth++;
            else if (ch === ')') {
                depth--;
                if (depth === 0) break;
            }
        }
        if (depth !== 0 || i >= body.length) return null;
        const params = body.slice(openParenAt, i).replace(/\s+/g, ' ').trim();
        const tail = body.slice(i, Math.min(i + 400, body.length));
        const isAsync = /(?:^|\s)async\s+fn\s/.test(body.slice(Math.max(0, openParenAt - 40), openParenAt));
        return { params, tail, isAsync };
    }

    _requestClassFromParams(params) {
        const intoMatch = /impl\s+Into<[^>]*?(\w+Request)\s*>/.exec(params);
        if (intoMatch) return intoMatch[1];
        const directMatch = /(\w+Request)\s*(?:,|$|\))/.exec(params);
        return directMatch ? directMatch[1] : null;
    }

    _positionalParams(params) {
        if (!params) return [];
        const cleaned = params.replace(/&self\s*,?\s*/, '').replace(/&mut self\s*,?\s*/, '').trim();
        if (!cleaned) return [];
        // Split on top-level commas (generics nest one level at most here).
        const parts = [];
        let depth = 0;
        let current = '';
        for (const ch of cleaned) {
            if (ch === '<' || ch === '(') depth++;
            else if (ch === '>' || ch === ')') depth--;
            if (ch === ',' && depth === 0) {
                parts.push(current.trim());
                current = '';
            } else current += ch;
        }
        if (current.trim()) parts.push(current.trim());
        return parts
            .map((part) => {
                const sep = part.indexOf(':');
                if (sep === -1) return null;
                return { name: part.slice(0, sep).trim(), type: part.slice(sep + 1).trim() };
            })
            .filter(Boolean);
    }

    // Index every `pub struct *Request { ... }` across src/v2 with its fields.
    _indexRequestStructs(files) {
        const index = new Map();
        const structRegex = /pub\s+struct\s+(\w+Request)\s*\{/g;
        // Fields anchor at line start with pub optional: bulk-import request
        // structs keep fields private behind a builder (their builder surface
        // is the documented REQUEST FIELDS), while client request structs use
        // pub/pub(crate). Struct blocks contain only field lines, doc
        // comments and attributes, so the anchor stays precise.
        const fieldRegex = /^[ \t]*(?:pub(?:\(crate\))?\s+)?([a-z_]\w*)\s*:\s*([^,\n]+),/gm;
        for (const file of files) {
            const relPath = path.relative(this.rootDir, file);
            if (!/^src\/v2\//.test(relPath)) continue;
            const content = fs.readFileSync(file, 'utf-8');
            let structMatch;
            while ((structMatch = structRegex.exec(content)) !== null) {
                const block = sliceBraceBlock(content, structMatch.index + structMatch[0].length - 1);
                if (!block) continue;
                const fields = [];
                let fieldMatch;
                while ((fieldMatch = fieldRegex.exec(block.body)) !== null) {
                    fields.push({ name: fieldMatch[1], type: fieldMatch[2].trim() });
                }
                index.set(structMatch[1], { fields, filePath: relPath });
            }
        }
        return index;
    }

    // Emit page-owning type/enum symbols (TYPE_CATEGORIES gate, java precedent).
    _extractTypeSymbols(files) {
        const symbols = [];
        const declRegex = /pub\s+(struct|enum)\s+(\w+)\s*\{/g;
        const aliasRegex = /pub\s+type\s+(\w+)\s*=/g;
        for (const file of files) {
            const relPath = path.relative(this.rootDir, file);
            if (!/^src\/v2\/(types|client|response)\//.test(relPath) && relPath !== 'src/v2/client.rs' && relPath !== 'src/v2/bulk_import.rs') continue;
            const content = fs.readFileSync(file, 'utf-8');
            let declMatch;
            while ((declMatch = declRegex.exec(content)) !== null) {
                const [, kind, name] = declMatch;
                const category = TYPE_CATEGORIES[name];
                if (!category) continue;
                const block = sliceBraceBlock(content, declMatch.index + declMatch[0].length - 1);
                if (!block) continue;
                const symbol = {
                    kind: kind === 'enum' ? 'enum' : 'class',
                    name,
                    signature: `pub ${kind} ${name}`,
                    filePath: relPath,
                    lineNumber: lineAt(content, declMatch.index),
                    category,
                    pageName: RUST_TYPE_PAGE_NAME_EXCEPTIONS[name] || name,
                };
                if (kind === 'enum') {
                    symbol.values = [...block.body.matchAll(/^ {4}([A-Z]\w*)\s*(?:\([^)]*\))?\s*,?\s*$/gm)].map((m) => m[1]);
                    // cpp-scanner convention: enum pages verify their declared
                    // values through the params set (pr-scan builds `available`
                    // from symbol.params for every kind).
                    symbol.params = symbol.values.map((name) => ({ name, type: 'variant' }));
                } else {
                    symbol.fields = [...block.body.matchAll(/^[ \t]*(?:pub(?:\(crate\))?\s+)?([a-z_]\w*)\s*:\s*([^,\n]+),/gm)]
                        .map((m) => ({ name: m[1], type: m[2].trim() }));
                    symbol.params = symbol.fields.map((field) => ({ name: field.name, type: field.type }));
                }
                symbols.push(symbol);
            }
            let aliasMatch;
            while ((aliasMatch = aliasRegex.exec(content)) !== null) {
                const aliasName = aliasMatch[1];
                const aliasCategory = TYPE_CATEGORIES[aliasName];
                if (!aliasCategory) continue;
                symbols.push({
                    kind: 'class',
                    name: aliasName,
                    signature: `pub type ${aliasName}`,
                    filePath: relPath,
                    lineNumber: lineAt(content, aliasMatch.index),
                    category: aliasCategory,
                    pageName: RUST_TYPE_PAGE_NAME_EXCEPTIONS[aliasName] || aliasName,
                    params: [],
                });
            }
        }
        return symbols;
    }
}

module.exports = RustScanner;

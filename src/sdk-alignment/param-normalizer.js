/**
 * ParamNormalizer — normalizes parameter names to snake_case canonical form,
 * extracts params from each SDK's symbol shape, and compares across SDKs.
 */

const fs = require('fs');
const path = require('path');

// Semantic equivalence: map canonical param name → all known variants
const PARAM_ALIASES = {
    'filter': ['filter', 'expr', 'expression', 'filter_expression'],
    'collection_name': ['collection_name', 'name'],
    'partition_name': ['partition_name', 'partition_names'],
    'output_fields': ['output_fields', 'fields', 'out_fields'],
    'limit': ['limit', 'top_k', 'topk'],
    'offset': ['offset', 'skip'],
    'consistency_level': ['consistency_level', 'consistency'],
    'timeout': ['timeout', 'deadline'],
    'data': ['data', 'entities', 'records', 'rows'],
    'vectors': ['vectors', 'vector', 'query_vectors'],
    'anns_field': ['anns_field', 'vector_field', 'field_name'],
    'metric_type': ['metric_type', 'metric'],
    'search_params': ['search_params', 'params'],
    'ids': ['ids', 'pks', 'primary_keys'],
    'index_name': ['index_name', 'index'],
    'num_shards': ['num_shards', 'shard_num', 'shards_num'],
    'description': ['description', 'desc'],
    'properties': ['properties', 'params'],
    'role_name': ['role_name', 'role'],
    'user_name': ['user_name', 'user', 'username'],
    'privilege': ['privilege', 'privilege_name'],
    'db_name': ['db_name', 'database_name', 'database'],
    'group_name': ['group_name', 'privilege_group_name'],
    'schema': ['schema', 'collection_schema'],
    'dimension': ['dimension', 'dim'],
};

// Build reverse lookup: variant → canonical
const VARIANT_TO_CANONICAL = {};
for (const [canonical, variants] of Object.entries(PARAM_ALIASES)) {
    for (const v of variants) {
        VARIANT_TO_CANONICAL[v] = canonical;
    }
}

class ParamNormalizer {
    /**
     * Convert a param name to snake_case.
     */
    toSnakeCase(name) {
        // Already snake_case
        if (name.includes('_') && name === name.toLowerCase()) return name;

        // Strip With/Add prefix (C++/Go option methods)
        let stripped = name;
        if (/^(With|Add)[A-Z]/.test(name)) {
            stripped = name.replace(/^(With|Add)/, '');
        }

        // PascalCase/camelCase → snake_case
        return stripped
            .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
            .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
            .toLowerCase();
    }

    /**
     * Resolve a snake_case param name to its canonical form.
     */
    resolveAlias(snakeName) {
        return VARIANT_TO_CANONICAL[snakeName] || snakeName;
    }

    /**
     * Extract parameter names from a symbol, normalized to snake_case canonical form.
     *
     * @param {Object} symbol - Scanner output symbol
     * @param {string} language - 'python' | 'java' | 'node' | 'cpp' | 'go'
     * @returns {string[]} Array of canonical param names
     */
    extractParams(symbol, language) {
        const rawNames = this._extractRawNames(symbol, language);
        return rawNames.map(name => {
            const snake = this.toSnakeCase(name);
            return this.resolveAlias(snake);
        });
    }

    /**
     * Extract raw parameter names from a symbol based on language-specific structure.
     */
    _extractRawNames(symbol, language) {
        switch (language) {
            case 'python':
                return this._extractPythonParams(symbol);
            case 'java':
                return this._extractJavaParams(symbol);
            case 'node':
                return this._extractNodeParams(symbol);
            case 'cpp':
                return this._extractCppParams(symbol);
            case 'go':
                return this._extractGoParams(symbol);
            default:
                return [];
        }
    }

    _extractPythonParams(symbol) {
        if (!symbol.params || !symbol.params.length) return [];
        return symbol.params
            .filter(p => p.kind !== 'args' && p.kind !== 'kwargs' && p.kind !== 'separator')
            .map(p => p.name);
    }

    _extractJavaParams(symbol) {
        if (!symbol.params || !symbol.params.length) return [];
        return symbol.params.map(p => p.name);
    }

    _extractNodeParams(symbol) {
        if (!symbol.params || !symbol.params.length) return [];

        // Node methods take a single typed param like `data: HasCollectionReq`.
        // Resolve the interface to get actual field names.
        if (symbol.params.length === 1 && this._nodeTypeResolver) {
            const rawType = symbol.params[0].type;
            if (rawType && rawType !== 'any') {
                // Handle union types: `CreateColReq | CreateCollectionReq`
                // Split on `|`, resolve each variant, merge all fields
                const variants = rawType.split('|').map(t => t.trim()).filter(Boolean);
                const allFields = new Set();
                for (const variant of variants) {
                    const fields = this._nodeTypeResolver.resolveFields(variant);
                    for (const f of fields) allFields.add(f);
                }
                if (allFields.size > 0) return [...allFields];
            }
        }

        return symbol.params.map(p => p.name);
    }

    /**
     * Initialize the Node type resolver from the SDK types directory.
     * Must be called before extracting Node params.
     * @param {string} nodeRootDir - Root of milvus-sdk-node repo
     */
    initNodeTypeResolver(nodeRootDir) {
        this._nodeTypeResolver = new NodeTypeResolver(nodeRootDir);
        this._nodeTypeResolver.parse();
    }

    _extractCppParams(symbol) {
        // C++ params come from With*/Add* methods on the request class
        if (!symbol.params || !symbol.params.length) return [];
        return symbol.params.map(p => p.name);
    }

    _extractGoParams(symbol) {
        const names = [];

        // Constructor params (required)
        if (symbol.params && symbol.params.length) {
            for (const p of symbol.params) {
                if (p.name && p.name !== 'ctx' && p.name !== 'option' && p.name !== 'callOptions') {
                    names.push(p.name);
                }
            }
        }

        // Option With* methods (optional)
        if (symbol.optionMethods && symbol.optionMethods.length) {
            for (const m of symbol.optionMethods) {
                names.push(m.name);
            }
        }

        return names;
    }

    /**
     * Compare parameters across SDKs for a single method.
     *
     * @param {Object} entry - { category, sdks: { python?: symbol, java?: symbol, ... } }
     * @returns {Object} { params: Map<canonicalParam, { python: bool, java: bool, ... }>, allLanguages: string[] }
     */
    compareParams(entry) {
        const allLanguages = Object.keys(entry.sdks);
        const paramPresence = new Map();

        for (const lang of allLanguages) {
            const symbol = entry.sdks[lang];
            const params = this.extractParams(symbol, lang);

            for (const param of params) {
                if (!paramPresence.has(param)) {
                    paramPresence.set(param, {});
                }
                paramPresence.get(param)[lang] = true;
            }
        }

        return { params: paramPresence, allLanguages };
    }
}

/**
 * NodeTypeResolver — parses TypeScript interface definitions from milvus-sdk-node
 * and resolves them to flat field name lists, following extends chains.
 */
class NodeTypeResolver {
    constructor(rootDir) {
        this.rootDir = rootDir;
        this.typesDir = path.join(rootDir, 'milvus', 'types');
        // interface/type name → { fields: string[], extends: string[], omit: string[] }
        this.interfaces = new Map();
        // Resolved cache: typeName → string[]
        this._cache = new Map();
    }

    parse() {
        const files = fs.readdirSync(this.typesDir).filter(f => f.endsWith('.ts'));
        for (const file of files) {
            const content = fs.readFileSync(path.join(this.typesDir, file), 'utf8');
            this._parseFile(content);
        }
    }

    _parseFile(content) {
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Pattern 1: `export interface Foo ...`
            const ifaceStart = line.match(/^(?:export\s+)?interface\s+(\w+)/);
            if (ifaceStart) {
                // Collect the full declaration (may span multiple lines until `{`)
                let decl = '';
                let bodyStartLine = i;
                for (let j = i; j < Math.min(lines.length, i + 5); j++) {
                    decl += lines[j] + ' ';
                    if (lines[j].includes('{')) { bodyStartLine = j; break; }
                }

                const name = ifaceStart[1];
                const extendsMatch = decl.match(/extends\s+(.+?)\s*\{/);
                const extendsPart = extendsMatch ? extendsMatch[1] : '';
                const { bases, omit } = this._parseExtends(extendsPart);
                const fields = this._parseInterfaceBody(lines, bodyStartLine);
                this.interfaces.set(name, { fields, extends: bases, omit });
                continue;
            }

            // Pattern 2: `type Foo = Bar & { fields }` (intersection with inline body)
            const typeIntersectMatch = line.match(/^(?:export\s+)?type\s+(\w+)\s*=/);
            if (typeIntersectMatch) {
                const name = typeIntersectMatch[1];
                const rhs = this._collectMultilineType(lines, i);
                this._parseTypeAlias(name, rhs);
            }
        }
    }

    _parseExtends(extendsPart) {
        const bases = [];
        const omit = [];

        if (!extendsPart) return { bases, omit };

        // Handle Omit<Bar, 'x' | 'y'>
        const omitMatch = extendsPart.match(/Omit<(\w+),\s*([^>]+)>/);
        if (omitMatch) {
            bases.push(omitMatch[1]);
            const excluded = omitMatch[2].match(/'(\w+)'/g);
            if (excluded) {
                for (const e of excluded) omit.push(e.replace(/'/g, ''));
            }
            // There might be other bases after the Omit
            const rest = extendsPart.replace(/Omit<[^>]+>/, '').replace(/,/g, '').trim();
            if (rest) {
                for (const b of rest.split(/\s*,\s*/)) {
                    const clean = b.trim();
                    if (clean && clean !== 'Omit') bases.push(clean);
                }
            }
        } else {
            // Simple: `extends Foo, Bar`
            for (const b of extendsPart.split(',')) {
                const clean = b.trim();
                if (clean) bases.push(clean);
            }
        }

        return { bases, omit };
    }

    _parseInterfaceBody(lines, startLine) {
        const fields = [];
        let depth = 0;
        let started = false;

        for (let i = startLine; i < lines.length; i++) {
            for (const ch of lines[i]) {
                if (ch === '{') { depth++; started = true; }
                if (ch === '}') depth--;
            }
            if (!started) continue;

            // Only parse fields at depth 1 (top level of the interface body)
            if (depth === 1) {
                const fieldMatch = lines[i].match(/^\s+(\w+)\s*[?]?\s*:/);
                if (fieldMatch) {
                    const fieldName = fieldMatch[1];
                    // Skip index signatures like `[key: string]: any`
                    if (fieldName !== 'key' && fieldName !== 'x') {
                        fields.push(fieldName);
                    }
                }
            }

            if (started && depth <= 0) break;
        }

        return fields;
    }

    _collectMultilineType(lines, startLine) {
        let result = '';
        let depth = 0;

        for (let i = startLine; i < Math.min(lines.length, startLine + 30); i++) {
            result += lines[i] + '\n';
            for (const ch of lines[i]) {
                if (ch === '{' || ch === '(' || ch === '<') depth++;
                if (ch === '}' || ch === ')' || ch === '>') depth--;
            }
            // End when we see a semicolon at depth 0, or an empty interface `{}`
            if (depth <= 0 && (lines[i].includes(';') || lines[i].match(/\}\s*$/))) break;
        }

        return result;
    }

    _parseTypeAlias(name, rhs) {
        const bases = [];
        const omit = [];
        const fields = [];

        // Handle Omit<Bar, 'x'> in type aliases
        const omitMatches = rhs.matchAll(/Omit<\s*(\w+),\s*([^>]+)>/g);
        for (const m of omitMatches) {
            bases.push(m[1]);
            const excluded = m[2].match(/'(\w+)'/g);
            if (excluded) {
                for (const e of excluded) omit.push(e.replace(/'/g, ''));
            }
        }

        // Handle union types: `A | B` — collect all branches
        // Handle intersection types: `A & { fields }` — collect base + inline fields
        const cleanRhs = rhs.replace(/^(?:export\s+)?type\s+\w+\s*=\s*/, '');

        // Extract named type references (not inside angle brackets for generics)
        const typeRefs = cleanRhs.match(/(?:^|[&|(\s])(\w+(?:Req|Request|Parent)\w*)/g);
        if (typeRefs) {
            for (const ref of typeRefs) {
                const clean = ref.replace(/[&|(\s]/g, '').trim();
                if (clean && clean !== name && !bases.includes(clean)) {
                    bases.push(clean);
                }
            }
        }

        // Extract inline fields from `& { field: type; }` — line-based to avoid matching comments
        const rhsLines = rhs.split('\n');
        let inBlock = false;
        let blockDepth = 0;
        for (const line of rhsLines) {
            for (const ch of line) {
                if (ch === '{') { blockDepth++; inBlock = true; }
                if (ch === '}') blockDepth--;
            }
            if (inBlock && blockDepth >= 1) {
                // Match field definition at start of line (with leading whitespace)
                const fieldMatch = line.match(/^\s+(\w+)\s*[?]?\s*:/);
                if (fieldMatch) {
                    const fieldName = fieldMatch[1];
                    if (fieldName !== 'key' && fieldName !== 'x') {
                        fields.push(fieldName);
                    }
                }
            }
        }

        if (bases.length > 0 || fields.length > 0) {
            this.interfaces.set(name, { fields, extends: bases, omit });
        }
    }

    /**
     * Resolve all fields for a type name, following extends chains.
     * @param {string} typeName
     * @returns {string[]} field names (deduplicated)
     */
    resolveFields(typeName) {
        if (this._cache.has(typeName)) return this._cache.get(typeName);

        const result = this._resolveFieldsInner(typeName, new Set());
        this._cache.set(typeName, result);
        return result;
    }

    _resolveFieldsInner(typeName, visited) {
        if (visited.has(typeName)) return [];
        visited.add(typeName);

        const iface = this.interfaces.get(typeName);
        if (!iface) return [];

        const fields = new Set(iface.fields);
        const omitSet = new Set(iface.omit);

        // Resolve base types
        for (const base of iface.extends) {
            // Skip non-param base types
            if (base === 'GrpcTimeOut' || base === 'MsgBase') continue;
            if (base.includes('Response') || base === 'TimeStamp' || base === 'TimeStampArray') continue;

            const baseFields = this._resolveFieldsInner(base, visited);
            for (const f of baseFields) {
                if (!omitSet.has(f)) fields.add(f);
            }
        }

        // Filter out common infrastructure fields that aren't API params
        const SKIP_FIELDS = new Set(['timeout', 'base']);
        const result = [...fields].filter(f => !SKIP_FIELDS.has(f));
        return result;
    }
}

module.exports = ParamNormalizer;

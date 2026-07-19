const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const BaseScanner = require('./base-scanner');

/**
 * NodeScanner — extracts public symbols from the milvus-sdk-node TypeScript SDK.
 *
 * Class hierarchy: BaseClient → GRPCClient → User → Resource → Partition →
 *   Index → Data → Collection → Database → MilvusClient
 *
 * The scanner maps methods to bitable categories based on which file they're in
 * and what they do:
 *   - GrpcClient.ts    → Client
 *   - User.ts          → Authentication
 *   - Resource.ts      → ResourceGroup
 *   - Partition.ts     → Partitions
 *   - MilvusIndex.ts   → Management
 *   - Data.ts          → Vector (insert/upsert/delete/search/query/get/count)
 *                         Management (flush/segment/loadBalance)
 *   - Collection.ts    → Collections (CRUD/alias)
 *                         Management (load/release/compact/replicas)
 *   - Database.ts      → Database
 *   - MilvusClient.ts  → Client (connect) / Collections (createCollection)
 *   - types/           → Enums (DataType, IndexType, MetricType, FunctionType)
 */
class NodeScanner extends BaseScanner {
    constructor(opts) {
        super(opts);
        this._typeIndex = null;
        // Methods in Data.ts that belong to Management, not Vector
        this._dataManagementMethods = new Set([
            'flush', 'flushSync', 'getFlushState', 'loadBalance',
            'getQuerySegmentInfo', 'getPersistentSegmentInfo',
        ]);
        // Methods in Collection.ts that belong to Management, not Collections
        this._collectionManagementMethods = new Set([
            'loadCollection', 'loadCollectionSync', 'loadCollectionAsync',
            'refreshLoad', 'releaseCollection',
            'compact', 'getCompactionState', 'getCompactionStateWithPlans',
            'getReplicas', 'describeReplicas',
            'getLoadingProgress', 'getLoadState',
        ]);
        // Known aliases to skip — only skip aliases that DON'T have their own
        // bitable record. Aliases that DO have bitable records are kept.
        this._aliases = new Set([
            'updatePassword', 'dropUser', 'selectRole', 'selectUser',
            'grantRolePrivilege', 'revokeRolePrivilege',
            'showPartitions', 'getPartitionStats',
            'showCollections', 'list_collections', 'getCollectionStats',
            'drop_collection', 'alterCollection',
            'describeReplicas',
            'alterIndex',
            'next', // async iterator protocol method on searchIterator/queryIterator, not a standalone API
            // Note: grantRole, revokeRole, listCollections, hybridSearch,
            // loadCollectionSync, alterDatabaseProperties all have bitable records
        ]);
        // Category overrides for specific methods
        this._categoryOverrides = {
            // useDatabase is in GrpcClient.ts but bitable has it under Database
            'useDatabase': 'Database',
            // runAnalyzer is in GrpcClient.ts but bitable has it under Collections
            'runAnalyzer': 'Collections',
            // createCollection in MilvusClient.ts is the public high-level method
            'createCollection': 'Collections',
        };
    }

    _defaultExcludes() {
        return ['node_modules/**', 'test/**', 'dist/**', 'examples/**', 'docs/**', 'proto/**'];
    }

    async scan() {
        const symbols = [];
        const globalSeen = new Set();

        // Scan gRPC implementation files
        const grpcDir = path.join(this.rootDir, 'milvus', 'grpc');
        const fileCategoryMap = {
            'BaseClient.ts': 'Client',
            'GrpcClient.ts': 'Client',
            'User.ts': 'Authentication',
            'Resource.ts': 'ResourceGroup',
            'Partition.ts': 'Partitions',
            'MilvusIndex.ts': 'Management',
            'Data.ts': 'Vector',         // default; some methods remapped to Management
            'Collection.ts': 'Collections', // default; some methods remapped to Management
            'Database.ts': 'Database',
        };

        for (const [filename, defaultCategory] of Object.entries(fileCategoryMap)) {
            const filePath = path.join(grpcDir, filename);
            if (!fs.existsSync(filePath)) continue;
            const methods = this._extractMethods(filePath, defaultCategory, globalSeen);
            symbols.push(...methods);
        }

        // Scan MilvusClient.ts for high-level methods
        const clientPath = path.join(this.rootDir, 'milvus', 'MilvusClient.ts');
        if (fs.existsSync(clientPath)) {
            const clientMethods = this._extractMethods(clientPath, 'Client', globalSeen);
            symbols.push(...clientMethods);
        }

        // Resolve alias params: copy params from target method
        this._resolveAliasParams(symbols);

        // Remove skipped aliases (kept only for param resolution)
        const filtered = symbols.filter(s => !s._skippedAlias);
        symbols.length = 0;
        symbols.push(...filtered);

        // Scan enums from types
        const enumSymbols = this._extractEnums();
        symbols.push(...enumSymbols);

        // Scan BulkWriter/Data Import public surfaces
        symbols.push(...this._extractDataImportSymbols());

        // Add MilvusClient class symbol
        symbols.push({
            name: 'MilvusClient',
            parentClass: 'Client',
            kind: 'Class',
            docstring: 'The main client class for interacting with Milvus.',
            filePath: 'milvus/MilvusClient.ts',
            lineNumber: 1,
            params: [],
        });

        // Add ResourceGroupConfig type (has a bitable record)
        symbols.push({
            name: 'ResourceGroupConfig',
            parentClass: 'ResourceGroup',
            kind: 'Function',
            docstring: 'Configuration type for resource groups.',
            filePath: 'milvus/types/Resource.ts',
            lineNumber: 8,
            params: [],
        });

        return symbols;
    }

    _extractMethods(filePath, defaultCategory, globalSeen) {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        const relPath = path.relative(this.rootDir, filePath);
        const methods = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Match async method declarations: `async methodName(`
            const methodMatch = line.match(/^\s+async\s+(\w+)\s*[(<]/);
            // Match non-async named methods: `  connect(sdkVersion: string) {`
            const syncMatch = !methodMatch && line.match(/^\s{2}(\w+)\s*\([^)]*\)\s*[:{]/);
            // Match alias assignments: `  grantRole = this.addUserToRole;`
            const aliasMatch = !methodMatch && !syncMatch && line.match(/^\s{2}(\w+)\s*=\s*this\.(\w+);/);
            const match = methodMatch || syncMatch || aliasMatch;
            if (!match) continue;

            const name = match[1];

            // Skip constructors and common JS patterns
            if (['constructor', 'if', 'for', 'while', 'switch', 'return', 'throw',
                 'catch', 'try', 'new', 'super'].includes(name)) continue;

            // Skip private methods
            if (name.startsWith('_')) continue;

            // Skip known aliases (but still extract params for resolution by other aliases)
            if (this._aliases.has(name)) {
                const params = this._extractParams(lines, i);
                methods.push({
                    name,
                    parentClass: defaultCategory,
                    kind: 'Function',
                    docstring: '',
                    filePath: relPath,
                    lineNumber: i + 1,
                    params,
                    _skippedAlias: true,
                });
                continue;
            }

            // Skip duplicate names across all files
            if (globalSeen.has(name)) continue;
            globalSeen.add(name);

            // Determine category
            let category = this._categoryOverrides[name] || defaultCategory;

            // Remap Data.ts management methods
            if (defaultCategory === 'Vector' && this._dataManagementMethods.has(name)) {
                category = 'Management';
            }
            // Remap Collection.ts management methods
            if (defaultCategory === 'Collections' && this._collectionManagementMethods.has(name)) {
                category = 'Management';
            }

            // Extract JSDoc comment above
            const docstring = this._extractJsDoc(lines, i);

            // Extract parameters
            const params = this._extractParams(lines, i);

            const symbol = {
                name,
                parentClass: category,
                kind: 'Function',
                docstring,
                filePath: relPath,
                lineNumber: i + 1,
                params,
            };

            // For alias assignments, store the target method name for param resolution
            if (aliasMatch) {
                symbol.aliasOf = aliasMatch[2];
            }

            methods.push(symbol);
        }

        return methods;
    }

    /**
     * Resolve alias params by copying from the target method.
     * e.g., `hybridSearch = this.search;` → copy search's params to hybridSearch
     */
    _resolveAliasParams(symbols) {
        const byName = new Map();
        for (const s of symbols) {
            byName.set(s.name, s);
        }

        for (const s of symbols) {
            if (s.aliasOf && (!s.params || s.params.length === 0)) {
                const target = byName.get(s.aliasOf);
                if (target && target.params && target.params.length > 0) {
                    s.params = [...target.params];
                }
            }
        }
    }

    _extractJsDoc(lines, methodLine) {
        // Walk backwards from method line to find /** ... */
        let endLine = -1;
        for (let i = methodLine - 1; i >= Math.max(0, methodLine - 5); i--) {
            const trimmed = lines[i].trim();
            if (trimmed.endsWith('*/')) {
                endLine = i;
                break;
            }
            if (trimmed && !trimmed.startsWith('*') && !trimmed.startsWith('//') && !trimmed.startsWith('@')) {
                break;
            }
        }
        if (endLine < 0) return '';

        let startLine = -1;
        for (let i = endLine; i >= Math.max(0, endLine - 30); i--) {
            if (lines[i].trim().startsWith('/**')) {
                startLine = i;
                break;
            }
        }
        if (startLine < 0) return '';

        const docLines = [];
        for (let i = startLine; i <= endLine; i++) {
            let line = lines[i].trim();
            line = line.replace(/^\/\*\*\s*/, '').replace(/\*\/\s*$/, '').replace(/^\*\s?/, '').trim();
            if (line && !line.startsWith('@')) {
                docLines.push(line);
            }
        }

        return docLines.join('\n');
    }

    _extractParams(lines, methodLine) {
        // Simple extraction of parameters from method signature
        const params = [];
        let braceDepth = 0;
        let paramStr = '';

        for (let i = methodLine; i < Math.min(lines.length, methodLine + 10); i++) {
            paramStr += lines[i];
            for (const ch of lines[i]) {
                if (ch === '(') braceDepth++;
                if (ch === ')') braceDepth--;
                if (braceDepth <= 0 && ch === ')') break;
            }
            if (braceDepth <= 0) break;
        }

        // Resolve generic constraints: `method<T extends Foo | Bar>(param: T)`
        // → treat param type as the first constraint type (e.g., Foo)
        const genericMap = {};
        const genericMatch = paramStr.match(/<(\w+)\s+extends\s+([^>]+)>/);
        if (genericMatch) {
            const typeVar = genericMatch[1];
            const constraint = genericMatch[2].split('|')[0].trim();
            genericMap[typeVar] = constraint;
        }

        // Extract content between first ( and matching )
        const match = paramStr.match(/\(([^)]*)\)/);
        if (match) {
            const inner = match[1].trim();
            if (inner) {
                // Split by comma, extract name: type
                const parts = inner.split(',').map(p => p.trim()).filter(Boolean);
                for (const part of parts) {
                    const pm = part.match(/(\w+)\s*[?:]?\s*:?\s*(.*)/);
                    if (pm) {
                        let type = pm[2] || 'any';
                        // Resolve generic type vars to their constraints
                        if (genericMap[type]) type = genericMap[type];
                        const param = { name: pm[1], type };
                        const typeDetail = this._describeType(type);
                        if (typeDetail) param.typeDetail = typeDetail;
                        params.push(param);
                    }
                }
            }
        }

        return params;
    }

    _describeType(type, seen = new Set()) {
        const name = this._baseTypeName(type);
        if (!name || seen.has(name)) return null;
        const index = this._loadTypeIndex();
        const entry = index.get(name);
        if (!entry) return null;
        const nextSeen = new Set(seen);
        nextSeen.add(name);

        if (entry.kind === 'enum') {
            return {
                name,
                kind: 'enum',
                values: entry.values,
            };
        }

        const detail = {
            name,
            kind: entry.kind,
            fields: entry.fields.map((field) => {
                const item = { ...field };
                const elementName = this._arrayElementTypeName(field.type);
                if (elementName) {
                    const elementType = this._describeType(elementName, nextSeen);
                    if (elementType) item.elementType = elementType;
                } else {
                    const fieldType = this._describeType(field.type, nextSeen);
                    if (fieldType) item.typeDetail = fieldType;
                }
                return item;
            }),
        };
        return detail;
    }

    _baseTypeName(type) {
        if (!type) return null;
        const value = String(type).trim();
        const array = this._arrayElementTypeName(value);
        const candidate = array || value;
        const match = candidate.match(/^([A-Za-z_$][\w$]*)$/);
        return match ? match[1] : null;
    }

    _arrayElementTypeName(type) {
        const match = String(type || '').trim().match(/^([A-Za-z_$][\w$]*)\[\]$/);
        return match ? match[1] : null;
    }

    _loadTypeIndex() {
        if (this._typeIndex) return this._typeIndex;
        const index = new Map();
        const candidates = [
            path.join(this.rootDir, 'milvus', 'const', 'milvus.ts'),
            path.join(this.rootDir, 'milvus', 'types'),
            path.join(this.rootDir, 'milvus', 'bulkwriter', 'Types.ts'),
        ];

        for (const candidate of candidates) {
            if (!fs.existsSync(candidate)) continue;
            const stat = fs.statSync(candidate);
            const files = stat.isDirectory()
                ? fs.readdirSync(candidate)
                    .filter((name) => name.endsWith('.ts'))
                    .map((name) => path.join(candidate, name))
                : [candidate];
            for (const file of files) {
                this._indexTypesFromFile(file, index);
            }
        }

        this._typeIndex = index;
        return this._typeIndex;
    }

    _indexTypesFromFile(file, index) {
        const content = fs.readFileSync(file, 'utf8');
        for (const entry of this._extractExportedBlocks(content, 'interface')) {
            index.set(entry.name, {
                kind: 'interface',
                fields: this._parseObjectFields(entry.body),
            });
        }
        for (const entry of this._extractExportedBlocks(content, 'enum')) {
            index.set(entry.name, {
                kind: 'enum',
                values: entry.body
                    .split(',')
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((line) => line.replace(/\/\/.*$/, '').trim())
                    .filter(Boolean)
                    .map((line) => line.split('=')[0].trim())
                    .filter(Boolean),
            });
        }
        for (const alias of this._extractTypeAliases(content)) {
            const fields = this._parseObjectFields(alias.body);
            if (fields.length > 0) {
                index.set(alias.name, {
                    kind: 'type',
                    fields,
                });
            }
        }
    }

    _extractExportedBlocks(content, kind) {
        const blocks = [];
        const regex = new RegExp(`export\\s+${kind}\\s+(\\w+)[^{]*\\{`, 'g');
        let match;
        while ((match = regex.exec(content))) {
            const open = content.indexOf('{', match.index);
            const close = this._matchingBrace(content, open);
            if (close < 0) continue;
            blocks.push({
                name: match[1],
                body: content.slice(open + 1, close),
            });
            regex.lastIndex = close + 1;
        }
        return blocks;
    }

    _extractTypeAliases(content) {
        const aliases = [];
        const regex = /export\s+type\s+(\w+)\s*=/g;
        let match;
        while ((match = regex.exec(content))) {
            const start = regex.lastIndex;
            const end = this._findTypeAliasEnd(content, start);
            aliases.push({
                name: match[1],
                body: content.slice(start, end),
            });
            regex.lastIndex = end + 1;
        }
        return aliases;
    }

    _findTypeAliasEnd(content, start) {
        let braceDepth = 0;
        for (let i = start; i < content.length; i++) {
            const ch = content[i];
            if (ch === '{') braceDepth++;
            else if (ch === '}') braceDepth--;
            else if (ch === ';' && braceDepth === 0) return i;
        }
        return content.length;
    }

    _matchingBrace(content, open) {
        let depth = 0;
        for (let i = open; i < content.length; i++) {
            if (content[i] === '{') depth++;
            else if (content[i] === '}') {
                depth--;
                if (depth === 0) return i;
            }
        }
        return -1;
    }

    _parseObjectFields(body) {
        const fields = [];
        const fieldRegex = /^\s*([A-Za-z_$][\w$]*)\s*(\?)?\s*:\s*([^;,\n]+)[;,]?/gm;
        let match;
        while ((match = fieldRegex.exec(body))) {
            fields.push({
                name: match[1],
                optional: match[2] === '?',
                type: match[3].trim(),
            });
        }
        return fields;
    }

    _extractEnums() {
        const symbols = [];
        const enumDefs = [
            { name: 'DataType', category: 'Collections', file: 'milvus/const/milvus.ts' },
            { name: 'IndexType', category: 'Management', file: 'milvus/const/milvus.ts' },
            { name: 'MetricType', category: 'Management', file: 'milvus/const/milvus.ts' },
            { name: 'FunctionType', category: 'Collections', file: 'milvus/const/milvus.ts' },
        ];

        for (const { name, category, file } of enumDefs) {
            const fullPath = path.join(this.rootDir, file);
            if (!fs.existsSync(fullPath)) continue;

            const content = fs.readFileSync(fullPath, 'utf8');
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
                if (lines[i].match(new RegExp(`\\benum\\s+${name}\\b`))) {
                    symbols.push({
                        name,
                        parentClass: category,
                        kind: 'Enum',
                        docstring: `${name} enumeration.`,
                        filePath: file,
                        lineNumber: i + 1,
                        params: [],
                    });
                    break;
                }
            }
        }

        return symbols;
    }

    _extractDataImportSymbols() {
        const symbols = [];
        const bulkWriterDir = path.join(this.rootDir, 'milvus', 'bulkwriter');
        if (!fs.existsSync(bulkWriterDir)) return symbols;

        const pushClass = ({ name, sourceName = name, file, docstring }) => {
            const fullPath = path.join(bulkWriterDir, file);
            if (!fs.existsSync(fullPath)) return;
            const content = fs.readFileSync(fullPath, 'utf8');
            const lines = content.split('\n');
            const classLine = lines.findIndex((line) => line.match(new RegExp(`\\bexport\\s+class\\s+${sourceName}\\b`)));
            if (classLine < 0) return;
            const open = content.indexOf('{', content.indexOf(`class ${sourceName}`));
            const close = open >= 0 ? this._matchingBrace(content, open) : -1;
            const body = close > open ? content.slice(open + 1, close) : '';
            symbols.push({
                name,
                parentClass: 'DataImport',
                kind: 'Class',
                docstring,
                filePath: path.join('milvus', 'bulkwriter', file),
                lineNumber: classLine + 1,
                params: [],
                methods: this._extractClassMethods(body),
                bodyHash: this._bodyFingerprint(content),
                relatedFiles: ['docs/content/operations/bulk-writer.mdx'],
            });
        };

        pushClass({
            name: 'BulkWriter',
            file: 'BulkWriter.ts',
            docstring: 'Writes collection rows to import-ready local or remote files.',
        });
        pushClass({
            name: 'Formatter',
            sourceName: 'ParquetFormatter',
            file: 'ParquetFormatter.ts',
            docstring: 'Formats buffered BulkWriter rows as Parquet import files.',
        });

        const typesPath = path.join(bulkWriterDir, 'Types.ts');
        if (fs.existsSync(typesPath)) {
            const content = fs.readFileSync(typesPath, 'utf8');
            const lines = content.split('\n');
            for (const typeName of ['Storage', 'BulkWriterSchema', 'BulkWriterOptions']) {
                const entry = this._extractExportedBlocks(content, 'interface')
                    .find((item) => item.name === typeName);
                if (!entry) continue;
                const lineNumber = lines.findIndex((line) => line.match(new RegExp(`\\binterface\\s+${typeName}\\b`))) + 1;
                symbols.push({
                    name: typeName,
                    parentClass: 'DataImport',
                    kind: 'Interface',
                    docstring: `${typeName} interface for BulkWriter data import.`,
                    filePath: 'milvus/bulkwriter/Types.ts',
                    lineNumber: lineNumber || 1,
                    params: [],
                    fields: this._parseObjectFields(entry.body),
                    bodyHash: this._bodyFingerprint(entry.body),
                    relatedFiles: ['docs/content/operations/bulk-writer.mdx'],
                });
            }
        }

        return symbols;
    }

    _extractClassMethods(body) {
        const methods = [];
        const methodRegex = /^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*:?\s*([^{;\n]*)\{/gm;
        let match;
        while ((match = methodRegex.exec(body))) {
            const name = match[1];
            if (['if', 'for', 'while', 'switch', 'catch'].includes(name)) continue;
            if (name.startsWith('_')) continue;
            methods.push({
                name,
                params: match[2].trim(),
                returnType: match[3].trim(),
            });
        }
        return methods;
    }

    _bodyFingerprint(body) {
        if (!body) return null;
        const normalized = body
            .split('\n')
            .map((line) => line.replace(/\/\/.*$/, '').trim())
            .filter(Boolean)
            .join('\n');
        if (!normalized) return null;
        return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
    }
}

module.exports = NodeScanner;

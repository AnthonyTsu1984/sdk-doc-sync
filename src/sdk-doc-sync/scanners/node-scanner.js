const fs = require('fs');
const path = require('path');
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
                        params.push({ name: pm[1], type });
                    }
                }
            }
        }

        return params;
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
}

module.exports = NodeScanner;

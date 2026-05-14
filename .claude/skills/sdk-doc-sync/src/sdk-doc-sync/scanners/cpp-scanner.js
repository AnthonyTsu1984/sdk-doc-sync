const fs = require('fs');
const path = require('path');
const BaseScanner = require('./base-scanner');

// Category assignment for all 91 methods (90 virtual + 1 static Create)
const METHOD_CATEGORIES = {
    // Client (10)
    Create: 'Client',
    Connect: 'Client',
    Disconnect: 'Client',
    SetRpcDeadlineMs: 'Client',
    SetRetryParam: 'Client',
    GetServerVersion: 'Client',
    GetSDKVersion: 'Client',
    CheckHealth: 'Client',
    UseDatabase: 'Client',
    CurrentUsedDatabase: 'Client',

    // Collections (18)
    CreateCollection: 'Collections',
    CreateSimpleCollection: 'Collections',
    HasCollection: 'Collections',
    DropCollection: 'Collections',
    DescribeCollection: 'Collections',
    RenameCollection: 'Collections',
    GetCollectionStats: 'Collections',
    ListCollections: 'Collections',
    AlterCollectionProperties: 'Collections',
    DropCollectionProperties: 'Collections',
    AlterCollectionFieldProperties: 'Collections',
    DropCollectionFieldProperties: 'Collections',
    AddCollectionField: 'Collections',
    CreateAlias: 'Collections',
    DropAlias: 'Collections',
    AlterAlias: 'Collections',
    DescribeAlias: 'Collections',
    ListAliases: 'Collections',

    // Database (6)
    CreateDatabase: 'Database',
    DropDatabase: 'Database',
    ListDatabases: 'Database',
    AlterDatabaseProperties: 'Database',
    DropDatabaseProperties: 'Database',
    DescribeDatabase: 'Database',

    // Management (15)
    LoadCollection: 'Management',
    ReleaseCollection: 'Management',
    GetLoadState: 'Management',
    CreateIndex: 'Management',
    DescribeIndex: 'Management',
    ListIndexes: 'Management',
    DropIndex: 'Management',
    AlterIndexProperties: 'Management',
    DropIndexProperties: 'Management',
    Flush: 'Management',
    ListPersistentSegments: 'Management',
    ListQuerySegments: 'Management',
    Compact: 'Management',
    GetCompactionState: 'Management',
    GetCompactionPlans: 'Management',

    // Partitions (7)
    CreatePartition: 'Partitions',
    DropPartition: 'Partitions',
    HasPartition: 'Partitions',
    LoadPartitions: 'Partitions',
    ReleasePartitions: 'Partitions',
    GetPartitionStatistics: 'Partitions',
    ListPartitions: 'Partitions',

    // Vector (10)
    Insert: 'Vector',
    Upsert: 'Vector',
    Delete: 'Vector',
    Search: 'Vector',
    SearchIterator: 'Vector',
    Query: 'Vector',
    Get: 'Vector',
    QueryIterator: 'Vector',
    HybridSearch: 'Vector',
    RunAnalyzer: 'Vector',

    // Authentication (18)
    CreateUser: 'Authentication',
    UpdatePassword: 'Authentication',
    DropUser: 'Authentication',
    DescribeUser: 'Authentication',
    ListUsers: 'Authentication',
    CreateRole: 'Authentication',
    DropRole: 'Authentication',
    DescribeRole: 'Authentication',
    ListRoles: 'Authentication',
    GrantRole: 'Authentication',
    RevokeRole: 'Authentication',
    GrantPrivilegeV2: 'Authentication',
    RevokePrivilegeV2: 'Authentication',
    CreatePrivilegeGroup: 'Authentication',
    DropPrivilegeGroup: 'Authentication',
    ListPrivilegeGroups: 'Authentication',
    AddPrivilegesToGroup: 'Authentication',
    RemovePrivilegesFromGroup: 'Authentication',

    // ResourceGroup (7)
    CreateResourceGroup: 'ResourceGroup',
    DropResourceGroup: 'ResourceGroup',
    UpdateResourceGroups: 'ResourceGroup',
    TransferNode: 'ResourceGroup',
    TransferReplica: 'ResourceGroup',
    ListResourceGroups: 'ResourceGroup',
    DescribeResourceGroup: 'ResourceGroup',
};

const ENUM_DEFS = [
    { name: 'DataType', category: 'Collections', file: 'types/DataType.h' },
    { name: 'IndexType', category: 'Management', file: 'types/IndexType.h' },
    { name: 'MetricType', category: 'Management', file: 'types/MetricType.h' },
    { name: 'ConsistencyLevel', category: 'Collections', file: 'types/ConsistencyLevel.h' },
    { name: 'LoadState', category: 'Collections', file: 'types/LoadState.h' },
];

class CppScanner extends BaseScanner {
    constructor(opts) {
        super(opts);
        this._includeDir = path.join(this.rootDir, 'src', 'include', 'milvus');
    }

    _defaultExcludes() {
        return ['**/test/**', '**/tests/**', '.git', '**/.git/**'];
    }

    async scan() {
        // Phase 1: Parse MilvusClientV2.h for method declarations
        const clientHeader = path.join(this._includeDir, 'MilvusClientV2.h');
        const content = fs.readFileSync(clientHeader, 'utf-8');
        const relPath = path.relative(this.rootDir, clientHeader);
        const methods = this._extractMethods(content, relPath);

        // Phase 2: Parse request headers for With* params
        this._requestIndex = this._buildRequestIndex();

        for (const method of methods) {
            if (method.requestClass) {
                method.params = this._getRequestParams(method.requestClass);
            } else if (method.directParams && method.directParams.length > 0) {
                method.params = method.directParams;
            }
            delete method.directParams;
        }

        // Phase 3: Extract enums
        const enums = this._extractEnums();

        return [...methods, ...enums];
    }

    // ── Phase 1: Method extraction from MilvusClientV2.h ──────────────

    _extractMethods(content, filePath) {
        const lines = content.split('\n');
        const symbols = [];
        const seenNames = new Set();

        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();

            const isVirtual = trimmed === 'virtual Status';
            const isStatic = trimmed === 'static std::shared_ptr<MilvusClientV2>';

            if (!isVirtual && !isStatic) continue;
            if (i + 1 >= lines.length) continue;

            const nextLine = lines[i + 1].trim();
            const match = nextLine.match(/^(\w+)\(([^)]*)\)/);
            if (!match) continue;

            let name = match[1];
            const paramStr = match[2].trim();

            if (name.startsWith('~')) continue;

            // Disambiguate CreateCollection overloads
            if (name === 'CreateCollection' && seenNames.has('CreateCollection')) {
                name = 'CreateSimpleCollection';
            }

            if (seenNames.has(name)) continue;
            seenNames.add(name);

            // Extract request/response classes
            let requestClass = null;
            let responseClass = null;
            const directParams = [];

            if (paramStr) {
                const parts = paramStr.split(',').map(s => s.trim());
                for (const part of parts) {
                    const reqMatch = part.match(/(?:const\s+)?(\w+Request)\s*&/);
                    if (reqMatch) {
                        requestClass = reqMatch[1];
                        continue;
                    }
                    const resMatch = part.match(/(\w+(?:Response|Ptr))\s*&/);
                    if (resMatch) {
                        responseClass = resMatch[1];
                        continue;
                    }
                    // Plain param (for non-request methods)
                    const plainMatch = part.match(/^((?:const\s+)?[\w:]+(?:<[\w:,\s]+>)?(?:\s*&{0,2})?)\s+(\w+)/);
                    if (plainMatch) {
                        directParams.push({
                            name: plainMatch[2],
                            kind: 'keyword',
                            type: plainMatch[1].trim(),
                            description: '',
                        });
                    }
                }
            }

            const docstring = this._extractDoxygen(lines, i);

            let signature;
            if (isStatic) {
                signature = `static std::shared_ptr<MilvusClientV2> ${name}()`;
            } else {
                signature = paramStr
                    ? `Status ${name}(${paramStr})`
                    : `Status ${name}()`;
            }

            const category = METHOD_CATEGORIES[name];
            if (!category) continue;

            symbols.push({
                name,
                kind: 'method',
                signature,
                docstring,
                params: [],
                directParams,
                filePath,
                lineNumber: i + 2,
                parentClass: category,
                requestClass,
                responseClass,
            });
        }

        return symbols;
    }

    /**
     * Extract @brief text from Doxygen comment block above a line.
     */
    _extractDoxygen(lines, targetLine) {
        const briefs = [];
        let inComment = false;

        for (let j = targetLine - 1; j >= Math.max(0, targetLine - 20); j--) {
            const trimmed = lines[j].trim();

            if (trimmed === '*/') {
                inComment = true;
                continue;
            }

            if (trimmed.startsWith('/**')) {
                const content = trimmed.replace(/^\/\*\*\s*/, '').replace(/\*\/\s*$/, '').trim();
                if (content) briefs.unshift(content);
                break;
            }

            if (inComment) {
                const cleaned = trimmed.replace(/^\*\s?/, '').trim();
                if (cleaned.startsWith('@param') || cleaned.startsWith('@return')) continue;
                if (cleaned.startsWith('@brief')) {
                    briefs.unshift(cleaned.replace('@brief', '').trim());
                } else if (cleaned && !cleaned.startsWith('@')) {
                    briefs.unshift(cleaned);
                }
            }
        }

        return briefs.join(' ').trim() || null;
    }

    // ── Phase 2: Request param extraction ─────────────────────────────

    _buildRequestIndex() {
        const index = {
            classes: new Map(),
            aliases: new Map(),
        };

        const requestDir = path.join(this._includeDir, 'request');
        const typesDir = path.join(this._includeDir, 'types');

        const allFiles = [
            ...this._walkHeaderFiles(requestDir),
            ...this._walkHeaderFiles(typesDir),
        ];

        for (const file of allFiles) {
            const content = fs.readFileSync(file, 'utf-8');

            // Extract class definitions
            const classRegex = /class\s+(\w+)\s*(?::\s*([^{]+))?\s*\{/g;
            let classMatch;
            while ((classMatch = classRegex.exec(content)) !== null) {
                const className = classMatch[1];
                const inheritance = classMatch[2] ? classMatch[2].trim() : '';

                const baseClasses = [];
                if (inheritance) {
                    const baseRegex = /public\s+([\w:]+)(?:<[\w:,\s]+>)?/g;
                    let bm;
                    while ((bm = baseRegex.exec(inheritance)) !== null) {
                        baseClasses.push(bm[1].replace(/::/g, ''));
                    }
                }

                const withMethods = this._extractWithMethods(content);

                index.classes.set(className, {
                    file,
                    baseClasses,
                    withMethods,
                });
            }

            // Extract using aliases
            const usingRegex = /using\s+(\w+)\s*=\s*(\w+)\s*;/g;
            let um;
            while ((um = usingRegex.exec(content)) !== null) {
                index.aliases.set(um[1], um[2]);
            }
        }

        return index;
    }

    _walkHeaderFiles(dir) {
        const results = [];
        if (!fs.existsSync(dir)) return results;
        const walk = (d) => {
            let entries;
            try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
            for (const entry of entries) {
                const full = path.join(d, entry.name);
                if (entry.isDirectory()) walk(full);
                else if (entry.name.endsWith('.h')) results.push(full);
            }
        };
        walk(dir);
        return results;
    }

    /**
     * Extract With* and Add* method declarations from header content.
     * Matches the two-line pattern: ReturnType&\nWithFoo(params)
     */
    _extractWithMethods(content) {
        const methods = [];
        const lines = content.split('\n');
        const seen = new Set();

        for (let i = 0; i < lines.length - 1; i++) {
            const trimmed = lines[i].trim();

            // Line must be a return type ending with &
            if (!trimmed.match(/&\s*$/)) continue;

            const nextTrimmed = lines[i + 1].trim();
            const match = nextTrimmed.match(/^(With\w+|Add\w+)\s*\(([^)]*)\)/);
            if (!match) continue;

            const methodName = match[1];
            if (seen.has(methodName)) continue;
            seen.add(methodName);

            const argStr = match[2].trim();

            // Parse parameter type and argument name
            let paramType = '';
            let argName = '';
            if (argStr) {
                const firstParam = argStr.split(',')[0].trim();
                const typeMatch = firstParam.match(/^((?:const\s+)?[\w:]+(?:<[\w:,\s]+>)?(?:\s*&{0,2})?)\s+(\w+)/);
                if (typeMatch) {
                    paramType = typeMatch[1].trim();
                    argName = typeMatch[2];
                }
            }

            // Full arg string for multi-param methods (e.g., AddExtraParam(key, value))
            const fullArgStr = argStr;

            const description = this._extractDoxygen(lines, i);

            methods.push({
                name: methodName,
                kind: 'keyword',
                type: paramType,
                argName,
                fullArgStr,
                description: description || '',
            });
        }

        return methods;
    }

    /**
     * Get all With/Add params for a request class, including inherited ones.
     */
    _getRequestParams(requestClassName) {
        const { classes, aliases } = this._requestIndex;

        // Resolve alias chain
        let resolved = requestClassName;
        const visited = new Set();
        while (aliases.has(resolved) && !visited.has(resolved)) {
            visited.add(resolved);
            resolved = aliases.get(resolved);
        }

        return this._collectParams(resolved, new Set());
    }

    _collectParams(className, visited) {
        if (visited.has(className)) return [];
        visited.add(className);

        const { classes } = this._requestIndex;
        const classInfo = classes.get(className);
        if (!classInfo) return [];

        const allParams = new Map();

        // Base class params first
        for (const baseName of classInfo.baseClasses) {
            const baseParams = this._collectParams(baseName, visited);
            for (const p of baseParams) {
                allParams.set(p.name, p);
            }
        }

        // This class's params override base
        for (const p of classInfo.withMethods) {
            allParams.set(p.name, p);
        }

        return Array.from(allParams.values());
    }

    // ── Phase 3: Enum extraction ──────────────────────────────────────

    _extractEnums() {
        const symbols = [];

        for (const { name, category, file } of ENUM_DEFS) {
            const fullPath = path.join(this._includeDir, file);
            if (!fs.existsSync(fullPath)) continue;

            const content = fs.readFileSync(fullPath, 'utf-8');
            const relPath = path.relative(this.rootDir, fullPath);

            // Extract enum body
            const enumMatch = content.match(new RegExp(`enum\\s+class\\s+${name}\\s*\\{([^}]+)\\}`));
            if (!enumMatch) continue;

            const body = enumMatch[1];
            const values = [];
            for (const line of body.split('\n')) {
                const valMatch = line.match(/^\s*(\w+)\s*=\s*(-?\d+)/);
                if (valMatch) {
                    // Extract inline comment if present
                    const commentMatch = line.match(/\/\/\s*(.+)/);
                    values.push({
                        name: valMatch[1],
                        value: valMatch[2],
                        comment: commentMatch ? commentMatch[1].trim() : '',
                    });
                }
            }

            const valStr = values.map(v => `    ${v.name} = ${v.value}`).join(',\n');
            const signature = `enum class ${name} {\n${valStr}\n}`;

            // Extract @brief from above enum declaration
            const lines = content.split('\n');
            let docstring = null;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].match(new RegExp(`enum\\s+class\\s+${name}`))) {
                    docstring = this._extractDoxygen(lines, i);
                    break;
                }
            }

            symbols.push({
                name,
                kind: 'enum',
                signature,
                docstring,
                params: values,
                filePath: relPath,
                lineNumber: 1,
                parentClass: category,
                requestClass: null,
                responseClass: null,
            });
        }

        return symbols;
    }
}

module.exports = CppScanner;

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const BaseScanner = require('./base-scanner');
const CppTypeGraph = require('./cpp-type-graph');

// Category assignment for public MilvusClientV2 methods.
const METHOD_CATEGORIES = {
    // Client (10)
    Create: 'Client',
    Connect: 'Client',
    Disconnect: 'Client',
    SetRpcDeadlineMs: 'Client',
    SetRetryParam: 'Client',
    Session: 'Client',
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
    AddCollectionStructField: 'Collections',
    AddCollectionFunction: 'Collections',
    AddFunctionField: 'Collections',
    AlterCollectionFunction: 'Collections',
    BatchDescribeCollections: 'Collections',
    DescribeReplicas: 'Collections',
    DropCollectionFunction: 'Collections',
    DropCollectionField: 'Collections',
    DropFunctionField: 'Collections',
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
    RefreshLoad: 'Management',
    CreateIndex: 'Management',
    DescribeIndex: 'Management',
    ListIndexes: 'Management',
    DropIndex: 'Management',
    AlterIndexProperties: 'Management',
    DropIndexProperties: 'Management',
    Flush: 'Management',
    FlushAll: 'Management',
    GetFlushAllState: 'Management',
    ListPersistentSegments: 'Management',
    ListQuerySegments: 'Management',
    Compact: 'Management',
    Optimize: 'Management',
    GetCompactionState: 'Management',
    GetCompactionPlans: 'Management',

    // CDC (3)
    GetReplicateConfiguration: 'CDC',
    UpdateReplicateConfiguration: 'CDC',
    GetReplicateInfo: 'CDC',
    DumpMessages: 'CDC',

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
    UpdateUser: 'Authentication',
    DropUser: 'Authentication',
    DescribeUser: 'Authentication',
    ListUsers: 'Authentication',
    CreateRole: 'Authentication',
    AlterRole: 'Authentication',
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
    { name: 'SegmentLevel', category: 'Management', file: 'types/SegmentInfo.h' },
    { name: 'FunctionType', category: 'Collections', file: 'types/FunctionType.h' },
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

        const bulkImportHeader = path.join(this._includeDir, 'BulkImport.h');
        if (fs.existsSync(bulkImportHeader)) {
            methods.push(...this._extractBulkImportMethods(
                fs.readFileSync(bulkImportHeader, 'utf-8'),
                path.relative(this.rootDir, bulkImportHeader),
            ));
        }

        // Phase 2: Build the public request/response/type graph once.
        this._typeGraph = new CppTypeGraph({ rootDir: this.rootDir, includeDir: this._includeDir });

        for (const method of methods) {
            if (method.requestClass) {
                method.params = this._getRequestParams(method.requestClass);
            } else if (method.directParams && method.directParams.length > 0) {
                method.params = method.directParams;
            }
            const embeddedTypes = this._typeGraph.embeddedTypesFor([
                method.requestClass,
                method.responseClass,
                ...(method.directParams || []).map((param) => param.type),
            ]);
            if (embeddedTypes.length > 0) {
                method.embeddedTypes = embeddedTypes;
                method.relatedFiles = [...new Set(embeddedTypes.flatMap((type) => [
                    type.filePath,
                    ...(type.relatedFiles || []),
                ]))].sort();
            }
            delete method.directParams;
        }

        this._attachImplementationHashes(methods);

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

            const isVirtual = /^(?:\[\[deprecated\([^\]]*\)\]\]\s+)?virtual Status$/.test(trimmed);
            const isStatic = trimmed === 'static std::shared_ptr<MilvusClientV2>';

            if (!isVirtual && !isStatic) continue;
            const declarationLines = [];
            for (let j = i + 1; j < lines.length; j++) {
                declarationLines.push(lines[j].trim());
                if (lines[j].includes(';')) break;
            }

            const declaration = declarationLines.join(' ').replace(/\s+/g, ' ');
            const match = declaration.match(/^(\w+)\s*\(([\s\S]*)\)\s*(?:=\s*0)?\s*;/);
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
                const parts = this._splitParameters(paramStr);
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
                decorators: trimmed.startsWith('[[deprecated') ? ['deprecated'] : [],
            });
        }

        return symbols;
    }

    _extractBulkImportMethods(content, filePath) {
        const lines = content.split('\n');
        const symbols = [];
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() !== 'static nlohmann::json') continue;
            const declarationLines = [];
            for (let j = i + 1; j < lines.length; j++) {
                declarationLines.push(lines[j].trim());
                if (lines[j].includes(';')) break;
            }
            const declaration = declarationLines.join(' ').replace(/\s+/g, ' ');
            const match = declaration.match(/^(\w+)\s*\(([\s\S]*)\)\s*;/);
            if (!match) continue;
            const name = match[1];
            const paramStr = match[2].trim();
            const params = [];
            for (const part of this._splitParameters(paramStr)) {
                const withoutDefault = part.replace(/\s*=\s*[\s\S]*$/, '').trim();
                const plainMatch = withoutDefault.match(/^((?:const\s+)?[\w:]+(?:<[^>]+>)?(?:\s*&{0,2})?)\s+(\w+)$/);
                if (!plainMatch) continue;
                params.push({
                    name: plainMatch[2],
                    kind: 'keyword',
                    type: plainMatch[1].trim(),
                    description: '',
                });
            }
            symbols.push({
                name,
                kind: 'method',
                signature: `static nlohmann::json ${name}(${paramStr})`,
                docstring: this._extractDoxygen(lines, i),
                params,
                filePath,
                lineNumber: i + 2,
                parentClass: 'DataImport',
                requestClass: null,
                responseClass: null,
                decorators: [],
            });
        }
        return symbols;
    }

    _splitParameters(value) {
        const parts = [];
        let start = 0;
        let angleDepth = 0;
        let parenDepth = 0;
        let quote = null;
        let escaped = false;
        for (let i = 0; i < value.length; i++) {
            const char = value[i];
            if (quote) {
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === quote) quote = null;
                continue;
            }
            if (char === '"' || char === "'") {
                quote = char;
                continue;
            }
            if (char === '<') angleDepth++;
            else if (char === '>' && angleDepth > 0) angleDepth--;
            else if (char === '(') parenDepth++;
            else if (char === ')' && parenDepth > 0) parenDepth--;
            else if (char === ',' && angleDepth === 0 && parenDepth === 0) {
                parts.push(value.slice(start, i).trim());
                start = i + 1;
            }
        }
        const tail = value.slice(start).trim();
        if (tail) parts.push(tail);
        return parts;
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

    _attachImplementationHashes(methods) {
        const implFile = path.join(this.rootDir, 'src', 'impl', 'MilvusClientV2Impl.cpp');
        if (!fs.existsSync(implFile)) return;

        const content = fs.readFileSync(implFile, 'utf-8');
        const relPath = path.relative(this.rootDir, implFile).replace(/\\/g, '/');
        for (const method of methods) {
            const body = this._extractImplementationBody(content, method.name);
            if (!body) continue;
            method.bodyHash = crypto
                .createHash('sha256')
                .update(body.replace(/\s+/g, ' ').trim())
                .digest('hex')
                .slice(0, 16);
            method.relatedFiles = [...new Set([...(method.relatedFiles || []), relPath])];
        }
    }

    _extractImplementationBody(content, methodName) {
        const marker = `MilvusClientV2Impl::${methodName}`;
        const methodIndex = content.indexOf(marker);
        if (methodIndex === -1) return null;

        const bodyStart = content.indexOf('{', methodIndex);
        if (bodyStart === -1) return null;

        let depth = 0;
        for (let i = bodyStart; i < content.length; i++) {
            if (content[i] === '{') depth++;
            else if (content[i] === '}') {
                depth--;
                if (depth === 0) return content.slice(bodyStart, i + 1);
            }
        }
        return null;
    }

    // ── Phase 2: Request param extraction ─────────────────────────────

    _getRequestParams(requestClassName) {
        return this._typeGraph.requestParamsFor(requestClassName);
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

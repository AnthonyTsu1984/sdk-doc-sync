const fs = require('fs');
const path = require('path');
const BaseScanner = require('./base-scanner');

// Category assignment for 86 methods
const METHOD_CATEGORIES = {
    // Client (3)
    New: 'Client',
    Close: 'Client',
    GetServerVersion: 'Client',

    // Collections (16)
    CreateCollection: 'Collections',
    ListCollections: 'Collections',
    DescribeCollection: 'Collections',
    HasCollection: 'Collections',
    DropCollection: 'Collections',
    RenameCollection: 'Collections',
    AlterCollectionProperties: 'Collections',
    DropCollectionProperties: 'Collections',
    AlterCollectionFieldProperty: 'Collections',
    GetCollectionStats: 'Collections',
    AddCollectionField: 'Collections',
    CreateAlias: 'Collections',
    DescribeAlias: 'Collections',
    DropAlias: 'Collections',
    AlterAlias: 'Collections',
    ListAliases: 'Collections',

    // Database (7)
    UseDatabase: 'Database',
    ListDatabase: 'Database',
    CreateDatabase: 'Database',
    DropDatabase: 'Database',
    DescribeDatabase: 'Database',
    AlterDatabaseProperties: 'Database',
    DropDatabaseProperties: 'Database',

    // Management (16)
    CreateIndex: 'Management',
    ListIndexes: 'Management',
    DescribeIndex: 'Management',
    DropIndex: 'Management',
    AlterIndexProperties: 'Management',
    DropIndexProperties: 'Management',
    LoadCollection: 'Management',
    LoadPartitions: 'Management',
    GetLoadState: 'Management',
    ReleaseCollection: 'Management',
    ReleasePartitions: 'Management',
    RefreshLoad: 'Management',
    Flush: 'Management',
    Compact: 'Management',
    GetCompactionState: 'Management',
    GetPersistentSegmentInfo: 'Management',

    // Partitions (5)
    CreatePartition: 'Partitions',
    DropPartition: 'Partitions',
    HasPartition: 'Partitions',
    ListPartitions: 'Partitions',
    GetPartitionStats: 'Partitions',

    // Vector (10)
    Search: 'Vector',
    Query: 'Vector',
    Get: 'Vector',
    HybridSearch: 'Vector',
    RunAnalyzer: 'Vector',
    Insert: 'Vector',
    Delete: 'Vector',
    Upsert: 'Vector',
    SearchIterator: 'Vector',
    QueryIterator: 'Vector',

    // Authentication (22)
    ListUsers: 'Authentication',
    DescribeUser: 'Authentication',
    CreateUser: 'Authentication',
    UpdatePassword: 'Authentication',
    DropUser: 'Authentication',
    ListRoles: 'Authentication',
    CreateRole: 'Authentication',
    GrantRole: 'Authentication',
    RevokeRole: 'Authentication',
    DropRole: 'Authentication',
    DescribeRole: 'Authentication',
    GrantPrivilege: 'Authentication',
    RevokePrivilege: 'Authentication',
    CreatePrivilegeGroup: 'Authentication',
    DropPrivilegeGroup: 'Authentication',
    ListPrivilegeGroups: 'Authentication',
    AddPrivilegesToGroup: 'Authentication',
    RemovePrivilegesFromGroup: 'Authentication',
    GrantPrivilegeV2: 'Authentication',
    RevokePrivilegeV2: 'Authentication',
    BackupRBAC: 'Authentication',
    RestoreRBAC: 'Authentication',

    // ResourceGroup (7)
    ListResourceGroups: 'ResourceGroup',
    CreateResourceGroup: 'ResourceGroup',
    DropResourceGroup: 'ResourceGroup',
    DescribeResourceGroup: 'ResourceGroup',
    UpdateResourceGroup: 'ResourceGroup',
    TransferReplica: 'ResourceGroup',
    DescribeReplica: 'ResourceGroup',
};

// Methods to skip
const SKIP_METHODS = new Set([
    'GetService',
    'OperatePrivilegeGroup',
    'GrantV2',
    'RevokeV2',
    'MetadataUnaryInterceptor',
    'UpdateReplicateConfiguration',
    'GetReplicateInfo',
    'CreateReplicateStream',
    // Internal/private methods
    'dialOptions',
    'parseAuthentication',
    'usingDatabase',
    'setIdentifier',
    'connect',
    'connectInternal',
    'callService',
    'handleSearchResult',
    'parseSearchResult',
    'getCollection',
    'retryIfSchemaError',
    'metadata',
    'state',
    'extraInfo',
]);

// Entity type definitions: { name, category, pkg, file, kind, docstring }
// pkg: 'entity' = client/entity/, 'index' = client/index/, 'milvusclient' = client/milvusclient/
const ENTITY_DEFS = [
    // Collections
    { name: 'Schema', category: 'Collections', pkg: 'entity', file: 'schema.go', kind: 'struct', docstring: 'Represents the schema of a collection, including field definitions, functions, and dynamic field settings.' },
    { name: 'Field', category: 'Collections', pkg: 'entity', file: 'field.go', kind: 'struct', docstring: 'Defines a field in a collection schema, including its data type, constraints, and indexing properties.' },
    { name: 'FieldType', category: 'Collections', pkg: 'entity', file: 'field.go', kind: 'enum', docstring: 'Enumerates the supported data types for collection fields.' },
    { name: 'Collection', category: 'Collections', pkg: 'entity', file: 'collection.go', kind: 'struct', docstring: 'Represents a collection description returned by DescribeCollection, including schema, shards, and properties.' },
    { name: 'Alias', category: 'Collections', pkg: 'entity', file: 'alias.go', kind: 'struct', docstring: 'Represents a collection alias with its associated database and collection name.' },
    { name: 'Function', category: 'Collections', pkg: 'entity', file: 'function.go', kind: 'struct', docstring: 'Defines a built-in function (e.g., BM25, text embedding) that can be attached to a collection schema.' },
    { name: 'ConsistencyLevel', category: 'Collections', pkg: 'entity', file: 'schema.go', kind: 'enum', docstring: 'Specifies the consistency guarantee level for read operations on a collection.' },

    // Database
    { name: 'Database', category: 'Database', pkg: 'entity', file: 'database.go', kind: 'struct', docstring: 'Represents a database description returned by DescribeDatabase, including custom properties.' },

    // Management
    { name: 'IndexDescription', category: 'Management', pkg: 'milvusclient', file: 'index.go', kind: 'struct', docstring: 'Describes an index including its type, parameters, build state, and row counts.' },
    { name: 'CreateIndexTask', category: 'Management', pkg: 'milvusclient', file: 'index.go', kind: 'struct', docstring: 'An async task returned by CreateIndex. Call Await() to block until the index build completes.' },
    { name: 'LoadTask', category: 'Management', pkg: 'milvusclient', file: 'maintenance.go', kind: 'struct', docstring: 'An async task returned by LoadCollection/LoadPartitions. Call Await() to block until loading completes.' },
    { name: 'FlushTask', category: 'Management', pkg: 'milvusclient', file: 'maintenance.go', kind: 'struct', docstring: 'An async task returned by Flush. Call Await() to block until flushing completes.' },
    { name: 'LoadState', category: 'Management', pkg: 'entity', file: 'load_state.go', kind: 'struct', docstring: 'Represents the load state of a collection or partition, including progress percentage.' },
    { name: 'CompactionState', category: 'Management', pkg: 'entity', file: 'common.go', kind: 'enum', docstring: 'Enumerates the possible states of a compaction operation.' },
    { name: 'Segment', category: 'Management', pkg: 'entity', file: 'segment.go', kind: 'struct', docstring: 'Represents a persistent segment with its ID, row count, and state.' },
    { name: 'Index', category: 'Management', pkg: 'index', file: 'index.go', kind: 'interface', docstring: 'Interface for index configuration. Use constructor functions like NewAutoIndex() or NewHNSWIndex() to create instances.' },
    { name: 'IndexType', category: 'Management', pkg: 'index', file: 'common.go', kind: 'enum', docstring: 'Enumerates the supported index algorithms for vector and scalar fields.' },
    { name: 'MetricType', category: 'Management', pkg: 'entity', file: 'common.go', kind: 'enum', docstring: 'Enumerates the distance metric types used for vector similarity search.' },

    // Vector
    { name: 'ResultSet', category: 'Vector', pkg: 'milvusclient', file: 'results.go', kind: 'struct', docstring: 'Contains search or query results including matched entity IDs, scores, and field values.' },
    { name: 'InsertResult', category: 'Vector', pkg: 'milvusclient', file: 'write.go', kind: 'struct', docstring: 'Contains the result of an Insert operation including the count and IDs of inserted entities.' },
    { name: 'DeleteResult', category: 'Vector', pkg: 'milvusclient', file: 'write.go', kind: 'struct', docstring: 'Contains the result of a Delete operation including the count of deleted entities.' },
    { name: 'UpsertResult', category: 'Vector', pkg: 'milvusclient', file: 'write.go', kind: 'struct', docstring: 'Contains the result of an Upsert operation including the count and IDs of affected entities.' },
    { name: 'SearchIterator', category: 'Vector', pkg: 'milvusclient', file: 'iterator.go', kind: 'interface', docstring: 'Provides paginated access to search results. Call Next() repeatedly until io.EOF.' },
    { name: 'QueryIterator', category: 'Vector', pkg: 'milvusclient', file: 'iterator.go', kind: 'interface', docstring: 'Provides paginated access to query results. Call Next() repeatedly until io.EOF.' },
    { name: 'Vector', category: 'Vector', pkg: 'entity', file: 'vectors.go', kind: 'interface', docstring: 'Interface for vector data. Implementations include FloatVector, BinaryVector, Float16Vector, BFloat16Vector, Int8Vector, and Text.' },
    { name: 'AnnParam', category: 'Vector', pkg: 'index', file: 'ann_param.go', kind: 'interface', docstring: 'Interface for approximate nearest neighbor search parameters. Use NewCustomAnnParam() to create a configurable instance.' },

    // Authentication
    { name: 'User', category: 'Authentication', pkg: 'entity', file: 'rbac.go', kind: 'struct', docstring: 'Represents a user with their assigned roles, returned by DescribeUser.' },
    { name: 'Role', category: 'Authentication', pkg: 'entity', file: 'rbac.go', kind: 'struct', docstring: 'Represents a role with its granted privileges, returned by DescribeRole.' },
    { name: 'RBACMeta', category: 'Authentication', pkg: 'entity', file: 'rbac.go', kind: 'struct', docstring: 'A full snapshot of RBAC metadata including users, roles, grants, and privilege groups. Used with BackupRBAC/RestoreRBAC.' },
    { name: 'PrivilegeGroup', category: 'Authentication', pkg: 'entity', file: 'privilege_group.go', kind: 'struct', docstring: 'Represents a named group of privileges that can be granted together.' },

    // ResourceGroup
    { name: 'ResourceGroup', category: 'ResourceGroup', pkg: 'entity', file: 'resource_group.go', kind: 'struct', docstring: 'Represents a resource group description including node capacity, replica distribution, and configuration.' },
    { name: 'ResourceGroupConfig', category: 'ResourceGroup', pkg: 'entity', file: 'resource_group.go', kind: 'struct', docstring: 'Configuration for creating or updating a resource group, including node limits and transfer policies.' },
];

class GoScanner extends BaseScanner {
    constructor(opts) {
        super(opts);
        this._milvusClientDir = path.join(this.rootDir, 'client', 'milvusclient');
    }

    _defaultExcludes() {
        return ['**/test/**', '**/tests/**', '.git', '**/.git/**', 'vendor/**'];
    }

    async scan() {
        // Phase 1: Extract Client methods + New() constructor
        const methods = this._extractAllMethods();

        // Phase 2: Extract option constructors + With* methods
        this._optionIndex = this._buildOptionIndex();
        for (const method of methods) {
            if (method.optionType) {
                const optInfo = this._resolveOption(method.optionType);
                if (optInfo) {
                    method.params = optInfo.constructorParams;
                    method.optionMethods = optInfo.withMethods;
                    method.altConstructors = optInfo.altConstructors;
                }
            }
        }

        // Phase 3: Extract examples
        const examples = this._extractExamples();
        for (const method of methods) {
            if (examples.has(method.name)) {
                method.example = examples.get(method.name);
            }
        }

        // Phase 4: Extract entity types (structs, enums, interfaces)
        const entities = this._extractEntityTypes();

        // Phase 5: Extract index/AnnParam constructor functions from client/index/
        const indexCtors = this._extractIndexConstructors();

        return [...methods, ...entities, ...indexCtors];
    }

    // ── Phase 1: Method extraction ──────────────────────────────────

    _extractAllMethods() {
        const symbols = [];
        const seenNames = new Set();

        // Scan all .go files in milvusclient dir (exclude tests, options, interceptors)
        const files = this._getSourceFiles();

        for (const file of files) {
            const content = fs.readFileSync(file, 'utf-8');
            const relPath = path.relative(this.rootDir, file);
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                // Match Client methods: func (c *Client) MethodName(
                const clientMatch = line.match(/^func\s+\(\w+\s+\*Client\)\s+([A-Z]\w+)\s*\(/);
                // Match standalone New(): func New(
                const newMatch = !clientMatch && line.match(/^func\s+(New)\s*\(/);

                const match = clientMatch || newMatch;
                if (!match) continue;

                const name = match[1];

                if (SKIP_METHODS.has(name)) continue;
                if (!METHOD_CATEGORIES[name]) continue;
                if (seenNames.has(name)) continue;
                seenNames.add(name);

                // Extract full signature (single line in Go SDK)
                const sigLine = line.replace(/\s*\{.*$/, '').trim();

                // Extract docstring from // comments above
                const docstring = this._extractGoDoc(lines, i);

                // Extract return type
                const returnType = this._extractReturnType(sigLine);

                // Extract option type from params
                const optionType = this._extractOptionType(sigLine);

                symbols.push({
                    name,
                    kind: 'method',
                    signature: sigLine,
                    docstring,
                    params: [],
                    optionMethods: [],
                    altConstructors: [],
                    optionType,
                    returnType,
                    filePath: relPath,
                    lineNumber: i + 1,
                    parentClass: METHOD_CATEGORIES[name],
                    example: null,
                });
            }
        }

        return symbols;
    }

    _getSourceFiles() {
        const dir = this._milvusClientDir;
        if (!fs.existsSync(dir)) return [];

        return fs.readdirSync(dir)
            .filter(f => {
                if (!f.endsWith('.go')) return false;
                if (f.endsWith('_test.go')) return false;
                if (f.endsWith('_option.go') || f.endsWith('_options.go')) return false;
                if (f === 'interceptors.go') return false;
                if (f === 'replicate_builder.go') return false;
                return true;
            })
            .map(f => path.join(dir, f));
    }

    _extractGoDoc(lines, targetLine) {
        const comments = [];
        for (let j = targetLine - 1; j >= Math.max(0, targetLine - 20); j--) {
            const trimmed = lines[j].trim();
            if (trimmed.startsWith('//')) {
                comments.unshift(trimmed.replace(/^\/\/\s?/, ''));
            } else {
                break;
            }
        }
        return comments.join(' ').trim() || null;
    }

    _extractReturnType(sigLine) {
        // Go signatures have multiple paren groups:
        //   func (c *Client) Method(params...) ReturnType
        //   func New(params...) (*Client, error)
        // We need to find the LAST paren group that is the params, then everything after.

        // Strategy: find the method name, then find the balanced params after it
        const nameMatch = sigLine.match(/(?:\)\s+)?([A-Z]\w+)\s*\(/);
        if (!nameMatch) return 'error';

        // Start scanning from the opening paren of params (after method name)
        const nameEnd = sigLine.indexOf(nameMatch[0]) + nameMatch[0].length - 1;
        let depth = 1; // we're already past the opening (
        let paramEnd = -1;
        for (let i = nameEnd + 1; i < sigLine.length; i++) {
            if (sigLine[i] === '(') depth++;
            if (sigLine[i] === ')') {
                depth--;
                if (depth === 0) {
                    paramEnd = i + 1;
                    break;
                }
            }
        }
        if (paramEnd < 0) return 'error';

        let retPart = sigLine.substring(paramEnd).trim();

        if (!retPart || retPart === 'error') return 'error';

        // Remove outer parens if present: (Type, error) -> Type, error
        if (retPart.startsWith('(') && retPart.endsWith(')')) {
            retPart = retPart.slice(1, -1).trim();
        }

        return retPart;
    }

    _extractOptionType(sigLine) {
        // Match the option type parameter, e.g.:
        //   option CreateCollectionOption
        //   opt ListUserOption
        //   option SearchOption
        const match = sigLine.match(/\w+\s+([A-Z]\w*Option)\b/);
        return match ? match[1] : null;
    }

    // ── Phase 2: Option extraction ──────────────────────────────────

    _buildOptionIndex() {
        const index = new Map();
        const dir = this._milvusClientDir;
        if (!fs.existsSync(dir)) return index;

        const optFiles = fs.readdirSync(dir)
            .filter(f => f.endsWith('_option.go') || f.endsWith('_options.go'))
            .map(f => path.join(dir, f));

        for (const file of optFiles) {
            const content = fs.readFileSync(file, 'utf-8');
            this._parseOptionFile(content, index);
        }

        return index;
    }

    _parseOptionFile(content, index) {
        const lines = content.split('\n');

        // Pass 1: Find all exported option interfaces and their unexported struct names
        // type FooOption interface { -> interface name
        // type fooOption struct { -> struct name
        const interfaces = new Map(); // FooOption -> true
        const structs = new Map();    // fooOption -> true

        for (const line of lines) {
            const ifMatch = line.match(/^type\s+([A-Z]\w*Option)\s+interface\s*\{/);
            if (ifMatch) interfaces.set(ifMatch[1], true);

            const stMatch = line.match(/^type\s+([a-z]\w*Option)\s+struct\s*\{/);
            if (stMatch) structs.set(stMatch[1], true);
        }

        // Pass 2: Find constructors — func NewFooOption(...) *fooOption
        // Also find alternative constructors like SimpleFooOptions(...)
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Constructor: func NewFooOption(params) *fooOption
            // or: func NewFooOption(params) FooOption (returns interface)
            const ctorMatch = line.match(/^func\s+((?:New|Simple)\w*(?:Option|Options?))\s*\(([^)]*)\)\s+(?:\*(\w+)|(\w+Option))\s*\{/);
            if (!ctorMatch) continue;

            const ctorName = ctorMatch[1];
            const paramStr = ctorMatch[2].trim();
            const structName = ctorMatch[3] || null;
            const ifaceName = ctorMatch[4] || null;

            // Determine which exported interface this constructor serves
            let optionInterface = null;

            if (ifaceName && interfaces.has(ifaceName)) {
                optionInterface = ifaceName;
            } else if (structName) {
                // Map unexported struct to exported interface
                // e.g., createCollectionOption -> CreateCollectionOption
                const capitalized = structName.charAt(0).toUpperCase() + structName.slice(1);
                if (interfaces.has(capitalized)) {
                    optionInterface = capitalized;
                }
            }

            if (!optionInterface) continue;

            // Parse constructor params
            const constructorParams = this._parseParams(paramStr);

            // Initialize or get existing entry
            if (!index.has(optionInterface)) {
                index.set(optionInterface, {
                    constructorParams: [],
                    withMethods: [],
                    altConstructors: [],
                    primaryConstructor: null,
                    structName: structName || (ifaceName ? ifaceName.charAt(0).toLowerCase() + ifaceName.slice(1) : null),
                });
            }

            const entry = index.get(optionInterface);

            if (ctorName.startsWith('New')) {
                entry.constructorParams = constructorParams;
                entry.primaryConstructor = ctorName;
            } else {
                // Alternative constructor (e.g., SimpleCreateCollectionOptions)
                entry.altConstructors.push({
                    name: ctorName,
                    params: paramStr,
                    fullSignature: `${ctorName}(${paramStr})`,
                });
            }
        }

        // Pass 3: Find With* methods on option structs
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // func (opt *fooOption) WithBar(params) *fooOption {
            const withMatch = line.match(/^func\s+\(\w+\s+\*(\w+)\)\s+(With\w+)\s*\(([^)]*)\)\s+\*\1\s*\{/);
            if (!withMatch) continue;

            const structName = withMatch[1];
            const methodName = withMatch[2];
            const paramStr = withMatch[3].trim();

            // Map struct to interface
            const capitalized = structName.charAt(0).toUpperCase() + structName.slice(1);
            if (!interfaces.has(capitalized)) continue;

            if (!index.has(capitalized)) {
                index.set(capitalized, {
                    constructorParams: [],
                    withMethods: [],
                    altConstructors: [],
                    primaryConstructor: null,
                    structName,
                });
            }

            const entry = index.get(capitalized);

            // Extract docstring
            const docstring = this._extractGoDoc(lines, i);

            entry.withMethods.push({
                name: methodName,
                params: paramStr,
                fullSignature: `${methodName}(${paramStr})`,
                description: docstring || '',
            });
        }
    }

    _parseParams(paramStr) {
        if (!paramStr) return [];
        const params = [];

        // Go params support shorthand: name1, name2 type  (both share type)
        // Strategy: split by comma, then walk backwards to assign types
        const parts = paramStr.split(',').map(s => s.trim());
        const parsed = [];
        for (const part of parts) {
            const match = part.match(/^(\w+)\s+(.+)$/);
            if (match) {
                parsed.push({ name: match[1], type: match[2].trim() });
            } else {
                // Name without type — will inherit type from next param that has one
                const nameMatch = part.match(/^(\w+)$/);
                if (nameMatch) {
                    parsed.push({ name: nameMatch[1], type: null });
                }
            }
        }

        // Walk backwards to fill in shared types
        let currentType = null;
        for (let i = parsed.length - 1; i >= 0; i--) {
            if (parsed[i].type) {
                currentType = parsed[i].type;
            } else if (currentType) {
                parsed[i].type = currentType;
            }
        }

        for (const p of parsed) {
            if (p.type) {
                params.push({ name: p.name, type: p.type, kind: 'required' });
            }
        }

        return params;
    }

    _resolveOption(optionType) {
        return this._optionIndex.get(optionType) || null;
    }

    // ── Phase 3: Example extraction ─────────────────────────────────

    _extractExamples() {
        const examples = new Map();
        const dir = this._milvusClientDir;
        if (!fs.existsSync(dir)) return examples;

        const testFiles = fs.readdirSync(dir)
            .filter(f => f.endsWith('_example_test.go'))
            .map(f => path.join(dir, f));

        for (const file of testFiles) {
            const content = fs.readFileSync(file, 'utf-8');
            this._parseExampleFile(content, examples);
        }

        return examples;
    }

    _parseExampleFile(content, examples) {
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            // Match: func ExampleClient_MethodName() { or func ExampleClient_MethodName_variant() {
            const match = lines[i].match(/^func\s+ExampleClient_(\w+?)(?:_(\w+))?\s*\(\)\s*\{/);
            if (!match) continue;

            const methodName = match[1];
            const variant = match[2] || null;

            // Extract function body
            const body = this._extractFuncBody(lines, i);
            if (!body) continue;

            // Prefer first/primary example; skip if we already have one
            // Exception: prefer _normal or _basic variant over others
            if (examples.has(methodName)) {
                if (variant === 'normal' || variant === 'basic') {
                    examples.set(methodName, body);
                }
                // Otherwise keep the first one found
            } else {
                examples.set(methodName, body);
            }
        }
    }

    // ── Phase 4: Entity type extraction ────────────────────────────

    _extractEntityTypes() {
        const entities = [];

        for (const def of ENTITY_DEFS) {
            try {
                const filePath = this._resolveEntityPath(def);
                if (!fs.existsSync(filePath)) continue;

                const content = fs.readFileSync(filePath, 'utf-8');
                const lines = content.split('\n');

                let entity;
                switch (def.kind) {
                    case 'struct':
                        entity = this._extractStruct(def, lines, filePath);
                        break;
                    case 'enum':
                        entity = this._extractEnum(def, lines, filePath);
                        break;
                    case 'interface':
                        entity = this._extractInterface(def, lines, filePath);
                        break;
                }

                if (entity) entities.push(entity);
            } catch (err) {
                // Skip entities that fail to parse
            }
        }

        return entities;
    }

    _resolveEntityPath(def) {
        const pkgDirs = {
            entity: path.join(this.rootDir, 'client', 'entity'),
            index: path.join(this.rootDir, 'client', 'index'),
            milvusclient: this._milvusClientDir,
        };
        return path.join(pkgDirs[def.pkg], def.file);
    }

    _extractStruct(def, lines, filePath) {
        const structRegex = new RegExp(`^type\\s+${def.name}\\s+struct\\s*\\{`);
        let structStart = -1;
        for (let i = 0; i < lines.length; i++) {
            if (structRegex.test(lines[i])) {
                structStart = i;
                break;
            }
        }
        if (structStart < 0) return null;

        // Extract exported fields and build clean signature
        const fields = [];
        const sigLines = [`type ${def.name} struct {`];
        for (let i = structStart + 1; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed === '}') {
                sigLines.push('}');
                break;
            }
            if (!trimmed || trimmed.startsWith('//')) continue;

            // Exported field: Name Type `tags` // comment
            const fieldMatch = trimmed.match(/^([A-Z]\w*)\s+(.+?)(?:\s+`[^`]*`)?(?:\s*\/\/\s*(.*))?$/);
            if (fieldMatch) {
                fields.push({
                    name: fieldMatch[1],
                    type: fieldMatch[2].trim(),
                    description: fieldMatch[3] || '',
                });
                sigLines.push(`    ${fieldMatch[1]} ${fieldMatch[2].trim()}`);
                continue;
            }

            // Embedded type: index.Index, UserDescription
            if (/^[\w.]+$/.test(trimmed) && /[A-Z]/.test(trimmed)) {
                fields.push({
                    name: trimmed,
                    type: '(embedded)',
                    description: '',
                });
                sigLines.push(`    ${trimmed}`);
            }
        }

        // Find With* builder methods on this struct
        const withMethods = [];
        const withRegex = new RegExp(`^func\\s+\\(\\w+\\s+\\*${def.name}\\)\\s+(With\\w+)\\s*\\(([^)]*)\\)\\s+\\*${def.name}\\s*\\{`);
        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(withRegex);
            if (match) {
                const docstring = this._extractGoDoc(lines, i);
                withMethods.push({
                    name: match[1],
                    params: match[2].trim(),
                    fullSignature: `${match[1]}(${match[2].trim()})`,
                    description: docstring || '',
                });
            }
        }

        // Find constructor New<Name>()
        let ctorParams = [];
        const ctorRegex = new RegExp(`^func\\s+New${def.name}\\s*\\(([^)]*)\\)`);
        for (const line of lines) {
            const match = line.match(ctorRegex);
            if (match) {
                ctorParams = this._parseParams(match[1]);
                break;
            }
        }

        // Find other exported methods (like Await, GetColumn, etc.)
        // Skip internal/proto methods that aren't useful for SDK users
        const SKIP_ENTITY_METHODS = new Set([
            'ProtoMessage', 'ReadProto', 'Marshal', 'Unmarshal',
            'ProtoRequest', 'Request', 'MarshalJSON',
        ]);
        const methods = [];
        const methodRegex = new RegExp(`^func\\s+\\(\\w+\\s+\\*?${def.name}\\)\\s+([A-Z]\\w+)\\s*\\(([^)]*)\\)\\s*(.*?)\\s*\\{`);
        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(methodRegex);
            if (match && !match[1].startsWith('With') && !SKIP_ENTITY_METHODS.has(match[1])) {
                const docstring = this._extractGoDoc(lines, i);
                methods.push({
                    name: match[1],
                    params: match[2].trim(),
                    returnType: match[3].trim().replace(/^\(/, '').replace(/\)$/, ''),
                    description: docstring || '',
                });
            }
        }

        return {
            name: def.name,
            kind: 'struct',
            parentClass: def.category,
            signature: sigLines.join('\n'),
            docstring: def.docstring,
            fields,
            params: ctorParams,
            optionMethods: withMethods,
            methods,
            filePath: path.relative(this.rootDir, filePath),
            lineNumber: structStart + 1,
            pkg: def.pkg,
            example: null,
        };
    }

    _extractEnum(def, lines, filePath) {
        // Find type definition
        const typeRegex = new RegExp(`^type\\s+${def.name}\\s+(\\w+)`);
        let typeLine = -1;
        let baseType = 'int';
        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(typeRegex);
            if (match) {
                typeLine = i;
                baseType = match[1];
                break;
            }
        }
        if (typeLine < 0) return null;

        // Find const blocks and extract values of this type
        const values = [];
        let inConst = false;
        let isTargetBlock = false;

        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();

            if (trimmed.startsWith('const (')) {
                inConst = true;
                isTargetBlock = false;
                continue;
            }
            if (inConst && trimmed === ')') {
                if (isTargetBlock) break; // done with target block
                inConst = false;
                continue;
            }
            if (!inConst) continue;
            if (!trimmed || trimmed.startsWith('//')) continue;

            // Typed value: Name TypeName = value // comment
            const typedMatch = trimmed.match(new RegExp(`^(\\w+)\\s+${def.name}\\s*=\\s*(.+?)\\s*(?:\\/\\/\\s*(.*))?$`));
            if (typedMatch) {
                isTargetBlock = true;
                values.push({
                    name: typedMatch[1],
                    value: typedMatch[2].replace(/\s*\/\/.*$/, '').trim(),
                    description: typedMatch[3] || '',
                });
                continue;
            }

            // Iota continuation or untyped value in target block
            if (isTargetBlock) {
                // Name // comment (iota continuation)
                const contMatch = trimmed.match(/^(\w+)\s*(?:\/\/\s*(.*))?$/);
                if (contMatch && /^[A-Z]/.test(contMatch[1])) {
                    values.push({
                        name: contMatch[1],
                        value: '',
                        description: contMatch[2] || '',
                    });
                    continue;
                }

                // Name = value // comment (explicit value, same type)
                const valMatch = trimmed.match(/^(\w+)\s*=\s*(.+?)\s*(?:\/\/\s*(.*))?$/);
                if (valMatch && /^[A-Z]/.test(valMatch[1])) {
                    values.push({
                        name: valMatch[1],
                        value: valMatch[2].replace(/\s*\/\/.*$/, '').trim(),
                        description: valMatch[3] || '',
                    });
                }
            }
        }

        return {
            name: def.name,
            kind: 'enum',
            parentClass: def.category,
            signature: `type ${def.name} ${baseType}`,
            docstring: def.docstring,
            values,
            fields: [],
            params: [],
            optionMethods: [],
            methods: [],
            filePath: path.relative(this.rootDir, filePath),
            lineNumber: typeLine + 1,
            pkg: def.pkg,
            example: null,
        };
    }

    _extractInterface(def, lines, filePath) {
        const ifRegex = new RegExp(`^type\\s+${def.name}\\s+interface\\s*\\{`);
        let ifStart = -1;
        for (let i = 0; i < lines.length; i++) {
            if (ifRegex.test(lines[i])) {
                ifStart = i;
                break;
            }
        }
        if (ifStart < 0) return null;

        // Extract method signatures
        const methods = [];
        const sigLines = [lines[ifStart].trim()];
        for (let i = ifStart + 1; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed === '}') {
                sigLines.push('}');
                break;
            }
            if (!trimmed || trimmed.startsWith('//')) continue;

            // Method: Name(params) returnType
            const methMatch = trimmed.match(/^([A-Z]\w*)\s*\(([^)]*)\)\s*(.*?)$/);
            if (methMatch) {
                const retType = methMatch[3].trim().replace(/^\(/, '').replace(/\)$/, '');
                methods.push({
                    name: methMatch[1],
                    params: methMatch[2].trim(),
                    returnType: retType,
                    fullSignature: trimmed,
                });
                sigLines.push(`    ${trimmed}`);
            }
        }

        return {
            name: def.name,
            kind: 'interface',
            parentClass: def.category,
            signature: sigLines.join('\n'),
            docstring: def.docstring,
            fields: [],
            params: [],
            optionMethods: [],
            methods,
            filePath: path.relative(this.rootDir, filePath),
            lineNumber: ifStart + 1,
            pkg: def.pkg,
            example: null,
        };
    }

    // ── Phase 5: Index constructor extraction ─────────────────────────

    _extractIndexConstructors() {
        const indexDir = path.join(this.rootDir, 'client', 'index');
        if (!fs.existsSync(indexDir)) return [];

        // Constructors to skip (helpers/duplicates)
        const SKIP_CTORS = new Set([
            'NewRTreeIndexWithParams',  // duplicate of NewRTreeIndex
            'NewRTreeIndexBuilder',     // builder helper, not a constructor
        ]);

        // Category assignment
        const CTOR_CATEGORIES = {
            // Index constructors → Management
            NewAutoIndex: 'Management',
            NewHNSWIndex: 'Management',
            NewIvfFlatIndex: 'Management',
            NewFlatIndex: 'Management',
            NewBinFlatIndex: 'Management',
            NewIvfPQIndex: 'Management',
            NewIvfSQ8Index: 'Management',
            NewIvfRabitQIndex: 'Management',
            NewBinIvfFlatIndex: 'Management',
            NewSCANNIndex: 'Management',
            NewDiskANNIndex: 'Management',
            NewSparseInvertedIndex: 'Management',
            NewSparseWANDIndex: 'Management',
            NewGPUBruteForceIndex: 'Management',
            NewGPUIVPFlatIndex: 'Management',
            NewGPUIVPPQIndex: 'Management',
            NewGPUCagraIndex: 'Management',
            NewMinHashLSHIndex: 'Management',
            NewTrieIndex: 'Management',
            NewInvertedIndex: 'Management',
            NewSortedIndex: 'Management',
            NewBitmapIndex: 'Management',
            NewRTreeIndex: 'Management',
            NewGenericIndex: 'Management',
            NewJSONPathIndex: 'Management',

            // AnnParam constructors → Vector
            NewCustomAnnParam: 'Vector',
            NewAutoAnnParam: 'Vector',
            NewHNSWAnnParam: 'Vector',
            NewIvfAnnParam: 'Vector',
            NewIvfRabitQAnnParam: 'Vector',
            NewDiskAnnParam: 'Vector',
            NewSCANNAnnParam: 'Vector',
            NewSparseAnnParam: 'Vector',
            NewMinHashLSHAnnParam: 'Vector',
        };

        const symbols = [];
        const seenNames = new Set();

        const files = fs.readdirSync(indexDir)
            .filter(f => f.endsWith('.go') && !f.endsWith('_test.go'))
            .map(f => path.join(indexDir, f));

        for (const file of files) {
            const content = fs.readFileSync(file, 'utf-8');
            const lines = content.split('\n');
            const relPath = path.relative(this.rootDir, file);

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                // Match exported constructor: func NewXxxYyy(params...) ReturnType {
                // May span multiple lines for multi-line signatures
                const match = line.match(/^func\s+(New[A-Z]\w+)\s*\(/);
                if (!match) continue;

                const name = match[1];
                if (SKIP_CTORS.has(name)) continue;
                if (!CTOR_CATEGORIES[name]) continue;
                if (seenNames.has(name)) continue;
                seenNames.add(name);

                // Build full signature (may span multiple lines until {)
                let sigLine = line;
                if (!line.includes('{')) {
                    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                        sigLine += ' ' + lines[j].trim();
                        if (lines[j].includes('{')) break;
                    }
                }
                sigLine = sigLine.replace(/\s*\{.*$/, '').trim();

                const docstring = this._extractGoDoc(lines, i);
                const returnType = this._extractCtorReturnType(sigLine, name);
                const params = this._extractCtorParams(sigLine, name);

                symbols.push({
                    name,
                    kind: 'function',
                    signature: sigLine,
                    docstring,
                    params,
                    optionMethods: [],
                    altConstructors: [],
                    optionType: null,
                    returnType,
                    filePath: relPath,
                    lineNumber: i + 1,
                    parentClass: CTOR_CATEGORIES[name],
                    example: null,
                });
            }
        }

        return symbols;
    }

    _extractCtorReturnType(sigLine, name) {
        // Find the closing ) of params, then get what follows
        let depth = 0;
        let started = false;
        let paramEnd = -1;
        for (let i = 0; i < sigLine.length; i++) {
            if (sigLine[i] === '(' && !started) {
                // Skip receiver paren — look for the one after func name
                const before = sigLine.substring(0, i);
                if (before.includes(name)) {
                    started = true;
                    depth = 1;
                    continue;
                }
            }
            if (started) {
                if (sigLine[i] === '(') depth++;
                if (sigLine[i] === ')') {
                    depth--;
                    if (depth === 0) {
                        paramEnd = i + 1;
                        break;
                    }
                }
            }
        }
        if (paramEnd < 0) return 'Index';
        const ret = sigLine.substring(paramEnd).trim();
        return ret || 'Index';
    }

    _extractCtorParams(sigLine, name) {
        // Extract text between parens after the function name
        const nameIdx = sigLine.indexOf(name);
        if (nameIdx < 0) return [];
        const afterName = sigLine.substring(nameIdx + name.length);
        const parenMatch = afterName.match(/^\s*\(([^)]*)\)/);
        if (!parenMatch) return [];
        return this._parseParams(parenMatch[1]);
    }

    // ── Phase 3: Example extraction ─────────────────────────────────

    _extractFuncBody(lines, startLine) {
        // Find matching closing brace
        let depth = 0;
        let started = false;
        const bodyLines = [];

        for (let i = startLine; i < lines.length; i++) {
            const line = lines[i];

            for (const ch of line) {
                if (ch === '{') {
                    depth++;
                    started = true;
                }
                if (ch === '}') depth--;
            }

            // Collect lines inside the function body (after opening {)
            if (started && i > startLine) {
                if (depth > 0) {
                    bodyLines.push(line);
                } else {
                    // Last line before closing brace
                    break;
                }
            }

            if (started && depth === 0) break;
        }

        if (bodyLines.length === 0) return null;

        // De-indent: find minimum indentation and strip it
        const nonEmpty = bodyLines.filter(l => l.trim().length > 0);
        if (nonEmpty.length === 0) return null;

        const minIndent = Math.min(...nonEmpty.map(l => l.match(/^(\s*)/)[1].length));
        return bodyLines.map(l => l.substring(minIndent)).join('\n').trim();
    }
}

module.exports = GoScanner;

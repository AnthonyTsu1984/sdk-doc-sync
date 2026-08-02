/**
 * MethodNormalizer — normalizes method names to PascalCase canonical form,
 * resolves SDK-specific aliases, and builds a unified registry across SDKs.
 */

// Merged from Go (86) + C++ (91) category maps, deduplicated.
// This is the canonical source of truth for method→category assignment.
const CANONICAL_CATEGORIES = {
    // Client
    Connect: 'Client',
    Close: 'Client',
    GetServerVersion: 'Client',
    Disconnect: 'Client',
    SetRpcDeadlineMs: 'Client',
    SetRetryParam: 'Client',
    GetSdkVersion: 'Client',
    CheckHealth: 'Client',
    ClientIsReady: 'Client',
    RetryConfig: 'Client',
    CurrentUsedDatabase: 'Client',

    // Collections
    CreateCollection: 'Collections',
    ListCollections: 'Collections',
    DescribeCollection: 'Collections',
    BatchDescribeCollection: 'Collections',
    HasCollection: 'Collections',
    DropCollection: 'Collections',
    TruncateCollection: 'Collections',
    RenameCollection: 'Collections',
    AlterCollectionProperties: 'Collections',
    DropCollectionProperties: 'Collections',
    AlterCollectionFieldProperty: 'Collections',
    AlterCollectionFieldProperties: 'Collections',
    DropCollectionFieldProperties: 'Collections',
    GetCollectionStats: 'Collections',
    AddCollectionField: 'Collections',
    AddCollectionFunction: 'Collections',
    AlterCollectionFunction: 'Collections',
    DropCollectionFunction: 'Collections',
    CreateSchema: 'Collections',
    CreateAlias: 'Collections',
    DescribeAlias: 'Collections',
    DropAlias: 'Collections',
    AlterAlias: 'Collections',
    ListAliases: 'Collections',

    // Database (7)
    UseDatabase: 'Database',
    ListDatabase: 'Database',
    ListDatabases: 'Database',
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
    ListPersistentSegments: 'Management',
    ListQuerySegments: 'Management',
    GetCompactionPlans: 'Management',
    GetFlushState: 'Management',
    FlushAll: 'Management',
    GetFlushAllState: 'Management',
    GetQuerySegmentInfo: 'Management',
    GetReplicas: 'Management',
    LoadBalance: 'Management',
    ListLoadedSegments: 'Management',
    Optimize: 'Management',
    UpdateReplicateConfiguration: 'Management',

    // Partitions (5–7)
    CreatePartition: 'Partitions',
    DropPartition: 'Partitions',
    HasPartition: 'Partitions',
    ListPartitions: 'Partitions',
    GetPartitionStats: 'Partitions',
    GetPartitionStatistics: 'Partitions',

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
    Count: 'Vector',

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
    BackupRbac: 'Authentication',
    RestoreRbac: 'Authentication',
    AddUserToRole: 'Authentication',
    RemoveUserFromRole: 'Authentication',

    // ResourceGroup (7)
    ListResourceGroups: 'ResourceGroup',
    CreateResourceGroup: 'ResourceGroup',
    DropResourceGroup: 'ResourceGroup',
    DescribeResourceGroup: 'ResourceGroup',
    UpdateResourceGroup: 'ResourceGroup',
    TransferReplica: 'ResourceGroup',
    DescribeReplica: 'ResourceGroup',
    TransferNode: 'ResourceGroup',
    UpdateResourceGroups: 'ResourceGroup',
};

// Maps SDK-specific method names (after PascalCase conversion) to their canonical name.
// This handles cases where different SDKs use different names for the same operation.
const CANONICAL_ALIASES = {
    // Python-specific
    'CloseConnection': 'Close',

    // Go-specific
    'New': 'Connect',

    // C++ Create (static factory) = Connect
    'Create': 'Connect',
    'CreateSimpleCollection': 'CreateCollection',

    // C++ plural variants
    'GetPartitionStatistics': 'GetPartitionStats',
    'UpdateResourceGroups': 'UpdateResourceGroup',
    'ListDatabases': 'ListDatabase',
    'AlterCollectionFieldProperties': 'AlterCollectionFieldProperty',
    'DropCollectionFieldProperties': 'DropCollectionProperties',

    // Cross-SDK name variants for same operation
    'AlterCollection': 'AlterCollectionProperties',
    'AlterCollectionField': 'AlterCollectionFieldProperty',
    'AlterDatabase': 'AlterDatabaseProperties',
    'AlterIndex': 'AlterIndexProperties',
    'SearchIteratorV2': 'SearchIterator',
    'ListCollectionsV2': 'ListCollections',
    'UsingDatabase': 'UseDatabase',
    'WithRetry': 'RetryConfig',
    'WithTimeout': 'SetRpcDeadlineMs',

    // Node sync variants → collapse to base
    'LoadCollectionSync': 'LoadCollection',
    'LoadCollectionAsync': 'LoadCollection',
    'FlushSync': 'Flush',

    // Node aliases
    'GetFlushState': 'Flush',
    'GetCompactionStateWithPlans': 'GetCompactionPlans',
    'GetReplicas': 'DescribeReplica',
    'DescribeReplicas': 'DescribeReplica',
    'GetLoadingProgress': 'GetLoadState',
    'AddUserToRole': 'GrantRole',
    'RemoveUserFromRole': 'RevokeRole',
    'SelectRole': 'DescribeRole',
    'SelectUser': 'DescribeUser',
    'ShowPartitions': 'ListPartitions',
    'ShowCollections': 'ListCollections',
    'ListCollections_': 'ListCollections',

    // Python RBAC aliases
    'BackupRbac': 'BackupRBAC',
    'RestoreRbac': 'RestoreRBAC',
};

// Method kinds that qualify as API methods (not entity types, enums, etc.)
const METHOD_KINDS = new Set(['method', 'function', 'Function']);

// Per-language whitelist of classes whose methods count as public API.
// SDKs not listed here already return only public API methods from their scanners.
const PUBLIC_API_CLASSES = {
    python: new Set(['MilvusClient']),
};

class MethodNormalizer {
    constructor() {
        this.categories = CANONICAL_CATEGORIES;
        this.aliases = CANONICAL_ALIASES;
    }

    /**
     * Normalize a method name to PascalCase.
     */
    toPascalCase(name, language) {
        if (language === 'python') {
            // snake_case → PascalCase
            return name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
        }
        // Java/Node: camelCase → PascalCase (capitalize first letter)
        // C++/Go: already PascalCase (pass through)
        return name.charAt(0).toUpperCase() + name.slice(1);
    }

    /**
     * Resolve a PascalCase name to its canonical form via the alias map.
     */
    resolveAlias(pascalName) {
        return this.aliases[pascalName] || pascalName;
    }

    /**
     * Get the canonical category for a method name.
     * Falls back to the symbol's parentClass if not in the canonical map.
     */
    getCategory(canonicalName, symbol) {
        return this.categories[canonicalName] || symbol.parentClass || 'Uncategorized';
    }

    /**
     * Check if a symbol is a public API method.
     * Filters by kind, excludes dunder/private names, and applies
     * per-language class whitelists where scanners return too broadly.
     */
    isApiMethod(symbol, language) {
        if (!METHOD_KINDS.has(symbol.kind)) return false;
        if (symbol.name.startsWith('_')) return false;
        const allowedClasses = PUBLIC_API_CLASSES[language];
        if (allowedClasses && !allowedClasses.has(symbol.parentClass)) return false;
        return true;
    }

    /**
     * Build a unified registry from scan results across all languages.
     *
     * @param {Object} scanResults - { python: [...symbols], java: [...], ... }
     * @returns {Map<string, { category: string, sdks: { python?: symbol, java?: symbol, ... } }>}
     */
    buildRegistry(scanResults) {
        const registry = new Map();

        for (const [language, symbols] of Object.entries(scanResults)) {
            for (const symbol of symbols) {
                if (!this.isApiMethod(symbol, language)) continue;

                const pascal = this.toPascalCase(symbol.name, language);
                const canonical = this.resolveAlias(pascal);
                const category = this.getCategory(canonical, symbol);

                if (!registry.has(canonical)) {
                    registry.set(canonical, {
                        category,
                        sdks: {},
                    });
                }

                const entry = registry.get(canonical);

                // Don't overwrite an existing entry for the same SDK
                // (e.g., multiple overloads — keep first)
                if (!entry.sdks[language]) {
                    entry.sdks[language] = symbol;
                }
            }
        }

        return registry;
    }
}

module.exports = MethodNormalizer;

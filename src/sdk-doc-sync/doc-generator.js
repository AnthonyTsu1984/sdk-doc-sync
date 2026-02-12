/**
 * DocGenerator — produces scaffold markdown and bitable metadata for SDK symbols.
 *
 * The scaffold matches the real Feishu reference doc structure:
 *   [description] → Request Syntax (code) → PARAMETERS → RETURN TYPE → EXCEPTIONS → Examples
 *
 * The scaffold is intentionally minimal — it provides structure for Claude (or a
 * human) to fill in with intelligent content: meaningful descriptions, parameter
 * explanations, realistic examples, and edge-case notes. Fields marked with
 * `<!-- TODO: ... -->` are placeholders for that intelligence layer.
 */

class DocGenerator {
    constructor({ sdkName, sdkVersion, targets = [], language = 'python' }) {
        this.sdkName = sdkName;
        this.sdkVersion = sdkVersion;
        this.targets = targets.length ? targets : [sdkName];
        this.language = language;
    }

    /**
     * Generate scaffold markdown for a symbol.
     * Returns a string matching the real Feishu reference doc structure.
     */
    generate(symbol) {
        switch (symbol.kind) {
            case 'class':
                return this._classScaffold(symbol);
            case 'enum':
                if (this.language === 'cpp') return this._cppEnumScaffold(symbol);
                if (this.language === 'go') return this._goEnumScaffold(symbol);
                return this._enumScaffold(symbol);
            case 'struct':
                if (this.language === 'go') return this._goStructScaffold(symbol);
                return this._functionScaffold(symbol);
            case 'interface':
                if (this.language === 'go') return this._goInterfaceScaffold(symbol);
                return this._functionScaffold(symbol);
            case 'method':
            case 'function':
                return this._functionScaffold(symbol);
            default:
                return this._functionScaffold(symbol);
        }
    }

    /**
     * Generate bitable record metadata for a symbol.
     * Slug format matches real convention: `Category-symbol_name`
     */
    generateMeta(symbol, { parentRecordId = null } = {}) {
        const slug = this._slug(symbol);
        const title = this._title(symbol);
        const type = this._bitableType(symbol);

        const description = symbol.docstring
            ? symbol.docstring.split('\n')[0].trim()
            : '';

        return {
            title,
            slug,
            description,
            type,
            addedSince: this.sdkVersion,
            targets: this.targets,
            progress: 'Draft',
            parentRecordId,
        };
    }

    /**
     * Slug format matching the real bitable convention:
     *   - Top-level class/module: `ClassName`
     *   - Method of a class: `ClassName-method_name`
     *   - Nested under a VirtualNode category: `Category-symbol_name`
     *
     * Preserves original casing — NOT lowercased or strict-slugified.
     */
    _slug(symbol) {
        if (symbol.parentClass) {
            return `${symbol.parentClass}-${symbol.name}`;
        }
        return symbol.name;
    }

    _title(symbol) {
        if (symbol.kind === 'class' || symbol.kind === 'enum' || symbol.kind === 'struct' || symbol.kind === 'interface') {
            return symbol.name;
        }
        return `${symbol.name}()`;
    }

    _bitableType(symbol) {
        const map = {
            class: 'Class',
            struct: 'Class',
            interface: 'Class',
            enum: 'Enum',
            method: 'Function',
            function: 'Function',
            constant: 'Function',
            module: 'Module',
        };
        return map[symbol.kind] || 'Function';
    }

    // ── Scaffold templates ─────────────────────────────────────────────

    _functionScaffold(symbol) {
        if (this.language === 'java') {
            return this._javaFunctionScaffold(symbol);
        }
        if (this.language === 'cpp') {
            return this._cppFunctionScaffold(symbol);
        }
        if (this.language === 'go') {
            return this._goFunctionScaffold(symbol);
        }
        return this._pythonFunctionScaffold(symbol);
    }

    _pythonFunctionScaffold(symbol) {
        const title = this._title(symbol);
        let md = '';

        // Brief description
        md += `${symbol.docstring ? symbol.docstring.split('\n')[0].trim() : `<!-- TODO: Brief description of ${title} -->`}\n\n`;

        // Request Syntax
        md += `## Request Syntax\n\n`;
        md += `\`\`\`python\n${this._buildSignature(symbol)}\n\`\`\`\n\n`;

        // Parameters
        if (symbol.params.length > 0) {
            md += `**PARAMETERS:**\n\n`;
            for (const p of symbol.params) {
                if (p.kind === 'separator') continue;
                const name = p.kind === 'args' ? `*${p.name}` : p.kind === 'kwargs' ? `**${p.name}` : p.name;
                const type = p.type || 'object';
                const required = p.default === null && p.kind === 'positional' ? '\n\n  [REQUIRED]' : '';
                md += `- **${name}** (${type}) –${required}\n\n`;
                md += `  <!-- TODO: Description of ${name} -->\n\n`;
            }
        }

        // Return type
        md += `**RETURN TYPE:**\n\n`;
        md += `${symbol.returnType || 'None'}\n\n`;

        // Exceptions
        md += `**EXCEPTIONS:**\n\n`;
        md += `<!-- TODO: List relevant exceptions -->\n\n`;

        // Examples
        md += `## Examples\n\n`;
        md += `\`\`\`python\n<!-- TODO: Usage example -->\n\`\`\`\n`;

        return md;
    }

    _javaFunctionScaffold(symbol) {
        const title = this._title(symbol);
        let md = '';

        // Brief description
        md += `${symbol.docstring ? symbol.docstring.split('\n')[0].trim() : `<!-- TODO: Brief description of ${title} -->`}\n\n`;

        // Method signature in java code block
        md += `\`\`\`java\n${symbol.signature}\n\`\`\`\n\n`;

        // Request Syntax and Builder Methods — only if there's a request class
        if (symbol.requestClass && symbol.params.length > 0) {
            md += `## Request Syntax{#request-syntax}\n\n`;
            md += `\`\`\`java\n${this._buildJavaRequestSyntax(symbol)}\n\`\`\`\n\n`;

            md += `**BUILDER METHODS:**\n\n`;
            for (const p of symbol.params) {
                md += `- \`${p.name}(${p.type} ${p.name})\`\n\n`;
                md += `    <!-- TODO: Description -->\n\n`;
            }
        }

        // Returns
        md += `**RETURNS:**\n\n`;
        md += `*${symbol.returnType || 'void'}*\n\n`;
        md += `<!-- TODO: Description of return value -->\n\n`;

        // Exceptions
        md += `**EXCEPTIONS:**\n\n`;
        md += `- **MilvusClientExceptions**\n\n`;
        md += `    This exception will be raised when any error occurs during this operation.\n\n`;

        // Example
        md += `## Example{#example}\n\n`;
        md += `\`\`\`java\n<!-- TODO: Usage example -->\n\`\`\`\n`;

        return md;
    }

    _buildJavaRequestSyntax(symbol) {
        const fields = symbol.params.map(p => `    .${p.name}(${p.type} ${p.name})`).join('\n');
        return `${symbol.name}(${symbol.requestClass}.builder()\n${fields}\n    .build()\n)`;
    }

    _cppFunctionScaffold(symbol) {
        const title = this._title(symbol);
        let md = '';

        // Brief description
        md += `${symbol.docstring || `<!-- TODO: Brief description of ${title} -->`}\n\n`;

        // Method signature
        md += `\`\`\`cpp\n${symbol.signature}\n\`\`\`\n\n`;

        // Request Syntax + REQUEST METHODS — only if there's a request class with params
        if (symbol.requestClass && symbol.params.length > 0) {
            md += `## Request Syntax{#request-syntax}\n\n`;
            md += `\`\`\`cpp\n${this._buildCppRequestSyntax(symbol)}\n\`\`\`\n\n`;

            md += `**REQUEST METHODS:**\n\n`;
            for (const p of symbol.params) {
                const methodCall = p.fullArgStr
                    ? `${p.name}(${p.fullArgStr})`
                    : p.argName
                        ? `${p.name}(${p.type} ${p.argName})`
                        : `${p.name}()`;
                md += `- \`${methodCall}\`\n\n`;
                md += `    ${p.description || '<!-- TODO: Description -->'}\n\n`;
            }
        } else if (symbol.params && symbol.params.length > 0) {
            // Direct params (non-request methods like Connect, UseDatabase)
            md += `**PARAMETERS:**\n\n`;
            for (const p of symbol.params) {
                md += `- **${p.name}** (*${p.type}*)\n\n`;
                md += `    ${p.description || '<!-- TODO: Description -->'}\n\n`;
            }
        }

        // Returns
        md += `**RETURNS:**\n\n`;
        if (symbol.responseClass) {
            md += `*Status* with *${symbol.responseClass}*\n\n`;
        } else {
            md += `*Status*\n\n`;
        }
        md += `Check \`status.IsOk()\` to confirm success.\n\n`;

        // Exceptions
        md += `**EXCEPTIONS:**\n\n`;
        md += `- **StatusCode**\n\n`;
        md += `    Check \`status.Code()\` and \`status.Message()\` for error details.\n\n`;

        // Example
        md += `## Example{#example}\n\n`;
        md += `\`\`\`cpp\n${this._buildCppExample(symbol)}\n\`\`\`\n`;

        return md;
    }

    _buildCppRequestSyntax(symbol) {
        const withMethods = symbol.params
            .filter(p => p.name.startsWith('With'))
            .map(p => {
                const arg = p.argName
                    ? `${p.argName}`
                    : 'value';
                return `    .${p.name}(${arg})`;
            });
        const chain = withMethods.length > 0 ? '\n' + withMethods.join('\n') : '';
        return `auto request = ${symbol.requestClass}();${chain ? '\nrequest' + chain + ';' : ''}`;
    }

    _buildCppExample(symbol) {
        let ex = '#include <milvus/MilvusClientV2.h>\n';
        ex += 'using namespace milvus;\n\n';
        ex += 'auto client = MilvusClientV2::Create();\n';
        ex += '// TODO: connect and use client\n';
        if (symbol.requestClass) {
            ex += `auto request = ${symbol.requestClass}();\n`;
            ex += `// TODO: configure request\n`;
            if (symbol.responseClass) {
                ex += `${symbol.responseClass} response;\n`;
                ex += `auto status = client->${symbol.name}(request, response);\n`;
            } else {
                ex += `auto status = client->${symbol.name}(request);\n`;
            }
        } else if (symbol.params && symbol.params.length > 0) {
            const args = symbol.params.map(p => `/* ${p.name} */`).join(', ');
            ex += `auto status = client->${symbol.name}(${args});\n`;
        } else {
            ex += `auto status = client->${symbol.name}();\n`;
        }
        return ex;
    }

    _cppEnumScaffold(symbol) {
        let md = '';

        md += `${symbol.docstring || `<!-- TODO: Brief description of ${symbol.name} -->`}\n\n`;

        md += `\`\`\`cpp\n${symbol.signature}\n\`\`\`\n\n`;

        if (symbol.params && symbol.params.length > 0) {
            md += `**VALUES:**\n\n`;
            for (const v of symbol.params) {
                const desc = v.comment || '<!-- TODO: Description -->';
                md += `- **${v.name}** (${v.value}) - ${desc}\n\n`;
            }
        }

        md += `## Example{#example}\n\n`;
        md += `\`\`\`cpp\n#include <milvus/types/${symbol.name}.h>\nusing namespace milvus;\n\n// TODO: Usage example\n\`\`\`\n`;

        return md;
    }

    _goFunctionScaffold(symbol) {
        // Index/AnnParam constructors — standalone funcs, no option pattern
        if (symbol.kind === 'function' && symbol.name.startsWith('New') && !symbol.optionType) {
            return this._goConstructorScaffold(symbol);
        }

        const title = this._title(symbol);
        let md = '';

        // Brief description — always use curated "This operation ..." descriptions
        md += `${this._goDescription(symbol.name)}\n\n`;

        // Method signature
        md += `\`\`\`go\n${symbol.signature}\n\`\`\`\n\n`;

        // Request Syntax + PARAMETERS + OPTION METHODS
        const hasOptions = symbol.optionMethods && symbol.optionMethods.length > 0;
        const hasConstructorParams = symbol.params && symbol.params.length > 0;

        if (hasConstructorParams || hasOptions) {
            md += `## Request Syntax{#request-syntax}\n\n`;
            md += `\`\`\`go\n${this._buildGoRequestSyntax(symbol)}\n\`\`\`\n\n`;

            // PARAMETERS — constructor params
            if (hasConstructorParams) {
                md += `**PARAMETERS:**\n\n`;
                for (const p of symbol.params) {
                    const desc = this._goParamDescription(p.name, p.type, symbol.name);
                    md += `- **${p.name}** (*${p.type}*)\n\n`;
                    md += `    ${desc}\n\n`;
                }
            }

            // OPTION METHODS — With* methods
            if (hasOptions) {
                md += `**OPTION METHODS:**\n\n`;
                for (const opt of symbol.optionMethods) {
                    const desc = opt.description || this._goOptionDescription(opt.name, opt.params, symbol.name);
                    md += `- \`${opt.fullSignature}\`\n\n`;
                    md += `    ${desc}\n\n`;
                }
            }
        }

        // Return type
        const retType = symbol.returnType || 'error';
        md += `**RETURN TYPE:**\n\n`;
        md += `*${retType}*\n\n`;

        // Returns explanation
        md += `**RETURNS:**\n\n`;
        md += `${this._goReturnDescription(retType, symbol.name)}\n\n`;

        // Exceptions
        md += `**EXCEPTIONS:**\n\n`;
        md += `- **error**\n\n`;
        md += `    Check \`err != nil\` for failure details.\n\n`;

        // Example
        md += `## Example{#example}\n\n`;
        md += `\`\`\`go\n${symbol.example || this._buildGoExample(symbol)}\n\`\`\`\n`;

        return md;
    }

    _goConstructorScaffold(symbol) {
        let md = '';

        md += `${this._goDescription(symbol.name)}\n\n`;

        // Function signature
        md += `\`\`\`go\n${symbol.signature}\n\`\`\`\n\n`;

        // Parameters
        if (symbol.params && symbol.params.length > 0) {
            md += `**PARAMETERS:**\n\n`;
            for (const p of symbol.params) {
                const desc = this._goCtorParamDescription(p.name, p.type, symbol.name);
                md += `- **${p.name}** (*${p.type}*)\n\n`;
                md += `    ${desc}\n\n`;
            }
        }

        // Returns
        const retType = symbol.returnType || 'Index';
        md += `**RETURNS:**\n\n`;
        const isAnnParam = symbol.name.includes('AnnParam');
        if (isAnnParam) {
            md += `*AnnParam*\n\n`;
            md += `An ANN search parameter instance. Pass this to a search option via \`WithAnnParam()\`.\n\n`;
        } else {
            md += `*Index*\n\n`;
            md += `An index configuration instance. Pass this to \`CreateIndex()\` via the index option.\n\n`;
        }

        // Example
        md += `## Example{#example}\n\n`;
        md += `\`\`\`go\n${this._buildGoCtorExample(symbol)}\n\`\`\`\n`;

        return md;
    }

    _goCtorParamDescription(name, type, ctorName) {
        const lower = name.toLowerCase();

        if (lower === 'metrictype') return 'The distance metric type for similarity search (e.g., index.COSINE, index.L2, index.IP).';
        if (lower === 'm' && ctorName === 'NewHNSWIndex') return 'The number of bi-directional links for each element. Higher values improve recall but increase memory usage. Typical range: 4-64.';
        if (lower === 'efconstruction') return 'The size of the dynamic candidate list during index construction. Higher values improve index quality but slow down build time. Typical range: 8-512.';
        if (lower === 'nlist') return 'The number of cluster units (inverted lists). Higher values speed up search but reduce recall. Typical range: 1-65536.';
        if (lower === 'nbits') return 'The number of bits for product quantization encoding. Typically 8.';
        if (lower === 'withrawdata') return 'Whether to store raw vectors alongside the index for reranking.';
        if (lower === 'dropratio') return 'The ratio of small vector values to drop during indexing. Range: [0, 1).';
        if (lower === 'lshband') return 'The number of LSH bands for MinHash-based similarity search.';
        if (lower === 'intermediategraphdegree') return 'The degree of the intermediate graph during CAGRA construction.';
        if (lower === 'graphdegree') return 'The degree of the final graph. Lower values use less memory; higher values improve recall.';
        if (lower === 'name') return 'The name of the index.';
        if (lower === 'params') return 'A map of custom index parameter key-value pairs.';
        if (lower === 'indextype') return 'The index algorithm type to use.';
        if (lower === 'jsoncasttype') return 'The data type to cast the JSON path value to (e.g., "string", "double").';
        if (lower === 'jsonpath') return 'The JSON path expression to index (e.g., "$.field_name").';

        // AnnParam parameters
        if (lower === 'level') return 'The search precision level (1-5). Higher values increase recall at the cost of latency.';
        if (lower === 'ef') return 'The size of the dynamic candidate list during search. Higher values improve recall but increase latency. Must be >= topK.';
        if (lower === 'nprobe') return 'The number of clusters to search. Higher values improve recall but increase latency.';
        if (lower === 'searchlist') return 'The size of the search list for DiskANN. Higher values improve recall at the cost of latency.';
        if (lower === 'reorderk') return 'The number of candidates to reorder using the original vectors. Must be >= topK.';

        const humanName = name.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
        return `The ${humanName}.`;
    }

    _buildGoCtorExample(symbol) {
        const isAnnParam = symbol.name.includes('AnnParam');

        if (isAnnParam) {
            const paramArgs = (symbol.params || []).map(p => {
                if (p.type === 'int') return '10';
                if (p.type === 'float64') return '0.5';
                return p.name;
            }).join(', ');
            let ex = `// Create ANN search parameters\n`;
            ex += `param := index.${symbol.name}(${paramArgs})\n\n`;
            ex += `// Use with a search option\n`;
            ex += `option := milvusclient.NewSearchOption("collection_name", limit, vectors).\n`;
            ex += `    WithAnnParam(param)`;
            return ex;
        }

        // Index constructor
        const paramArgs = (symbol.params || []).map(p => {
            if (p.name === 'metricType') return 'index.COSINE';
            if (p.name === 'nlist') return '128';
            if (p.name === 'm' && symbol.name === 'NewHNSWIndex') return '16';
            if (p.name === 'efConstruction') return '200';
            if (p.name === 'nbits') return '8';
            if (p.name === 'withRawData') return 'true';
            if (p.name === 'dropRatio') return '0.2';
            if (p.name === 'lshBand') return '10';
            if (p.name === 'intermediateGraphDegree') return '128';
            if (p.name === 'graphDegree') return '64';
            if (p.name === 'name') return '"my_index"';
            if (p.name === 'params') return 'map[string]string{"key": "value"}';
            if (p.name === 'indexType') return 'index.HNSW';
            if (p.name === 'jsonCastType') return '"double"';
            if (p.name === 'jsonPath') return '"$.price"';
            return p.name;
        }).join(', ');

        let ex = `// Create index configuration\n`;
        ex += `idx := index.${symbol.name}(${paramArgs})\n\n`;
        ex += `// Use with CreateIndex\n`;
        ex += `createIdxOption := milvusclient.NewCreateIndexOption("collection_name", "vector_field", idx)\n`;
        ex += `task, err := client.CreateIndex(ctx, createIdxOption)`;
        return ex;
    }

    _goDescription(name) {
        const map = {
            // Client
            New: 'This operation creates a new Milvus client instance with the specified configuration.',
            Close: 'This operation closes the client connection and releases associated resources.',
            GetServerVersion: 'This operation returns the version of the connected Milvus server.',

            // Collections
            CreateCollection: 'This operation creates a new collection with the specified schema and options.',
            ListCollections: 'This operation lists all collections in the current database.',
            DescribeCollection: 'This operation returns detailed information about a collection, including its schema and properties.',
            HasCollection: 'This operation checks whether a collection exists in the current database.',
            DropCollection: 'This operation drops a collection and all its data permanently.',
            RenameCollection: 'This operation renames an existing collection.',
            AlterCollectionProperties: 'This operation modifies properties of an existing collection.',
            DropCollectionProperties: 'This operation removes specified properties from a collection.',
            AlterCollectionFieldProperty: 'This operation modifies a property of a specific field in a collection.',
            GetCollectionStats: 'This operation returns statistics about a collection, such as row count.',
            AddCollectionField: 'This operation adds a new field to an existing collection schema.',
            CreateAlias: 'This operation creates an alias for a collection, allowing you to reference it by an alternative name.',
            DescribeAlias: 'This operation returns the details of a collection alias, including the collection it references.',
            DropAlias: 'This operation removes a collection alias.',
            AlterAlias: 'This operation reassigns an existing alias to a different collection.',
            ListAliases: 'This operation lists all aliases associated with a collection.',

            // Database
            UseDatabase: 'This operation switches the active database for the current client connection.',
            ListDatabase: 'This operation lists all databases in the Milvus instance.',
            CreateDatabase: 'This operation creates a new database.',
            DropDatabase: 'This operation drops a database and all its collections permanently.',
            DescribeDatabase: 'This operation returns detailed information about a database, including its properties.',
            AlterDatabaseProperties: 'This operation modifies properties of an existing database.',
            DropDatabaseProperties: 'This operation removes specified properties from a database.',

            // Management — Index
            CreateIndex: 'This operation creates an index on a specified field to accelerate vector similarity search or scalar filtering.',
            ListIndexes: 'This operation lists all indexes built on a specified collection.',
            DescribeIndex: 'This operation returns detailed information about an index, including its type and parameters.',
            DropIndex: 'This operation drops an index from a collection field.',
            AlterIndexProperties: 'This operation modifies properties of an existing index.',
            DropIndexProperties: 'This operation removes specified properties from an index.',

            // Management — Load/Release
            LoadCollection: 'This operation loads a collection into memory for search and query operations.',
            LoadPartitions: 'This operation loads specific partitions of a collection into memory.',
            GetLoadState: 'This operation returns the current load state and progress of a collection or partitions.',
            ReleaseCollection: 'This operation releases a collection from memory to free up resources.',
            ReleasePartitions: 'This operation releases specific partitions from memory.',
            RefreshLoad: 'This operation reloads a collection to include newly inserted data in search results.',

            // Management — Maintenance
            Flush: 'This operation flushes all inserted data to persistent storage, ensuring data durability.',
            Compact: 'This operation triggers compaction to merge small data segments into larger ones for better performance.',
            GetCompactionState: 'This operation returns the current state of a compaction operation.',
            GetPersistentSegmentInfo: 'This operation returns information about persistent data segments in a collection.',

            // Partitions
            CreatePartition: 'This operation creates a new partition in a collection for organizing data.',
            DropPartition: 'This operation drops a partition and all its data permanently.',
            HasPartition: 'This operation checks whether a partition exists in a collection.',
            ListPartitions: 'This operation lists all partitions in a collection.',
            GetPartitionStats: 'This operation returns statistics about a partition, such as row count.',

            // Vector
            Search: 'This operation performs an approximate nearest neighbor (ANN) search on vector fields.',
            Query: 'This operation retrieves entities that match a boolean filter expression.',
            Get: 'This operation retrieves entities by their primary key values.',
            HybridSearch: 'This operation performs a multi-vector search across multiple vector fields and merges results using a reranking strategy.',
            RunAnalyzer: 'This operation runs a text analyzer on input text and returns the tokenized output.',
            Insert: 'This operation inserts one or more entities into a collection.',
            Delete: 'This operation deletes entities from a collection by primary key values or filter expression.',
            Upsert: 'This operation inserts new entities or updates existing ones based on primary key values.',
            SearchIterator: 'This operation creates an iterator for paginating through large search result sets.',
            QueryIterator: 'This operation creates an iterator for paginating through large query result sets.',

            // Authentication
            ListUsers: 'This operation lists all users in the Milvus instance.',
            DescribeUser: 'This operation returns detailed information about a user, including their assigned roles.',
            CreateUser: 'This operation creates a new user with a username and password.',
            UpdatePassword: 'This operation updates the password for an existing user.',
            DropUser: 'This operation drops a user from the system.',
            ListRoles: 'This operation lists all roles in the Milvus instance.',
            CreateRole: 'This operation creates a new role for access control.',
            GrantRole: 'This operation assigns a role to a user.',
            RevokeRole: 'This operation removes a role from a user.',
            DropRole: 'This operation drops a role from the system.',
            DescribeRole: 'This operation returns detailed information about a role, including its granted privileges.',
            GrantPrivilege: 'This operation grants a specific privilege to a role on a resource.',
            RevokePrivilege: 'This operation revokes a specific privilege from a role.',
            CreatePrivilegeGroup: 'This operation creates a named group of privileges that can be granted together.',
            DropPrivilegeGroup: 'This operation drops a privilege group.',
            ListPrivilegeGroups: 'This operation lists all privilege groups and their included privileges.',
            AddPrivilegesToGroup: 'This operation adds privileges to an existing privilege group.',
            RemovePrivilegesFromGroup: 'This operation removes privileges from a privilege group.',
            GrantPrivilegeV2: 'This operation grants a privilege to a role using the v2 API with simplified parameters.',
            RevokePrivilegeV2: 'This operation revokes a privilege from a role using the v2 API.',
            BackupRBAC: 'This operation creates a full backup of RBAC metadata, including users, roles, grants, and privilege groups.',
            RestoreRBAC: 'This operation restores RBAC metadata from a previously created backup.',

            // ResourceGroup
            ListResourceGroups: 'This operation lists all resource groups in the Milvus instance.',
            CreateResourceGroup: 'This operation creates a new resource group for isolating compute resources.',
            DropResourceGroup: 'This operation drops a resource group.',
            DescribeResourceGroup: 'This operation returns detailed information about a resource group, including node capacity and replica distribution.',
            UpdateResourceGroup: 'This operation updates the configuration of an existing resource group.',
            TransferReplica: 'This operation transfers replicas from one resource group to another.',
            DescribeReplica: 'This operation returns information about collection replicas, including shard distribution across nodes.',

            // Index constructors
            NewAutoIndex: 'This function creates an AUTOINDEX configuration that automatically selects the best index algorithm based on data characteristics.',
            NewHNSWIndex: 'This function creates an HNSW (Hierarchical Navigable Small World) index configuration for high-recall vector search.',
            NewIvfFlatIndex: 'This function creates an IVF_FLAT index configuration that partitions vectors into clusters for balanced accuracy and speed.',
            NewFlatIndex: 'This function creates a FLAT (brute-force) index configuration for exact nearest neighbor search on small datasets.',
            NewBinFlatIndex: 'This function creates a BIN_FLAT index configuration for exact nearest neighbor search on binary vectors.',
            NewIvfPQIndex: 'This function creates an IVF_PQ index configuration that combines clustering with product quantization for memory-efficient search.',
            NewIvfSQ8Index: 'This function creates an IVF_SQ8 index configuration that uses 8-bit scalar quantization to reduce memory usage.',
            NewIvfRabitQIndex: 'This function creates an IVF_RABITQ index configuration that uses RaBitQ quantization for efficient vector compression.',
            NewBinIvfFlatIndex: 'This function creates a BIN_IVF_FLAT index configuration for binary vector search with inverted file indexing.',
            NewSCANNIndex: 'This function creates a SCANN (Scalable Nearest Neighbors) index configuration for fast approximate search.',
            NewDiskANNIndex: 'This function creates a DiskANN index configuration for disk-based approximate nearest neighbor search on large-scale datasets.',
            NewSparseInvertedIndex: 'This function creates a SPARSE_INVERTED_INDEX configuration for sparse vector search using an inverted index structure.',
            NewSparseWANDIndex: 'This function creates a SPARSE_WAND index configuration for sparse vector search using the Weak-AND algorithm.',
            NewGPUBruteForceIndex: 'This function creates a GPU brute-force index configuration for exact search accelerated by GPU hardware.',
            NewGPUIVPFlatIndex: 'This function creates a GPU IVF_FLAT index configuration for GPU-accelerated approximate search.',
            NewGPUIVPPQIndex: 'This function creates a GPU IVF_PQ index configuration for GPU-accelerated search with product quantization.',
            NewGPUCagraIndex: 'This function creates a GPU CAGRA index configuration for high-performance graph-based GPU search.',
            NewMinHashLSHIndex: 'This function creates a MinHash LSH index configuration for set similarity search using locality-sensitive hashing.',
            NewTrieIndex: 'This function creates a Trie index configuration for efficient prefix-based string field filtering.',
            NewInvertedIndex: 'This function creates an inverted index configuration for efficient scalar field filtering.',
            NewSortedIndex: 'This function creates a sorted index configuration for range-based scalar field queries.',
            NewBitmapIndex: 'This function creates a bitmap index configuration for efficient filtering on low-cardinality scalar fields.',
            NewRTreeIndex: 'This function creates an R-tree index configuration for spatial data queries on geometry fields.',
            NewGenericIndex: 'This function creates a generic index configuration with custom parameters for advanced use cases.',
            NewJSONPathIndex: 'This function creates a JSON path index configuration for efficient filtering on specific JSON field paths.',

            // AnnParam constructors
            NewCustomAnnParam: 'This function creates a custom ANN search parameter set that allows you to configure arbitrary search parameters.',
            NewAutoAnnParam: 'This function creates an ANN search parameter set for AUTOINDEX with a configurable search precision level.',
            NewHNSWAnnParam: 'This function creates an ANN search parameter set for HNSW index with a configurable ef (search scope) value.',
            NewIvfAnnParam: 'This function creates an ANN search parameter set for IVF-family indexes with a configurable nprobe (number of clusters to search).',
            NewIvfRabitQAnnParam: 'This function creates an ANN search parameter set for IVF_RABITQ index with a configurable nprobe value.',
            NewDiskAnnParam: 'This function creates an ANN search parameter set for DiskANN index with a configurable search list size.',
            NewSCANNAnnParam: 'This function creates an ANN search parameter set for SCANN index with configurable nprobe and reorder_k values.',
            NewSparseAnnParam: 'This function creates an ANN search parameter set for sparse vector indexes.',
            NewMinHashLSHAnnParam: 'This function creates an ANN search parameter set for MinHash LSH index.',
        };
        return map[name] || `This operation performs the ${name} action.`;
    }

    _goParamDescription(name, type, methodName) {
        const lower = name.toLowerCase();

        // Common param patterns
        if (lower === 'collectionname' || (lower === 'name' && /Collection|Alias|Partition|Database|Index/.test(methodName)))
            return 'The name of the target collection.';
        if (lower === 'name' && /Role|User|PrivilegeGroup/.test(methodName))
            return `The name of the ${methodName.replace(/^(Create|Drop|Describe|List|Grant|Revoke|Add|Remove|Update|Alter|Backup|Restore)/, '').replace(/s$/, '').toLowerCase() || 'resource'}.`;
        if (lower === 'name' && /ResourceGroup/.test(methodName))
            return 'The name of the resource group.';
        if (lower === 'name') return 'The name of the target resource.';
        if (lower === 'collectionschema') return 'The schema defining the collection fields and their data types.';
        if (lower === 'schema') return 'The schema definition for the collection.';
        if (lower === 'dim') return 'The dimensionality of the vector field.';
        if (lower === 'alias') return 'The alias name to assign.';
        if (lower === 'newname') return 'The new name for the collection.';
        if (lower === 'rolename') return 'The name of the role.';
        if (lower === 'username') return 'The name of the user.';
        if (lower === 'password') return 'The password for the user.';
        if (lower === 'newpassword') return 'The new password to set.';
        if (lower === 'oldpassword') return 'The current password for verification.';
        if (lower === 'groupname') return 'The name of the privilege group.';
        if (lower === 'fieldname') return 'The name of the field.';
        if (lower === 'indexname') return 'The name of the index.';
        if (lower === 'indextype') return 'The type of index to create.';
        if (lower === 'partitionname' || lower === 'partitionnames') return 'The name(s) of the partition(s).';
        if (lower === 'expr' || lower === 'filter') return 'A boolean expression for filtering entities.';
        if (lower === 'ids') return 'The primary key values of the entities to retrieve.';
        if (lower === 'limit') return 'The maximum number of results to return.';
        if (lower === 'vectors') return 'The query vectors for the search.';
        if (lower === 'dbname') return 'The name of the database.';
        if (lower === 'privilegename') return 'The name of the privilege.';
        if (lower === 'privileges') return 'The list of privileges to include.';
        if (lower === 'objecttype') return 'The type of object the privilege applies to (e.g., Global, Collection).';
        if (lower === 'objectname') return 'The name of the object the privilege applies to.';
        if (lower === 'meta') return 'The RBAC metadata to restore.';
        if (lower === 'sourcergname') return 'The name of the source resource group.';
        if (lower === 'targetrgname') return 'The name of the target resource group.';
        if (lower === 'numreplica') return 'The number of replicas to transfer.';
        if (lower === 'config') return 'The client configuration including address, credentials, and connection options.';
        if (type && type.includes('Schema')) return 'The schema definition for the collection.';
        if (type && type.includes('entity.Vector')) return 'The query vectors for similarity search.';

        // Generic fallback based on type
        if (type === 'string') return `The ${name.replace(/([A-Z])/g, ' $1').trim().toLowerCase()}.`;
        if (type === 'int64' || type === 'int32' || type === 'int') return `The ${name.replace(/([A-Z])/g, ' $1').trim().toLowerCase()} value.`;
        if (type === 'bool') return `Whether to enable ${name.replace(/([A-Z])/g, ' $1').trim().toLowerCase()}.`;

        return `The ${name.replace(/([A-Z])/g, ' $1').trim().toLowerCase()}.`;
    }

    _goOptionDescription(methodName, paramStr, parentMethod) {
        const field = methodName.replace(/^With/, '');
        const lower = field.toLowerCase();

        // Specific patterns
        if (lower === 'autoid') return 'Sets whether to automatically generate IDs for inserted entities.';
        if (lower === 'shardnum') return 'Sets the number of shards for data distribution across nodes.';
        if (lower === 'dynamicschema') return 'Enables or disables the dynamic schema feature for flexible field insertion.';
        if (lower === 'varcharpk') return 'Configures the collection to use varchar as the primary key type with a maximum length.';
        if (lower === 'indexoptions') return 'Specifies the index options to apply when creating the collection.';
        if (lower === 'property') return 'Sets a custom property key-value pair on the resource.';
        if (lower === 'properties') return 'Sets custom property key-value pairs on the resource.';
        if (lower === 'consistencylevel') return 'Sets the consistency level for the operation (Strong, Bounded, Session, or Eventually).';
        if (lower === 'metrictype') return 'Sets the distance metric type for vector similarity search (e.g., COSINE, L2, IP).';
        if (lower === 'pkfieldname') return 'Sets the name of the primary key field.';
        if (lower === 'vectorfieldname') return 'Sets the name of the vector field.';
        if (lower === 'numpartitions') return 'Sets the number of partitions for the collection.';
        if (lower === 'partitions' || lower === 'partitionnames') return 'Limits the operation to the specified partitions.';
        if (lower === 'filter') return 'Applies a boolean filter expression to narrow results.';
        if (lower === 'templateparam') return 'Sets a template parameter for expression evaluation.';
        if (lower === 'offset') return 'Sets the number of results to skip before returning matches.';
        if (lower === 'outputfields') return 'Specifies which fields to include in the returned results.';
        if (lower === 'annsfield') return 'Specifies which vector field to search against.';
        if (lower === 'groupbyfield') return 'Groups search results by a scalar field value.';
        if (lower === 'groupsize') return 'Sets the number of results to return per group.';
        if (lower === 'strictgroupsize') return 'Enforces exact group size for each group in results.';
        if (lower === 'ignoregrowing') return 'Skips searching in growing segments for faster but potentially incomplete results.';
        if (lower === 'annparam') return 'Sets the approximate nearest neighbor search parameters (e.g., nprobe, ef).';
        if (lower === 'searchparam') return 'Sets a custom search parameter key-value pair.';
        if (lower === 'functionreranker') return 'Applies a function-based reranker to the search results.';
        if (lower === 'limit') return 'Sets the maximum number of results to return.';
        if (lower === 'topk') return 'Sets the number of nearest neighbors to retrieve.';
        if (lower === 'indexname') return 'Sets the name of the index.';
        if (lower === 'dbname') return 'Specifies the database to use for the operation.';
        if (lower === 'columnbased' || lower === 'columns') return 'Uses column-based data format for the operation.';
        if (lower === 'batchsize') return 'Sets the number of entities to fetch per iteration batch.';
        if (lower === 'ranker') return 'Sets the reranking strategy for hybrid search results (e.g., RRF, WeightedRanker).';
        if (lower === 'refresh') return 'Enables refresh mode to reload newly inserted data.';
        if (lower === 'loadfields') return 'Specifies which fields to load into memory.';
        if (lower === 'skipdynamicfield') return 'Skips loading the dynamic field to reduce memory usage.';
        if (lower === 'replicanumber') return 'Sets the number of in-memory replicas for read throughput.';
        if (lower === 'propertykey' || lower === 'propertykeys') return 'Specifies the property key(s) to drop.';
        if (lower === 'checkinterval') return 'Sets the polling interval for checking task completion.';

        // Generic fallback
        const humanName = field.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
        return `Sets the ${humanName} for the operation.`;
    }

    _goReturnDescription(retType, methodName) {
        if (retType === 'error') return 'Returns nil on success, or an error describing what went wrong.';

        // Named returns with error suffix
        const cleaned = retType
            .replace(/,\s*err\s+error\s*$/, '')
            .replace(/,\s*error\s*$/, '')
            .trim();

        if (!cleaned || cleaned === 'error') return 'Returns nil on success, or an error describing what went wrong.';

        // Common return type descriptions
        if (cleaned.includes('[]string') || cleaned.includes('[]string'))
            return `A list of names. Returns an error if the operation fails.`;
        if (cleaned.includes('bool'))
            return `A boolean indicating whether the resource exists. Returns an error if the operation fails.`;
        if (cleaned.includes('Collection'))
            return `The collection description including schema, fields, and properties. Returns an error if the operation fails.`;
        if (cleaned.includes('Database'))
            return `The database description including properties. Returns an error if the operation fails.`;
        if (cleaned.includes('Alias'))
            return `The alias details including the associated collection name. Returns an error if the operation fails.`;
        if (cleaned.includes('ResultSet'))
            return `The search or query results containing matched entities with scores and fields. Returns an error if the operation fails.`;
        if (cleaned.includes('InsertResult'))
            return `The insert result containing the IDs of the newly inserted entities. Returns an error if the operation fails.`;
        if (cleaned.includes('DeleteResult'))
            return `The delete result. Returns an error if the operation fails.`;
        if (cleaned.includes('UpsertResult'))
            return `The upsert result containing the IDs of the affected entities. Returns an error if the operation fails.`;
        if (cleaned.includes('LoadTask'))
            return `A LoadTask that can be used to wait for the load operation to complete. Returns an error if the operation fails.`;
        if (cleaned.includes('FlushTask'))
            return `A FlushTask that can be used to wait for the flush to complete. Returns an error if the operation fails.`;
        if (cleaned.includes('CreateIndexTask'))
            return `A CreateIndexTask that can be used to wait for the index build to complete. Returns an error if the operation fails.`;
        if (cleaned.includes('LoadState'))
            return `The current load state of the collection or partitions. Returns an error if the operation fails.`;
        if (cleaned.includes('CompactionState'))
            return `The current state of the compaction operation. Returns an error if the operation fails.`;
        if (cleaned.includes('IndexDescription'))
            return `The index details including type, metric, and parameters. Returns an error if the operation fails.`;
        if (cleaned.includes('Segment'))
            return `A list of persistent segment details. Returns an error if the operation fails.`;
        if (cleaned.includes('User'))
            return `The user description including assigned roles. Returns an error if the operation fails.`;
        if (cleaned.includes('Role'))
            return `The role details including granted privileges. Returns an error if the operation fails.`;
        if (cleaned.includes('RBACMeta'))
            return `The full RBAC metadata snapshot including users, roles, grants, and privilege groups. Returns an error if the operation fails.`;
        if (cleaned.includes('PrivilegeGroup'))
            return `A list of privilege groups with their included privileges. Returns an error if the operation fails.`;
        if (cleaned.includes('ResourceGroup'))
            return `The resource group description including node configurations and capacity. Returns an error if the operation fails.`;
        if (cleaned.includes('ReplicaInfo'))
            return `A list of replica details including shard distribution. Returns an error if the operation fails.`;
        if (cleaned.includes('AnalyzerResult'))
            return `The analyzer output showing how the input text is tokenized. Returns an error if the operation fails.`;
        if (cleaned.includes('SearchIterator'))
            return `A SearchIterator for paginating through search results. Returns an error if the operation fails.`;
        if (cleaned.includes('QueryIterator'))
            return `A QueryIterator for paginating through query results. Returns an error if the operation fails.`;
        if (cleaned.includes('map'))
            return `A map of statistics key-value pairs. Returns an error if the operation fails.`;
        if (cleaned.includes('string'))
            return `The requested string value. Returns an error if the operation fails.`;
        if (cleaned.includes('int64'))
            return `The numeric result value. Returns an error if the operation fails.`;
        if (cleaned.includes('Client'))
            return `A connected Client instance ready for use. Returns an error if the connection fails.`;

        return `The operation result. Returns an error if the operation fails.`;
    }

    _buildGoRequestSyntax(symbol) {
        const ctorName = symbol.optionType
            ? `New${symbol.optionType}`
            : `New${symbol.name}Option`;

        // Build constructor call with params
        const ctorParams = (symbol.params || [])
            .map(p => p.name)
            .join(', ');

        const withMethods = (symbol.optionMethods || [])
            .map(opt => {
                // Use placeholder arg values
                const args = opt.params || '';
                const argNames = args.split(',')
                    .map(a => a.trim().split(/\s+/)[0])
                    .filter(Boolean)
                    .join(', ');
                return `    ${opt.name}(${argNames})`;
            });

        let syntax = `option := milvusclient.${ctorName}(${ctorParams})`;

        if (withMethods.length > 0) {
            syntax += '.\n' + withMethods.join('.\n');
        }

        // Show alt constructors as comments
        if (symbol.altConstructors && symbol.altConstructors.length > 0) {
            syntax += '\n\n// Alternative constructor(s):';
            for (const alt of symbol.altConstructors) {
                syntax += `\n// option := milvusclient.${alt.fullSignature}`;
            }
        }

        // Show method call
        if (symbol.name === 'New') {
            syntax += `\n\nclient, err := milvusclient.New(ctx, config)`;
        } else {
            const retType = symbol.returnType || 'error';
            if (retType === 'error') {
                syntax += `\n\nerr := client.${symbol.name}(ctx, option)`;
            } else {
                syntax += `\n\nresult, err := client.${symbol.name}(ctx, option)`;
            }
        }

        return syntax;
    }

    _buildGoExample(symbol) {
        let ex = 'ctx, cancel := context.WithCancel(context.Background())\n';
        ex += 'defer cancel()\n\n';
        ex += 'client, err := milvusclient.New(ctx, &milvusclient.ClientConfig{\n';
        ex += '    Address: "localhost:19530",\n';
        ex += '})\n';
        ex += 'if err != nil {\n';
        ex += '    log.Fatal("failed to create client:", err)\n';
        ex += '}\n';
        ex += 'defer client.Close(ctx)\n\n';
        ex += `// TODO: ${symbol.name} usage example\n`;
        return ex;
    }

    _goStructScaffold(symbol) {
        let md = '';

        md += `${symbol.docstring || `<!-- TODO: Brief description of ${symbol.name} -->`}\n\n`;

        // Struct definition with exported fields
        md += `\`\`\`go\n${symbol.signature}\n\`\`\`\n\n`;

        // Builder pattern: constructor + With* methods
        const hasBuilder = symbol.optionMethods && symbol.optionMethods.length > 0;

        if (hasBuilder) {
            md += `## Constructor{#constructor}\n\n`;
            md += `\`\`\`go\n${this._buildGoEntityConstructor(symbol)}\n\`\`\`\n\n`;

            if (symbol.params && symbol.params.length > 0) {
                md += `**PARAMETERS:**\n\n`;
                for (const p of symbol.params) {
                    const desc = this._goParamDescription(p.name, p.type, symbol.name);
                    md += `- **${p.name}** (*${p.type}*)\n\n`;
                    md += `    ${desc}\n\n`;
                }
            }

            md += `**BUILDER METHODS:**\n\n`;
            for (const opt of symbol.optionMethods) {
                const desc = opt.description || this._goEntityWithDescription(opt.name, opt.params, symbol.name);
                md += `- \`${opt.fullSignature}\`\n\n`;
                md += `    ${desc}\n\n`;
            }
        } else {
            // Simple struct — show FIELDS
            if (symbol.fields && symbol.fields.length > 0) {
                md += `**FIELDS:**\n\n`;
                for (const f of symbol.fields) {
                    const desc = f.description || this._goFieldDescription(f.name, f.type, symbol.name);
                    if (f.type === '(embedded)') {
                        md += `- **${f.name}** *(embedded)*\n\n`;
                        md += `    Inherits methods from ${f.name}.\n\n`;
                    } else {
                        md += `- **${f.name}** (*${f.type}*)\n\n`;
                        md += `    ${desc}\n\n`;
                    }
                }
            }
        }

        // Exported methods (Await, GetColumn, etc.)
        if (symbol.methods && symbol.methods.length > 0) {
            md += `**METHODS:**\n\n`;
            for (const m of symbol.methods) {
                const retStr = m.returnType ? ` ${m.returnType}` : '';
                const desc = m.description || this._goStructMethodDescription(m.name, symbol.name);
                md += `- \`${m.name}(${m.params})${retStr}\`\n\n`;
                md += `    ${desc}\n\n`;
            }
        }

        md += `## Example{#example}\n\n`;
        md += `\`\`\`go\n${symbol.example || this._buildGoEntityExample(symbol)}\n\`\`\`\n`;

        return md;
    }

    _goEnumScaffold(symbol) {
        let md = '';

        md += `${symbol.docstring || `<!-- TODO: Brief description of ${symbol.name} -->`}\n\n`;

        md += `\`\`\`go\n${symbol.signature}\n\`\`\`\n\n`;

        if (symbol.values && symbol.values.length > 0) {
            md += `**VALUES:**\n\n`;
            for (const v of symbol.values) {
                // Prefer our curated description; fall back to source comment
                const curated = this._goEnumValueDescription(v.name, v.value, symbol.name);
                const desc = curated || v.description || `${v.name}.`;
                const valStr = v.value ? ` = ${v.value}` : '';
                md += `- **${v.name}**${valStr}\n\n`;
                md += `    ${desc}\n\n`;
            }
        }

        md += `## Example{#example}\n\n`;
        md += `\`\`\`go\n${this._buildGoEnumExample(symbol)}\n\`\`\`\n`;

        return md;
    }

    _goInterfaceScaffold(symbol) {
        let md = '';

        md += `${symbol.docstring || `<!-- TODO: Brief description of ${symbol.name} -->`}\n\n`;

        md += `\`\`\`go\n${symbol.signature}\n\`\`\`\n\n`;

        if (symbol.methods && symbol.methods.length > 0) {
            md += `**METHODS:**\n\n`;
            for (const m of symbol.methods) {
                const desc = this._goInterfaceMethodDescription(m.name, m.returnType, symbol.name);
                md += `- \`${m.fullSignature}\`\n\n`;
                md += `    ${desc}\n\n`;
            }
        }

        md += `## Example{#example}\n\n`;
        md += `\`\`\`go\n${this._buildGoInterfaceExample(symbol)}\n\`\`\`\n`;

        return md;
    }

    _buildGoEntityConstructor(symbol) {
        const pkg = symbol.pkg === 'entity' ? 'entity' : symbol.pkg === 'index' ? 'index' : 'milvusclient';
        const ctorName = `New${symbol.name}`;
        const params = (symbol.params || []).map(p => p.name).join(', ');

        let syntax = `${pkg}.${ctorName}(${params})`;

        if (symbol.optionMethods.length > 0) {
            const withCalls = symbol.optionMethods.slice(0, 4).map(opt => {
                const args = opt.params.split(',')
                    .map(a => a.trim().split(/\s+/)[0])
                    .filter(Boolean)
                    .join(', ');
                return `    ${opt.name}(${args})`;
            });
            syntax += '.\n' + withCalls.join('.\n');
            if (symbol.optionMethods.length > 4) {
                syntax += '.\n    // ...';
            }
        }

        return syntax;
    }

    _buildGoEntityExample(symbol) {
        const pkg = symbol.pkg === 'entity' ? 'entity' : symbol.pkg === 'index' ? 'index' : 'milvusclient';
        if (symbol.optionMethods && symbol.optionMethods.length > 0) {
            return `// Create a new ${symbol.name}\nobj := ${pkg}.New${symbol.name}().\n    // Configure with builder methods\n// TODO: Complete example`;
        }
        return `// ${symbol.name} is returned by API calls\n// TODO: Usage example`;
    }

    _buildGoEnumExample(symbol) {
        const pkg = symbol.pkg === 'entity' ? 'entity' : symbol.pkg === 'index' ? 'index' : 'milvusclient';
        const firstVal = symbol.values && symbol.values.length > 0 ? symbol.values[0].name : 'Value';
        return `// Use ${symbol.name} constants\nval := ${pkg}.${firstVal}\n// TODO: Usage example`;
    }

    _buildGoInterfaceExample(symbol) {
        return `// ${symbol.name} is typically obtained from API calls or constructors\n// TODO: Usage example`;
    }

    _goEntityWithDescription(methodName, paramStr, entityName) {
        const field = methodName.replace(/^With/, '');
        const lower = field.toLowerCase();

        // Schema builder methods
        if (entityName === 'Schema') {
            if (lower === 'name') return 'Sets the collection name for this schema.';
            if (lower === 'description') return 'Sets the description of the collection.';
            if (lower === 'autoid') return 'Enables or disables auto ID generation for the collection.';
            if (lower === 'dynamicfieldenabled') return 'Enables or disables dynamic field support for flexible data insertion.';
            if (lower === 'field') return 'Adds a field definition to the schema.';
            if (lower === 'function') return 'Adds a function definition (e.g., BM25, text embedding) to the schema.';
        }
        // Field builder methods
        if (entityName === 'Field') {
            if (lower === 'name') return 'Sets the name of the field.';
            if (lower === 'description') return 'Sets the description of the field.';
            if (lower === 'datatype') return 'Sets the data type of the field (e.g., Int64, VarChar, FloatVector).';
            if (lower === 'isprimarykey') return 'Sets whether this field is the primary key.';
            if (lower === 'isautoid') return 'Enables auto ID generation for this field.';
            if (lower === 'isdynamic') return 'Marks this as a dynamic field.';
            if (lower === 'ispartitionkey') return 'Sets this field as a partition key for data routing.';
            if (lower === 'isclusteringkey') return 'Sets this field as a clustering key for data organization.';
            if (lower === 'nullable') return 'Sets whether this field allows null values.';
            if (lower === 'dim') return 'Sets the vector dimension for this field.';
            if (lower === 'maxlength') return 'Sets the maximum character length for varchar fields.';
            if (lower === 'elementtype') return 'Sets the element type for array fields.';
            if (lower === 'maxcapacity') return 'Sets the maximum capacity for array fields.';
            if (lower === 'enableanalyzer') return 'Enables the text analyzer for full-text search on this field.';
            if (lower === 'analyzerparams') return 'Sets the analyzer parameters for text processing.';
            if (lower === 'multianalyzerparams') return 'Sets multiple analyzer configurations for the field.';
            if (lower === 'enablematch') return 'Enables text matching for this field.';
            if (lower === 'typeparams') return 'Sets a type parameter key-value pair for the field.';
            if (lower === 'structschema') return 'Sets the struct schema for struct-type fields.';
            if (lower.startsWith('defaultvalue')) return 'Sets the default value for the field.';
        }
        // Function builder methods
        if (entityName === 'Function') {
            if (lower === 'name') return 'Sets the name of the function.';
            if (lower === 'inputfields') return 'Sets the input field names for the function.';
            if (lower === 'outputfields') return 'Sets the output field names for the function.';
            if (lower === 'type') return 'Sets the function type (BM25, TextEmbedding, Rerank).';
            if (lower === 'param') return 'Sets a function parameter key-value pair.';
        }

        // Generic fallback
        const humanName = field.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
        return `Sets the ${humanName}.`;
    }

    _goFieldDescription(name, type, structName) {
        const lower = name.toLowerCase();

        if (lower === 'id') return 'The unique identifier.';
        if (lower === 'name') return 'The name.';
        if (lower === 'description') return 'A human-readable description.';
        if (lower === 'schema') return 'The collection schema with field definitions.';
        if (lower === 'consistencylevel') return 'The consistency level for read operations.';
        if (lower === 'shardnum') return 'The number of shards for data distribution.';
        if (lower === 'properties') return 'Custom key-value properties.';
        if (lower === 'loaded') return 'Whether the resource is loaded into memory.';
        if (lower === 'autoid') return 'Whether auto ID generation is enabled.';
        if (lower === 'fields') return 'The list of field definitions.';
        if (lower === 'functions') return 'The list of attached functions.';
        if (lower === 'collectionname') return 'The name of the associated collection.';
        if (lower === 'dbname') return 'The name of the associated database.';
        if (lower === 'alias') return 'The alias name.';
        if (lower === 'rolename') return 'The name of the role.';
        if (lower === 'username') return 'The name of the user.';
        if (lower === 'roles') return 'The list of assigned roles.';
        if (lower === 'privileges') return 'The list of granted privileges.';
        if (lower === 'groupname') return 'The name of the privilege group.';
        if (lower === 'state') return 'The current state.';
        if (lower === 'progress') return 'The progress percentage.';
        if (lower === 'capacity') return 'The resource group capacity.';
        if (lower === 'config') return 'The configuration settings.';
        if (lower === 'numavailablenode') return 'The number of available nodes.';
        if (lower === 'resultcount') return 'The number of results returned.';
        if (lower === 'scores') return 'The distance scores from the target vector.';
        if (lower === 'recall') return 'The recall estimation for the search (Zilliz Cloud only).';
        if (lower === 'err') return 'The error if the operation failed, nil otherwise.';
        if (lower === 'numrows') return 'The number of rows in the segment.';
        if (lower === 'collectionid') return 'The ID of the collection.';
        if (lower === 'replicaid') return 'The replica ID.';
        if (lower === 'nodes') return 'The list of node information.';
        if (lower === 'totalrows') return 'The total number of rows.';
        if (lower === 'indexedrows') return 'The number of indexed rows.';
        if (lower === 'pendingindexrows') return 'The number of rows pending indexing.';
        if (lower === 'insertcount' || lower === 'deletecount' || lower === 'upsertcount') return 'The number of affected entities.';
        if (lower === 'ids') return 'The IDs of the affected entities.';
        if (lower === 'primarykey') return 'Whether this field is the primary key.';
        if (lower === 'datatype') return 'The data type of the field.';
        if (lower === 'typeparams') return 'Type parameters (e.g., dim, max_length).';
        if (lower === 'indexparams') return 'Index parameters for the field.';
        if (lower === 'isdynamic') return 'Whether this is a dynamic field.';
        if (lower === 'ispartitionkey') return 'Whether this field is a partition key.';
        if (lower === 'isclusteringkey') return 'Whether this field is a clustering key.';
        if (lower === 'elementtype') return 'The element type for array fields.';
        if (lower === 'nullable') return 'Whether null values are allowed.';
        if (lower === 'enabledynamicfield') return 'Whether dynamic fields are enabled.';
        if (lower === 'groupbyvalue') return 'The group-by column used for grouped results.';
        if (lower === 'numloadedReplica') return 'Map of loaded replicas per collection.';
        if (lower === 'numoutgoingnode') return 'Map of outgoing nodes per collection.';
        if (lower === 'numincomingnode') return 'Map of incoming nodes per collection.';
        if (lower === 'updatetimestamp') return 'The last update timestamp for change detection.';

        // Generic
        const humanName = name.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
        return `The ${humanName}.`;
    }

    _goStructMethodDescription(name, structName) {
        if (name === 'Await') return 'Blocks until the async operation completes or the context is cancelled. Returns an error if the operation fails.';
        if (name === 'GetColumn') return 'Returns the data column for the specified field name.';
        if (name === 'Len') return 'Returns the number of results.';
        if (name === 'Slice') return 'Returns a subset of the results within the specified range.';
        if (name === 'Unmarshal') return 'Unmarshals the results into the provided Go struct.';
        if (name === 'Flushed') return 'Returns whether the segment has been flushed to disk.';
        if (name === 'GetFlushStats') return 'Returns flush statistics including segment IDs and flush timestamp.';
        if (name === 'Next') return 'Returns the next batch of results. Returns io.EOF when all results have been consumed.';

        const humanName = name.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
        return `${humanName.charAt(0).toUpperCase() + humanName.slice(1)}.`;
    }

    _goEnumValueDescription(name, value, enumName) {
        // FieldType
        if (enumName === 'FieldType') {
            const map = {
                FieldTypeNone: 'No type specified.', FieldTypeBool: 'Boolean type.',
                FieldTypeInt8: '8-bit integer type.', FieldTypeInt16: '16-bit integer type.',
                FieldTypeInt32: '32-bit integer type.', FieldTypeInt64: '64-bit integer type.',
                FieldTypeFloat: '32-bit floating point type.', FieldTypeDouble: '64-bit floating point type.',
                FieldTypeTimestamptz: 'Timezone-aware timestamp type.',
                FieldTypeString: 'String type (alias for VarChar).',
                FieldTypeVarChar: 'Variable-length string type.',
                FieldTypeArray: 'Array type with a fixed element type.',
                FieldTypeJSON: 'JSON document type.',
                FieldTypeGeometry: 'Geometry spatial type.',
                FieldTypeBinaryVector: 'Binary vector type.',
                FieldTypeFloatVector: '32-bit float vector type.',
                FieldTypeFloat16Vector: '16-bit float vector type.',
                FieldTypeBFloat16Vector: 'Brain floating-point 16-bit vector type.',
                FieldTypeSparseVector: 'Sparse vector type.',
                FieldTypeInt8Vector: '8-bit integer vector type.',
                FieldTypeStruct: 'Struct type with nested fields.',
            };
            return map[name] || null;
        }
        // ConsistencyLevel
        if (enumName === 'ConsistencyLevel') {
            const map = {
                ClStrong: 'Strong consistency. All operations are immediately visible.',
                ClBounded: 'Bounded staleness with a default 5-second tolerance window.',
                ClSession: 'Session consistency. Reads see writes from the same session.',
                ClEventually: 'Eventually consistent. Best query performance.',
                ClCustomized: 'Custom consistency with a user-specified guarantee timestamp.',
            };
            return map[name] || null;
        }
        // CompactionState
        if (enumName === 'CompactionState') {
            const map = {
                CompactionStateRunning: 'The compaction operation is currently executing.',
                CompactionStateCompleted: 'The compaction operation has completed.',
            };
            return map[name] || null;
        }
        // MetricType
        if (enumName === 'MetricType') {
            const map = {
                L2: 'Euclidean (L2) distance. Smaller values indicate greater similarity.',
                IP: 'Inner product distance. Larger values indicate greater similarity.',
                COSINE: 'Cosine similarity. Values range from -1 to 1, with 1 being most similar.',
                HAMMING: 'Hamming distance for binary vectors.',
                JACCARD: 'Jaccard distance for binary vectors.',
                TANIMOTO: 'Tanimoto distance for binary vectors.',
                SUBSTRUCTURE: 'Substructure distance for binary vectors.',
                SUPERSTRUCTURE: 'Superstructure distance for binary vectors.',
                BM25: 'BM25 relevance scoring for full-text search.',
            };
            return map[name] || null;
        }
        // IndexType
        if (enumName === 'IndexType') {
            const map = {
                Flat: 'Flat (brute-force) index. Exact but slow for large datasets.',
                BinFlat: 'Flat index for binary vectors.',
                IvfFlat: 'IVF with flat quantization. Good accuracy/speed balance.',
                BinIvfFlat: 'IVF-Flat for binary vectors.',
                IvfPQ: 'IVF with product quantization. Memory-efficient.',
                IvfSQ8: 'IVF with 8-bit scalar quantization.',
                IvfRabitQ: 'IVF with RaBitQ quantization.',
                HNSW: 'Hierarchical Navigable Small World graph. High recall and fast search.',
                IvfHNSW: 'Combined IVF and HNSW index.',
                AUTOINDEX: 'Automatically selects the best index type.',
                DISKANN: 'Disk-based ANN index for large-scale datasets.',
                SCANN: 'ScaNN (Scalable Nearest Neighbors) index.',
                SparseInverted: 'Inverted index for sparse vectors.',
                SparseWAND: 'WAND algorithm for sparse vector search.',
                Trie: 'Trie index for string fields.',
                Sorted: 'Sorted index for scalar fields.',
                Inverted: 'Inverted index for scalar fields.',
                BITMAP: 'Bitmap index for low-cardinality scalar fields.',
                MinHashLSH: 'MinHash LSH index for set similarity.',
                GPUIvfFlat: 'GPU-accelerated IVF-Flat index.',
                GPUIvfPQ: 'GPU-accelerated IVF-PQ index.',
                GPUCagra: 'GPU-accelerated CAGRA graph index.',
                GPUBruteForce: 'GPU-accelerated brute-force index.',
                RTREE: 'R-tree index for spatial data.',
            };
            return map[name] || null;
        }
        // Unknown enum — return null to fall back to source description
        return null;
    }

    _goInterfaceMethodDescription(name, returnType, interfaceName) {
        if (interfaceName === 'Vector') {
            if (name === 'Dim') return 'Returns the dimensionality of the vector.';
            if (name === 'Serialize') return 'Serializes the vector data to bytes.';
            if (name === 'FieldType') return 'Returns the FieldType enum value for this vector type.';
        }
        if (interfaceName === 'Index') {
            if (name === 'Name') return 'Returns the name of the index.';
            if (name === 'IndexType') return 'Returns the index algorithm type.';
            if (name === 'Params') return 'Returns the index parameters as a key-value map.';
        }
        if (interfaceName === 'AnnParam') {
            if (name === 'Params') return 'Returns the search parameters as a key-value map.';
        }
        if (name === 'Next') return 'Returns the next batch of results. Returns io.EOF when all results have been consumed.';

        const humanName = name.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
        return `Returns the ${humanName}.`;
    }

    _classScaffold(symbol) {
        let md = '';

        md += `${symbol.docstring ? symbol.docstring.split('\n')[0].trim() : `<!-- TODO: Brief description of ${symbol.name} -->`}\n\n`;

        md += `## Constructor\n\n`;
        md += `\`\`\`python\n${symbol.signature}\n\`\`\`\n\n`;

        if (symbol.baseClasses.length > 0) {
            md += `**Inherits from:** ${symbol.baseClasses.join(', ')}\n\n`;
        }

        md += `## Methods\n\n`;
        md += `<!-- TODO: List key methods with brief descriptions -->\n\n`;

        md += `## Examples\n\n`;
        md += `\`\`\`python\n<!-- TODO: Usage example -->\n\`\`\`\n`;

        return md;
    }

    _enumScaffold(symbol) {
        let md = '';

        md += `${symbol.docstring ? symbol.docstring.split('\n')[0].trim() : `<!-- TODO: Brief description of ${symbol.name} -->`}\n\n`;

        md += `## Values\n\n`;
        md += `\`\`\`python\n${symbol.signature}\n\`\`\`\n\n`;
        md += `<!-- TODO: Document enum values and their meanings -->\n\n`;

        md += `## Examples\n\n`;
        md += `\`\`\`python\n<!-- TODO: Usage example -->\n\`\`\`\n`;

        return md;
    }

    _buildSignature(symbol) {
        if (symbol.kind === 'method' && symbol.parentClass) {
            // Reconstruct clean signature without self
            const params = symbol.params.map(p => {
                let s = p.kind === 'args' ? `*${p.name}` : p.kind === 'kwargs' ? `**${p.name}` : p.name;
                if (p.type) s += `: ${p.type}`;
                if (p.default !== null && p.default !== undefined) s += ` = ${p.default}`;
                return s;
            });
            const ret = symbol.returnType ? ` -> ${symbol.returnType}` : '';
            return `${symbol.name}(\n    ${params.join(',\n    ')}\n)${ret}`;
        }
        // For top-level functions, use the original signature but format it
        if (symbol.params.length > 0) {
            const params = symbol.params.map(p => {
                let s = p.kind === 'args' ? `*${p.name}` : p.kind === 'kwargs' ? `**${p.name}` : p.name;
                if (p.type) s += `: ${p.type}`;
                if (p.default !== null && p.default !== undefined) s += ` = ${p.default}`;
                return s;
            });
            const ret = symbol.returnType ? ` -> ${symbol.returnType}` : '';
            return `${symbol.name}(\n    ${params.join(',\n    ')}\n)${ret}`;
        }
        return symbol.signature;
    }
}

module.exports = DocGenerator;

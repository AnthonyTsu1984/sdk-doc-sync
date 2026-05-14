const fs = require('fs');
const path = require('path');
const BaseScanner = require('./base-scanner');

/**
 * Static option metadata for Rust hand-written commands (zilliz-tui).
 *
 * The Rust commands listed in `src/cli/help.rs::HAND_WRITTEN_OPS` parse their
 * own raw args (no clap-derive); their option lists live inside println! help
 * literals. Rather than parsing those literals, this map encodes the option
 * surface curated from reading each module once. Keys are
 * `${resource}-${operation}` slugs (lowercase).
 *
 * Field shape mirrors the JSON-model param shape so downstream consumers
 * (DiffEngine, DocGenerator) don't branch on origin.
 */
const RUST_HANDWRITTEN_OP_PARAMS = {
    // ── billing ────────────────────────────────────────────────────────
    'billing-usage': [
        { name: '--month',   shorthand: null, type: 'string', required: false, description: 'Billing month in YYYY-MM, "this", or "last".' },
        { name: '--last',    shorthand: null, type: 'string', required: false, description: 'Relative window such as "7d", "3m", or "1y".' },
        { name: '--start',   shorthand: null, type: 'string', required: false, description: 'Window start (YYYY-MM-DD). Pair with --end.' },
        { name: '--end',     shorthand: null, type: 'string', required: false, description: 'Window end (YYYY-MM-DD). Pair with --start.' },
    ],
    'billing-invoices': [
        { name: '--page-size', shorthand: null, type: 'integer', required: false, description: 'Number of invoices per page.' },
        { name: '--page',      shorthand: null, type: 'integer', required: false, description: 'Page number (1-indexed).' },
    ],
    'billing-download-invoice': [
        { name: '--invoice-id',  shorthand: null, type: 'string', required: true,  description: 'Invoice ID to download. Use `zilliz billing invoices` to list available IDs.' },
        { name: '--output-file', shorthand: '-o', type: 'string', required: false, description: 'Save the invoice to this path. `.pdf` is appended if missing. Mutually exclusive with --dir.' },
        { name: '--dir',         shorthand: '-d', type: 'string', required: false, description: 'Save the invoice as `<dir>/<invoiceId>.pdf`. Mutually exclusive with --output-file.' },
    ],

    // ── cluster ────────────────────────────────────────────────────────
    'cluster-create': [
        { name: '--name',       shorthand: null, type: 'string', required: true,  description: 'Cluster name.' },
        { name: '--type',       shorthand: null, type: 'string', required: true,  description: 'Cluster tier.', choices: ['serverless', 'free', 'dedicated'] },
        { name: '--project-id', shorthand: null, type: 'string', required: false, description: 'Target project ID. Defaults to the active project.' },
        { name: '--region',     shorthand: null, type: 'string', required: false, description: 'Cloud region (e.g. `aws-us-west-2`).' },
        { name: '--cu-type',    shorthand: null, type: 'string', required: false, description: 'Compute unit type for Dedicated clusters.', choices: ['Performance-optimized', 'Capacity-optimized'] },
        { name: '--cu-size',    shorthand: null, type: 'integer', required: false, description: 'Compute unit count for Dedicated clusters.' },
        { name: '--plan',       shorthand: null, type: 'string', required: false, description: 'Subscription plan (Standard, Enterprise).' },
    ],
    'cluster-metrics': [
        { name: '--cluster-id',  shorthand: null, type: 'string',  required: false, description: 'Cluster ID. Falls back to the active cluster context.' },
        { name: '--metric',      shorthand: '-m', type: 'array',   required: true,  description: 'Metric name. Repeat for multiple metrics. See `zilliz cluster metrics --help` for the full list.' },
        { name: '--period',      shorthand: null, type: 'string',  required: false, description: 'Time window. Mutually exclusive with --start/--end.', choices: ['10m','1h','6h','24h','3d','7d'], default: '1h' },
        { name: '--start',       shorthand: null, type: 'string',  required: false, description: 'Window start (RFC3339 or epoch). Pair with --end.' },
        { name: '--end',         shorthand: null, type: 'string',  required: false, description: 'Window end (RFC3339 or epoch). Pair with --start.' },
        { name: '--granularity', shorthand: '-g', type: 'string',  required: false, description: 'Sample granularity.', choices: ['1m','5m','1h','1d'] },
    ],

    // ── collection ─────────────────────────────────────────────────────
    'collection-metrics': [
        { name: '--cluster-id',      shorthand: null, type: 'string', required: false, description: 'Cluster ID. Falls back to the active cluster context.' },
        { name: '--collection-name', shorthand: '-c', type: 'string', required: true,  description: 'Collection to fetch metrics for.' },
        { name: '--metric',          shorthand: '-m', type: 'array',  required: true,  description: 'Metric name. Repeat for multiple metrics. See `zilliz collection metrics --help` for the full list.' },
        { name: '--period',          shorthand: null, type: 'string', required: false, description: 'Time window. Mutually exclusive with --start/--end.', choices: ['10m','1h','6h','24h','3d','7d'], default: '1h' },
        { name: '--start',           shorthand: null, type: 'string', required: false, description: 'Window start (RFC3339 or epoch). Pair with --end.' },
        { name: '--end',             shorthand: null, type: 'string', required: false, description: 'Window end (RFC3339 or epoch). Pair with --start.' },
        { name: '--granularity',     shorthand: '-g', type: 'string', required: false, description: 'Sample granularity.', choices: ['1m','5m','1h','1d'] },
    ],

    // ── alert ──────────────────────────────────────────────────────────
    'alert-list': [
        { name: '--project-id', shorthand: null, type: 'string',  required: true,  description: 'Project ID to scope alerts.' },
        { name: '--page-size',  shorthand: null, type: 'integer', required: false, description: 'Number of alerts per page.' },
        { name: '--page',       shorthand: null, type: 'integer', required: false, description: 'Page number (1-indexed).' },
    ],
    'alert-create': [
        { name: '--project-id',     shorthand: null, type: 'string', required: true,  description: 'Project ID to create the alert in.' },
        { name: '--metric-name',    shorthand: null, type: 'string', required: true,  description: 'Metric to monitor.' },
        { name: '--threshold',      shorthand: null, type: 'string', required: true,  description: 'Trigger threshold value.' },
        { name: '--comparison',     shorthand: null, type: 'string', required: true,  description: 'Comparison operator.', choices: ['gt','gte','lt','lte','eq','neq'] },
        { name: '--rule-name',      shorthand: null, type: 'string', required: false, description: 'Friendly name for the alert rule.' },
        { name: '--level',          shorthand: null, type: 'string', required: false, description: 'Severity level.', choices: ['info','warning','critical'] },
        { name: '--window-size',    shorthand: null, type: 'string', required: false, description: 'Evaluation window size (e.g. `5m`, `1h`).' },
        { name: '--cluster-id',     shorthand: null, type: 'string', required: false, description: 'Cluster the rule applies to.' },
        { name: '--action',         shorthand: null, type: 'array',  required: false, description: 'Notification action ID. Repeat for multiple actions.' },
        { name: '--send-resolved',  shorthand: null, type: 'boolean', required: false, description: 'Send a notification when the alert resolves.', default: false },
        { name: '--repeat-interval', shorthand: null, type: 'string', required: false, description: 'How often to re-fire while triggered.' },
        { name: '--enabled',        shorthand: null, type: 'boolean', required: false, description: 'Whether the rule is enabled at creation.', default: true },
    ],
    'alert-update': [
        { name: '--id',              shorthand: null, type: 'string',  required: false, description: 'Alert rule ID. Interactive selection if omitted.' },
        { name: '--project-id',      shorthand: null, type: 'string',  required: false, description: 'Project ID for interactive --id selection.' },
        { name: '--rule-name',       shorthand: null, type: 'string',  required: false, description: 'New rule name.' },
        { name: '--metric-name',     shorthand: null, type: 'string',  required: false, description: 'New metric to monitor.' },
        { name: '--threshold',       shorthand: null, type: 'string',  required: false, description: 'New trigger threshold.' },
        { name: '--comparison',      shorthand: null, type: 'string',  required: false, description: 'New comparison operator.', choices: ['gt','gte','lt','lte','eq','neq'] },
        { name: '--level',           shorthand: null, type: 'string',  required: false, description: 'New severity level.', choices: ['info','warning','critical'] },
        { name: '--window-size',     shorthand: null, type: 'string',  required: false, description: 'New evaluation window size.' },
        { name: '--cluster-id',      shorthand: null, type: 'string',  required: false, description: 'New cluster the rule applies to.' },
        { name: '--action',          shorthand: null, type: 'array',   required: false, description: 'New notification action IDs.' },
        { name: '--send-resolved',   shorthand: null, type: 'boolean', required: false, description: 'Send a notification when the alert resolves.' },
        { name: '--repeat-interval', shorthand: null, type: 'string',  required: false, description: 'New repeat interval.' },
        { name: '--enabled',         shorthand: null, type: 'boolean', required: false, description: 'Whether the rule is enabled.' },
    ],
    'alert-delete': [
        { name: '--id',         shorthand: null, type: 'string', required: false, description: 'Alert rule ID. Interactive selection if omitted.' },
        { name: '--project-id', shorthand: null, type: 'string', required: false, description: 'Project ID for interactive --id selection.' },
    ],
    'alert-enable': [
        { name: '--id',         shorthand: null, type: 'string', required: false, description: 'Alert rule ID. Interactive selection if omitted.' },
        { name: '--project-id', shorthand: null, type: 'string', required: false, description: 'Project ID for interactive --id selection.' },
    ],
    'alert-disable': [
        { name: '--id',         shorthand: null, type: 'string', required: false, description: 'Alert rule ID. Interactive selection if omitted.' },
        { name: '--project-id', shorthand: null, type: 'string', required: false, description: 'Project ID for interactive --id selection.' },
    ],

    // ── milvus standalone ──────────────────────────────────────────────
    // The "milvus standalone" sub-resource registers under a single entry in
    // HAND_WRITTEN_OPS. We expand it to one symbol per action below.
    'milvus-standalone': {
        actions: ['install', 'start', 'stop', 'restart', 'delete', 'upgrade'],
        descriptions: {
            install: 'Download standalone_embed.sh into the install directory.',
            start:   'Start the local Milvus standalone container.',
            stop:    'Stop the local Milvus standalone container.',
            restart: 'Restart the local Milvus standalone container.',
            delete:  'Remove the standalone container, data volumes, and config files (destructive).',
            upgrade: 'Upgrade to the latest standalone_embed.sh from upstream master (destructive). Alias: `update`.',
        },
        commonParams: [
            { name: '--dir',     shorthand: null, type: 'string',  required: false, description: 'Install directory.', default: './milvus-standalone' },
            { name: '--dry-run', shorthand: null, type: 'boolean', required: false, description: 'Print intent without touching filesystem or Docker.', default: false },
            { name: '--yes',     shorthand: '-y', type: 'boolean', required: false, description: 'Skip confirmation prompt for destructive actions.', default: false },
        ],
        installExtras: [
            { name: '--script-url', shorthand: null, type: 'string',  required: false, description: 'Override the standalone_embed.sh download URL (must be https://).', default: 'https://raw.githubusercontent.com/milvus-io/milvus/master/scripts/standalone_embed.sh' },
            { name: '--start',      shorthand: null, type: 'boolean', required: false, description: 'After downloading, run `bash standalone_embed.sh start`.', default: false },
            { name: '--force',      shorthand: null, type: 'boolean', required: false, description: 'Overwrite an existing standalone_embed.sh in the install directory.', default: false },
        ],
    },
};

/**
 * Map Rust types found in clap-derive #[arg] fields to scanner-internal types.
 * Used by _parseClapField() for type detection.
 */
const RUST_TYPE_MAP = {
    'bool':     { type: 'boolean', required: false },
    'String':   { type: 'string',  required: true  },
    'usize':    { type: 'integer', required: true  },
    'isize':    { type: 'integer', required: true  },
    'u8':       { type: 'integer', required: true  },
    'u16':      { type: 'integer', required: true  },
    'u32':      { type: 'integer', required: true  },
    'u64':      { type: 'integer', required: true  },
    'i8':       { type: 'integer', required: true  },
    'i16':      { type: 'integer', required: true  },
    'i32':      { type: 'integer', required: true  },
    'i64':      { type: 'integer', required: true  },
    'f32':      { type: 'float',   required: true  },
    'f64':      { type: 'float',   required: true  },
};

/**
 * Parameter patches for data-plane.json gaps.
 * Applied after Phase 1 parsing to enrich scanner output with missing/fixed params
 * without modifying the upstream CLI repo's JSON.
 *
 * Keys are `resource-operation` slugs (lowercase).
 */
const PARAM_PATCHES = {
    // ── HIGH PRIORITY ──────────────────────────────────────────
    'vector-insert': {
        add: [
            { name: '--partition', shorthand: '-p', apiName: 'partitionName', type: 'string', required: false, description: 'Name of the partition to insert data into.', default: null, choices: null, position: null, requiredUnless: null, requiredWhen: null },
            { name: '--partial-update', shorthand: null, apiName: 'partialUpdate', type: 'boolean', required: false, description: 'Whether to enable partial updates. When enabled, only provided fields are updated.', default: false, choices: null, position: null, requiredUnless: null, requiredWhen: null },
        ],
    },
    'vector-search': {
        add: [
            { name: '--partition', shorthand: '-p', apiName: 'partitionNames', type: 'array', required: false, description: 'List of partition names to search in. Searches all partitions if not specified.', default: null, choices: null, position: null, requiredUnless: null, requiredWhen: null },
            { name: '--offset', shorthand: null, apiName: 'offset', type: 'integer', required: false, description: 'Number of results to skip before returning matches. Used for pagination with `--limit`.', default: null, choices: null, position: null, requiredUnless: null, requiredWhen: null },
            { name: '--search-params', shorthand: null, apiName: 'searchParams', type: 'json', required: false, description: 'JSON string of search parameters (e.g., `{"metricType":"COSINE","params":{"nprobe":10}}`).', default: null, choices: null, position: null, requiredUnless: null, requiredWhen: null },
        ],
    },
    'vector-query': {
        add: [
            { name: '--offset', shorthand: null, apiName: 'offset', type: 'integer', required: false, description: 'Number of results to skip before returning matches. Used for pagination with `--limit`.', default: null, choices: null, position: null, requiredUnless: null, requiredWhen: null },
            { name: '--partition', shorthand: '-p', apiName: 'partitionNames', type: 'array', required: false, description: 'List of partition names to query from. Queries all partitions if not specified.', default: null, choices: null, position: null, requiredUnless: null, requiredWhen: null },
        ],
        fixRequired: { filter: false },
    },
    'vector-upsert': {
        add: [
            { name: '--partial-update', shorthand: null, apiName: 'partialUpdate', type: 'boolean', required: false, description: 'Whether to enable partial updates. When enabled, only provided fields are updated.', default: false, choices: null, position: null, requiredUnless: null, requiredWhen: null },
        ],
    },

    // ── MEDIUM PRIORITY ────────────────────────────────────────
    'vector-hybrid-search': {
        add: [
            { name: '--partition', shorthand: '-p', apiName: 'partitionNames', type: 'array', required: false, description: 'List of partition names to search in.', default: null, choices: null, position: null, requiredUnless: null, requiredWhen: null },
            { name: '--offset', shorthand: null, apiName: 'offset', type: 'integer', required: false, description: 'Number of results to skip before returning matches.', default: null, choices: null, position: null, requiredUnless: null, requiredWhen: null },
        ],
        fixRequired: { rerank: false },
    },
    'collection-create': {
        add: [
            { name: '--description', shorthand: null, apiName: 'description', type: 'string', required: false, description: 'Description of the collection.', default: null, choices: null, position: null, requiredUnless: null, requiredWhen: null },
        ],
        fixChoices: { 'metric-type': ['COSINE', 'L2', 'IP', 'JACCARD', 'HAMMING'] },
    },
    'collection-get-load-state': {
        add: [
            { name: '--partition-names', shorthand: null, apiName: 'partitionNames', type: 'array', required: false, description: 'Partition names to check load state for.', default: null, choices: null, position: null, requiredUnless: null, requiredWhen: null },
        ],
    },
    'collection-compact': {
        add: [
            { name: '--clustering', shorthand: null, apiName: 'isClustering', type: 'boolean', required: false, description: 'Whether to perform clustering compaction.', default: false, choices: null, position: null, requiredUnless: null, requiredWhen: null },
        ],
    },
    'alias-list': {
        fixRequired: { 'db-name': false },
    },
    'role-create': {
        add: [
            { name: '--database', shorthand: null, apiName: 'dbName', type: 'string', required: false, description: 'Database name. Defaults to `default`.', default: null, choices: null, position: null, requiredUnless: null, requiredWhen: null },
        ],
    },
    'role-list': {
        add: [
            { name: '--database', shorthand: null, apiName: 'dbName', type: 'string', required: false, description: 'Database name. Defaults to `default`.', default: null, choices: null, position: null, requiredUnless: null, requiredWhen: null },
        ],
    },
    'role-describe': {
        add: [
            { name: '--database', shorthand: null, apiName: 'dbName', type: 'string', required: false, description: 'Database name. Defaults to `default`.', default: null, choices: null, position: null, requiredUnless: null, requiredWhen: null },
        ],
    },
    'role-drop': {
        add: [
            { name: '--database', shorthand: null, apiName: 'dbName', type: 'string', required: false, description: 'Database name. Defaults to `default`.', default: null, choices: null, position: null, requiredUnless: null, requiredWhen: null },
        ],
    },
};

/**
 * ZillizCliScanner — extracts CLI command symbols from Zilliz CLI source.
 *
 * Auto-detects two source layouts at scan time:
 *
 *   • zilliz-cli (Python/Click, v0.1.x, legacy):
 *       1. Parse JSON model files (`src/zilliz_cli/builtin_models/`)
 *       2. Parse hand-written Click commands in `src/zilliz_cli/commands/*.py`
 *       3. Merge — hand-written wins on slug collision
 *       4. Enrich — patch known parameter gaps from PARAM_PATCHES
 *
 *   • zilliz-tui (Rust/clap, v1.3.x, current):
 *       1. Parse JSON model files (`src/model/builtin_models/`)
 *       2. Parse clap-derive enums in `src/cli/args.rs` (Commands + nested *Commands)
 *       3. Parse hand-written ops registry in `src/cli/help.rs::HAND_WRITTEN_OPS`
 *       4. Enrich hand-written ops via RUST_HANDWRITTEN_OP_PARAMS static map
 *       5. Merge + enrich (same as Python flow)
 *
 * Mode is selected by `_detectMode()` based on filesystem probes (Cargo.toml
 * for Rust, `src/zilliz_cli/` or setup.py for Python).
 */
class ZillizCliScanner extends BaseScanner {
    constructor(opts) {
        super(opts);
        // Python (legacy) layout
        this._modelsDir   = path.join(this.rootDir, 'src/zilliz_cli/builtin_models');
        this._commandsDir = path.join(this.rootDir, 'src/zilliz_cli/commands');
        // Rust (current) layout
        this._rustModelsDir = path.join(this.rootDir, 'src/model/builtin_models');
        this._rustArgsFile  = path.join(this.rootDir, 'src/cli/args.rs');
        this._rustHelpFile  = path.join(this.rootDir, 'src/cli/help.rs');
        this._mode = null;  // set in scan()
    }

    // Category map: resource name → category
    static CATEGORY_MAP = {
        // Control plane — Cloud Management
        cluster: 'Cloud Management',
        project: 'Cloud Management',
        backup: 'Cloud Management',
        import: 'Cloud Management',
        volume: 'Cloud Management',
        billing: 'Cloud Management',
        job: 'Cloud Management',
        milvus: 'Cloud Management',          // v1.x: milvus standalone
        // Data plane — Data Operations
        collection: 'Data Operations',
        vector: 'Data Operations',
        database: 'Data Operations',
        index: 'Data Operations',
        partition: 'Data Operations',
        user: 'Data Operations',
        role: 'Data Operations',
        alias: 'Data Operations',
        // Hand-written / global — Configuration
        auth: 'Configuration',
        alert: 'Configuration',
        configure: 'Configuration',
        context: 'Configuration',
        completion: 'Configuration',
        history: 'Configuration',            // v1.x
        quickstart: 'Configuration',         // v1.x
        whoami: 'Configuration',             // v1.x (top-level)
        switch: 'Configuration',             // v1.x (top-level)
        login: 'Configuration',              // v1.x (top-level)
        logout: 'Configuration',             // v1.x (top-level)
        version: 'Configuration',
    };

    _detectMode() {
        if (fs.existsSync(path.join(this.rootDir, 'Cargo.toml'))) return 'rust';
        if (fs.existsSync(this._commandsDir)) return 'python';
        if (fs.existsSync(path.join(this.rootDir, 'setup.py'))) return 'python';
        return 'python';   // fall back so existing callers keep working
    }

    async scan() {
        this._mode = this._detectMode();
        return this._mode === 'rust' ? this._scanRust() : this._scanPython();
    }

    async _scanPython() {
        const jsonSymbols = this._parseJsonModels();
        this._addFrameworkOptions(jsonSymbols);
        const handwrittenSymbols = this._parseHandwrittenCommands();
        const merged = this._merge(jsonSymbols, handwrittenSymbols);
        this._enrichParams(merged);
        return merged;
    }

    async _scanRust() {
        const jsonSymbols = this._parseRustJsonModels();
        this._addFrameworkOptions(jsonSymbols);
        const clapSymbols = this._parseClapDerive();
        const handwrittenSymbols = this._parseRustHandwrittenOps();
        const merged = this._merge(jsonSymbols, [...clapSymbols, ...handwrittenSymbols]);
        this._enrichParams(merged);
        return merged;
    }

    // ── Phase 1: JSON model parsing ────────────────────────────────────

    _parseJsonModels(modelsDir = this._modelsDir) {
        const symbols = [];
        for (const file of ['control-plane.json', 'data-plane.json']) {
            const filePath = path.join(modelsDir, file);
            const plane = file === 'control-plane.json' ? 'control' : 'data';
            let model;
            try {
                model = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            } catch {
                continue;
            }

            const resources = model.resources || {};
            for (const [resourceName, resource] of Object.entries(resources)) {
                const parentClass = this._capitalize(resourceName);
                const resourceDedicatedOnly = resource.dedicatedOnly || false;
                const operations = resource.operations || {};

                for (const [opName, op] of Object.entries(operations)) {
                    const params = (op.params || []).map(p => ({
                        name: p.cli || `--${this._kebabCase(p.name)}`,
                        shorthand: p.short || null,
                        apiName: p.name,
                        type: p.type || 'string',
                        required: p.required || false,
                        description: p.description || '',
                        default: p.default !== undefined ? p.default : null,
                        choices: p.choices || null,
                        position: p.position || null,
                        requiredUnless: p.requiredUnless || null,
                        requiredWhen: p.requiredWhen || null,
                    }));

                    const signature = `zilliz ${resourceName} ${opName}${params.length ? ' [OPTIONS]' : ''}`;

                    symbols.push({
                        name: opName,
                        parentClass,
                        kind: 'command',
                        docstring: op.description || '',
                        signature,
                        params,
                        returnType: null,
                        filePath: filePath,
                        lineNumber: 0,
                        category: ZillizCliScanner.CATEGORY_MAP[resourceName] || 'Data Operations',
                        // CLI-specific metadata
                        httpMethod: op.http ? op.http.method : null,
                        httpPath: op.http ? op.http.path : null,
                        plane,
                        pagination: op.pagination || null,
                        bodyParam: op.bodyParam || null,
                        examples: op.examples || [],
                        dedicatedOnly: op.dedicatedOnly || resourceDedicatedOnly,
                    });
                }
            }
        }
        return symbols;
    }

    // ── Phase 2: Hand-written Click commands ───────────────────────────

    _parseHandwrittenCommands() {
        const symbols = [];
        let files;
        try {
            files = fs.readdirSync(this._commandsDir).filter(f => f.endsWith('.py') && f !== '__init__.py');
        } catch {
            return symbols;
        }

        for (const file of files) {
            const filePath = path.join(this._commandsDir, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            const moduleName = file.replace('.py', '');

            this._extractClickCommands(content, moduleName, filePath, symbols);
        }
        return symbols;
    }

    _extractClickCommands(content, moduleName, filePath, symbols) {
        const lines = content.split('\n');
        let currentGroupName = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Detect @click.group
            const groupMatch = line.match(/@click\.group\(/);
            if (groupMatch) {
                for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                    const defMatch = lines[j].match(/^def\s+(\w+)\s*\(/);
                    if (defMatch) {
                        currentGroupName = defMatch[1];
                        break;
                    }
                }
                continue;
            }

            // Detect command decorators — both @group.command("name") and @click.command(name="name")
            // Also handle multi-line @click.command(\n   ...\n)
            const fullCmd = this._collectDecorator(lines, i);
            const cmdMatch = fullCmd.match(/@(\w+)\.command\(\s*["'](\w[\w-]*)["']/);
            const topCmdMatch = !cmdMatch ? fullCmd.match(/@click\.command\(\s*(?:.*?name\s*=\s*["'](\w[\w-]*)["'])?/) : null;

            if (!(cmdMatch || topCmdMatch)) continue;

            // Found a command — now scan FORWARD from command decorator to collect
            // all @click.option / @click.argument decorators until we hit `def `
            let funcName = null;
            let docstring = '';
            let defLineNum = 0;
            const options = [];
            const args = [];

            for (let j = i + 1; j < Math.min(i + 40, lines.length); j++) {
                const fwdLine = lines[j];

                // Reached the function definition — stop collecting
                const defMatch = fwdLine.match(/^def\s+(\w+)\s*\(/);
                if (defMatch) {
                    funcName = defMatch[1];
                    defLineNum = j + 1;
                    // Extract docstring — scan past multi-line function signature
                    // (params can span 20+ lines in Click commands)
                    for (let k = j + 1; k < Math.min(j + 30, lines.length); k++) {
                        const dsMatch = lines[k].match(/^\s+"""(.+?)"""/);
                        const dsStart = lines[k].match(/^\s+"""(.+)/);
                        if (dsMatch) { docstring = dsMatch[1].trim(); break; }
                        else if (dsStart) { docstring = dsStart[1].trim(); break; }
                        // Stop if we hit actual code (not just closing parens or blank lines)
                        if (lines[k].match(/^\s+\w/) && !lines[k].match(/^\s+("""|#|\)|,|\w+[,)])/)) break;
                    }
                    break;
                }

                // Collect @click.option
                if (fwdLine.match(/@click\.option\(/)) {
                    const option = this._parseClickOption(lines, j);
                    if (option) options.push(option);
                }

                // Collect @click.argument
                if (fwdLine.match(/@click\.argument\(/)) {
                    const arg = this._parseClickArgument(lines, j);
                    if (arg) args.push(arg);
                }
            }

            if (!funcName) continue;

            const opName = cmdMatch ? cmdMatch[2] : (topCmdMatch?.[1] || funcName);
            const groupName = cmdMatch ? cmdMatch[1] : null;
            const parentClass = this._resolveParentClass(groupName, moduleName);

            // Convert options to params (arguments first, then options)
            const params = [];
            for (const a of args) {
                params.push({
                    name: a.name.toUpperCase(),
                    shorthand: null,
                    apiName: a.name,
                    type: a.type || 'string',
                    required: a.required,
                    description: a.help || '',
                    default: null,
                    choices: a.choices || null,
                    position: 'argument',
                    requiredUnless: null,
                    requiredWhen: null,
                });
            }
            for (const o of options) {
                params.push({
                    name: o.long,
                    shorthand: o.short || null,
                    apiName: o.long.replace(/^--/, ''),
                    type: o.type || 'string',
                    required: o.required || false,
                    description: o.help || '',
                    default: o.default !== undefined ? o.default : null,
                    choices: o.choices || null,
                    position: null,
                    requiredUnless: null,
                    requiredWhen: null,
                });
            }

            const hasArgs = args.length > 0;
            const hasOpts = options.length > 0;
            let suffix = '';
            if (hasArgs && hasOpts) suffix = ` ${args.map(a => `<${a.name}>`).join(' ')} [OPTIONS]`;
            else if (hasArgs) suffix = ` ${args.map(a => `<${a.name}>`).join(' ')}`;
            else if (hasOpts) suffix = ' [OPTIONS]';
            const signature = `zilliz ${parentClass.toLowerCase()} ${opName}${suffix}`;

            symbols.push({
                name: opName,
                parentClass,
                kind: 'command',
                docstring,
                signature,
                params,
                returnType: null,
                filePath,
                lineNumber: defLineNum,
                category: ZillizCliScanner.CATEGORY_MAP[parentClass.toLowerCase()] || 'Configuration',
                httpMethod: null,
                httpPath: null,
                plane: null,
                pagination: null,
                bodyParam: null,
                examples: [],
                dedicatedOnly: false,
                handwritten: true,
            });
        }
    }

    /**
     * Collect a potentially multi-line decorator starting at line idx.
     * Returns the full decorator text joined into one string.
     */
    _collectDecorator(lines, idx) {
        let full = lines[idx];
        let parenDepth = 0;
        for (const ch of full) {
            if (ch === '(') parenDepth++;
            if (ch === ')') parenDepth--;
        }
        let j = idx;
        while (parenDepth > 0 && j + 1 < lines.length) {
            j++;
            full += ' ' + lines[j].trim();
            for (const ch of lines[j]) {
                if (ch === '(') parenDepth++;
                if (ch === ')') parenDepth--;
            }
        }
        return full;
    }

    _parseClickOption(lines, idx) {
        const full = this._collectDecorator(lines, idx);

        // Extract param_decls: @click.option('--long', '-s', ...) or @click.option('--long/--no-long', ...)
        // Also handle @click.option('--long', 'param_name', ...) where param_name is not a shorthand
        const declsMatch = full.match(/@click\.option\(\s*['"](--[\w-]+(?:\/--[\w-]+)?)['"]\s*(?:,\s*['"](-\w)['"])?\s*/);
        if (!declsMatch) return null;

        let long = declsMatch[1];
        const short = declsMatch[2] || null;

        // Handle --flag/--no-flag boolean syntax
        if (long.includes('/')) {
            long = long.split('/')[0];
        }

        // Extract help text — handle apostrophes by matching quote type
        const helpMatch = full.match(/help\s*=\s*"([^"]+)"/) || full.match(/help\s*=\s*'([^']+)'/);
        const requiredMatch = full.match(/required\s*=\s*True/);
        const isFlagMatch = full.match(/is_flag\s*=\s*True/) || long.includes('/');
        const multipleMatch = full.match(/multiple\s*=\s*True/);

        // Type detection with choices extraction
        let type = 'string';
        let choices = null;

        if (isFlagMatch) {
            type = 'boolean';
        } else {
            const choiceMatch = full.match(/type\s*=\s*click\.Choice\(\s*\[([^\]]+)\]/);
            if (choiceMatch) {
                choices = choiceMatch[1].match(/["']([^"']+)["']/g)?.map(s => s.replace(/["']/g, '')) || [];
                type = 'string';
            } else if (/type\s*=\s*int\b/.test(full)) {
                type = 'integer';
            } else if (/type\s*=\s*float\b/.test(full)) {
                type = 'float';
            }
        }

        if (multipleMatch && !isFlagMatch) {
            type = 'array';
        }

        // Extract default value
        let dflt = null;
        const defaultMatch = full.match(/default\s*=\s*(True|False|None|\d+|["'][^"']*["'])/);
        if (defaultMatch) {
            const val = defaultMatch[1];
            if (val === 'None') dflt = null;
            else if (val === 'True') dflt = true;
            else if (val === 'False') dflt = false;
            else if (/^\d+$/.test(val)) dflt = parseInt(val);
            else dflt = val.replace(/["']/g, '');
        }

        return {
            long,
            short,
            help: helpMatch ? helpMatch[1] : '',
            type,
            required: !!requiredMatch,
            choices,
            default: dflt,
        };
    }

    _parseClickArgument(lines, idx) {
        const full = this._collectDecorator(lines, idx);

        const nameMatch = full.match(/@click\.argument\(\s*["'](\w+)["']/);
        if (!nameMatch) return null;

        const name = nameMatch[1];
        const requiredMatch = full.match(/required\s*=\s*(True|False)/);
        const required = requiredMatch ? requiredMatch[1] === 'True' : true; // arguments default to required

        // Extract choices from type=click.Choice([...])
        let choices = null;
        let type = 'string';
        const choiceMatch = full.match(/type\s*=\s*click\.Choice\(\s*\[([^\]]+)\]/);
        if (choiceMatch) {
            choices = choiceMatch[1].match(/["']([^"']+)["']/g)?.map(s => s.replace(/["']/g, '')) || [];
        }

        return { name, type, required, choices, help: '' };
    }

    _resolveParentClass(groupName, moduleName) {
        // If we know the group variable name, use it; otherwise infer from module
        if (groupName) return this._capitalize(groupName);
        const map = {
            auth: 'Auth',
            configure: 'Configure',
            context: 'Context',
            cluster: 'Cluster',
            billing: 'Billing',
            completion: 'Completion',
            version: 'Global',
            alert: 'Alert',
            job: 'Job',
            metrics: 'Cluster',
        };
        return map[moduleName] || this._capitalize(moduleName);
    }

    // ── Phase 2b: Rust clap-derive commands ────────────────────────────

    _parseRustJsonModels() {
        return this._parseJsonModels(this._rustModelsDir);
    }

    _parseClapDerive() {
        const content = fs.readFileSync(this._rustArgsFile, 'utf-8');
        const enums = this._extractRustEnums(content);
        const enumMap = new Map();
        for (const e of enums) enumMap.set(e.name, e);

        const symbols = [];
        const topEnum = enumMap.get('Commands');
        if (!topEnum) return symbols;

        for (const variant of topEnum.variants) {
            this._processClapVariant(variant, null, enumMap, symbols, this._rustArgsFile);
        }
        return symbols;
    }

    _extractRustEnums(content) {
        const lines = content.split('\n');
        const enums = [];

        for (let i = 0; i < lines.length; i++) {
            if (!lines[i].trim().startsWith('#[derive(Subcommand)]')) continue;

            let enumLine = -1;
            let enumName = null;
            for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
                const m = lines[j].match(/pub\s+enum\s+(\w+)\s*\{/);
                if (m) { enumLine = j; enumName = m[1]; break; }
            }
            if (enumLine === -1) continue;

            // Collect body lines between { and matching }
            const bodyLines = [];
            let braceDepth = 1;
            let k = enumLine + 1;
            while (k < lines.length && braceDepth > 0) {
                for (const ch of lines[k]) {
                    if (ch === '{') braceDepth++;
                    if (ch === '}') braceDepth--;
                }
                if (braceDepth === 0) break;
                bodyLines.push(lines[k]);
                k++;
            }

            const variants = this._parseEnumBodyLines(bodyLines);
            enums.push({ name: enumName, variants, lineNumber: enumLine + 1 });
            i = k;
        }
        return enums;
    }

    _parseEnumBodyLines(bodyLines) {
        const variants = [];
        let currentDocs = [];
        let currentAttrs = [];
        let currentVariant = null;

        for (let i = 0; i < bodyLines.length; i++) {
            const line = bodyLines[i];
            const trimmed = line.trim();

            if (trimmed === '' || trimmed.startsWith('//')) continue;

            if (trimmed.startsWith('///')) {
                currentDocs.push(trimmed.replace(/^\/\/\/\s*/, ''));
                continue;
            }

            if (trimmed.startsWith('#[')) {
                currentAttrs.push(trimmed);
                continue;
            }

            // Variant declaration: Name, Name {, or Name(
            const vmatch = trimmed.match(/^([A-Z]\w*)(?:\s*[\{\(])?\s*,?$/);
            if (vmatch) {
                if (currentVariant) variants.push(currentVariant);

                currentVariant = {
                    name: vmatch[1],
                    docstring: currentDocs.join(' '),
                    attrs: [...currentAttrs],
                    fields: [],
                };
                currentDocs = [];
                currentAttrs = [];

                if (trimmed.includes('{')) {
                    i++;
                    let innerBrace = 1;
                    let fieldDocs = [];
                    let fieldAttrs = [];
                    while (i < bodyLines.length && innerBrace > 0) {
                        const fl = bodyLines[i];
                        const ft = fl.trim();
                        for (const ch of fl) {
                            if (ch === '{') innerBrace++;
                            if (ch === '}') innerBrace--;
                        }
                        if (innerBrace === 0) break;

                        if (ft.startsWith('///')) {
                            fieldDocs.push(ft.replace(/^\/\/\/\s*/, ''));
                        } else if (ft.startsWith('#[')) {
                            fieldAttrs.push(ft);
                        } else if (ft && !ft.startsWith('//')) {
                            const field = this._parseRustField(fl, fieldDocs, fieldAttrs);
                            if (field) {
                                currentVariant.fields.push(field);
                            }
                            fieldDocs = [];
                            fieldAttrs = [];
                        }
                        i++;
                    }
                } else if (trimmed.includes('(')) {
                    // Tuple variant — skip
                    i++;
                    let parenDepth = 1;
                    while (i < bodyLines.length && parenDepth > 0) {
                        for (const ch of bodyLines[i]) {
                            if (ch === '(') parenDepth++;
                            if (ch === ')') parenDepth--;
                        }
                        i++;
                    }
                }
            }
        }
        if (currentVariant) variants.push(currentVariant);
        return variants;
    }

    _parseRustField(line, docs, attrs) {
        const match = line.trim().match(/^(\w+)\s*:\s*([^,]+),?/);
        if (!match) return null;

        const name = match[1];
        const typeRaw = match[2].trim();

        // Parse arg attributes
        let hasLong = false;
        let short = null;
        let isValueEnum = false;
        let defaultValue = null;

        for (const attr of attrs) {
            if (!attr.includes('arg(')) continue;
            const attrBody = attr.match(/#\[arg\((.*)\)\]/)?.[1] || '';

            if (attrBody.includes('long')) hasLong = true;

            const shortMatch = attrBody.match(/short\s*=\s*['"](\w)['"]/);
            if (shortMatch) short = `-${shortMatch[1]}`;
            else if (attrBody.includes('short')) short = `-${name.charAt(0)}`;

            if (attrBody.includes('value_enum')) isValueEnum = true;

            const dmatch = attrBody.match(/default_value\s*=\s*["']([^"']+)["']/);
            if (dmatch) defaultValue = dmatch[1];
        }

        // Type analysis
        let type = 'string';
        let choices = null;
        let required = true;
        const isOption = typeRaw.startsWith('Option<');
        const innerType = isOption ? typeRaw.slice(7, -1) : typeRaw;

        if (isValueEnum && innerType.includes('clap_complete::Shell')) {
            type = 'string';
            choices = ['bash', 'zsh', 'fish', 'powershell', 'elvish'];
            required = !isOption;
        } else if (innerType === 'bool') {
            type = 'boolean';
            required = false;
            if (defaultValue === null) defaultValue = false;
        } else if (innerType === 'String') {
            type = 'string';
            required = !isOption;
        } else if (/^(usize|isize|u\d+|i\d+)$/.test(innerType)) {
            type = 'integer';
            required = !isOption;
        } else if (/^(f32|f64)$/.test(innerType)) {
            type = 'float';
            required = !isOption;
        } else if (innerType.startsWith('Vec<')) {
            type = 'array';
            required = false;
        } else {
            // Fallback — check RUST_TYPE_MAP
            const tm = RUST_TYPE_MAP[innerType];
            if (tm) {
                type = tm.type;
                required = isOption ? false : tm.required;
            } else {
                required = !isOption;
            }
        }

        // Positional arg when no `#[arg(long)]`
        if (!hasLong) {
            return {
                name: name.toUpperCase(),
                shorthand: null,
                apiName: name,
                type,
                required,
                description: docs.join(' '),
                default: defaultValue,
                choices,
                position: 'argument',
                requiredUnless: null,
                requiredWhen: null,
            };
        }

        return {
            name: `--${this._kebabCase(name)}`,
            shorthand: short,
            apiName: name,
            type,
            required,
            description: docs.join(' '),
            default: defaultValue,
            choices,
            position: null,
            requiredUnless: null,
            requiredWhen: null,
        };
    }

    _processClapVariant(variant, parentName, enumMap, symbols, filePath) {
        // Container variants follow the naming convention: History -> HistoryCommands
        const nestedName = `${variant.name}Commands`;
        const nestedEnum = enumMap.get(nestedName);

        if (nestedEnum) {
            for (const nv of nestedEnum.variants) {
                this._processClapVariant(nv, variant.name, enumMap, symbols, filePath);
            }
            return;
        }

        if (variant.name === 'External') return;

        const parentClass = parentName || this._capitalize(variant.name);
        const opName = variant.name.toLowerCase();
        const params = variant.fields
            .filter(f => !f.typeRaw || !f.typeRaw.includes('Commands'))
            .map(f => ({
                name: f.name,
                shorthand: f.shorthand,
                apiName: f.apiName,
                type: f.type,
                required: f.required,
                description: f.description,
                default: f.default,
                choices: f.choices,
                position: f.position,
                requiredUnless: null,
                requiredWhen: null,
            }));

        const hasOpts = params.length > 0;
        const signature = parentName
            ? `zilliz ${parentName.toLowerCase()} ${opName}${hasOpts ? ' [OPTIONS]' : ''}`
            : `zilliz ${opName}${hasOpts ? ' [OPTIONS]' : ''}`;

        symbols.push({
            name: opName,
            parentClass,
            kind: 'command',
            docstring: variant.docstring || '',
            signature,
            params,
            returnType: null,
            filePath,
            lineNumber: 0,
            category: ZillizCliScanner.CATEGORY_MAP[parentClass.toLowerCase()] || 'Configuration',
            httpMethod: null,
            httpPath: null,
            plane: null,
            pagination: null,
            bodyParam: null,
            examples: [],
            dedicatedOnly: false,
        });
    }

    // ── Phase 2c: Rust hand-written ops ────────────────────────────────

    _parseRustHandwrittenOps() {
        const content = fs.readFileSync(this._rustHelpFile, 'utf-8');
        const symbols = [];

        const match = content.match(/const\s+HAND_WRITTEN_OPS:\s*&\[\(&str,\s*&str,\s*&str\)\]\s*=\s*&\[([\s\S]*?)\];/);
        if (!match) return symbols;

        let body = match[1];
        // Normalize multi-line tuples (milvus standalone spans 4 lines)
        body = body.replace(/\(\s*\n\s*"/g, '("').replace(/",\s*\n\s*"/g, '","').replace(/",\s*\n\s*\)/g, '")');
        const lineRegex = /\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\)/g;
        let lm;
        while ((lm = lineRegex.exec(body)) !== null) {
            const resource = lm[1];
            const op = lm[2];
            const desc = lm[3];

            if (resource === 'milvus' && op === 'standalone') {
                const config = RUST_HANDWRITTEN_OP_PARAMS['milvus-standalone'];
                if (config) {
                    for (const action of config.actions) {
                        const actionDesc = config.descriptions[action] || desc;
                        const params = [...config.commonParams];
                        if (action === 'install') params.push(...config.installExtras);
                        symbols.push(this._buildHandwrittenSymbol(resource, action, actionDesc, params));
                    }
                }
            } else {
                const key = `${resource}-${op}`;
                const config = RUST_HANDWRITTEN_OP_PARAMS[key];
                const params = config ? (config.params || []) : [];
                symbols.push(this._buildHandwrittenSymbol(resource, op, desc, params));
            }
        }
        return symbols;
    }

    _buildHandwrittenSymbol(resource, op, desc, params) {
        const parentClass = this._capitalize(resource);
        const hasOpts = params.length > 0;
        const signature = `zilliz ${resource} ${op}${hasOpts ? ' [OPTIONS]' : ''}`;
        return {
            name: op,
            parentClass,
            kind: 'command',
            docstring: desc,
            signature,
            params: params.map(p => ({ ...p })),
            returnType: null,
            filePath: this._rustHelpFile,
            lineNumber: 0,
            category: ZillizCliScanner.CATEGORY_MAP[resource] || 'Cloud Management',
            httpMethod: null,
            httpPath: null,
            plane: null,
            pagination: null,
            bodyParam: null,
            examples: [],
            dedicatedOnly: false,
            handwritten: true,
        };
    }

    // ── Framework options (added by CommandFactory to JSON-model commands) ──

    _addFrameworkOptions(symbols) {
        const DANGEROUS_OPS = new Set(['delete', 'drop']);

        for (const sym of symbols) {
            // --output, -o — always present
            sym.params.push({
                name: '--output', shorthand: '-o', apiName: 'output',
                type: 'string', required: false,
                description: 'Output format.',
                default: null, choices: ['json', 'table', 'text', 'yaml', 'csv'],
                position: null, requiredUnless: null, requiredWhen: null,
            });

            // --no-header — always present
            sym.params.push({
                name: '--no-header', shorthand: null, apiName: 'noHeader',
                type: 'boolean', required: false,
                description: 'Omit header row (table/csv output).',
                default: false, choices: null,
                position: null, requiredUnless: null, requiredWhen: null,
            });

            // --query, -q — always present
            sym.params.push({
                name: '--query', shorthand: '-q', apiName: 'query',
                type: 'string', required: false,
                description: 'JMESPath expression to filter output.',
                default: null, choices: null,
                position: null, requiredUnless: null, requiredWhen: null,
            });

            // --all, -a — paginated operations only
            if (sym.pagination) {
                sym.params.push({
                    name: '--all', shorthand: '-a', apiName: 'fetchAll',
                    type: 'boolean', required: false,
                    description: 'Fetch all pages.',
                    default: false, choices: null,
                    position: null, requiredUnless: null, requiredWhen: null,
                });
            }

            // --body — operations with bodyParam
            if (sym.bodyParam) {
                sym.params.push({
                    name: sym.bodyParam, shorthand: null, apiName: 'body',
                    type: 'json', required: false,
                    description: 'Raw JSON body (or file://path).',
                    default: null, choices: null,
                    position: null, requiredUnless: null, requiredWhen: null,
                });
            }

            // --yes, -y — dangerous operations (delete/drop)
            if (DANGEROUS_OPS.has(sym.name)) {
                sym.params.push({
                    name: '--yes', shorthand: '-y', apiName: 'yes',
                    type: 'boolean', required: false,
                    description: 'Skip confirmation prompt.',
                    default: false, choices: null,
                    position: null, requiredUnless: null, requiredWhen: null,
                });
            }
        }
    }

    // ── Phase 3: Merge ────────────────────────────────────────────────

    _merge(jsonSymbols, handwrittenSymbols) {
        const merged = new Map();

        // Add JSON symbols first
        for (const s of jsonSymbols) {
            const slug = `${s.parentClass}-${s.name}`;
            merged.set(slug, s);
        }

        // Hand-written wins on collision
        for (const s of handwrittenSymbols) {
            const slug = `${s.parentClass}-${s.name}`;
            merged.set(slug, s);
        }

        return Array.from(merged.values());
    }

    // ── Phase 4: Enrich params ─────────────────────────────────────────

    _enrichParams(symbols) {
        for (const sym of symbols) {
            const key = `${sym.parentClass.toLowerCase()}-${sym.name}`;
            const patch = PARAM_PATCHES[key];
            if (!patch) continue;

            // Add missing params
            if (patch.add) {
                for (const p of patch.add) {
                    // Skip if param already exists (by apiName)
                    if (!sym.params.some(ep => ep.apiName === p.apiName)) {
                        sym.params.push({ ...p });
                    }
                }
            }

            // Fix required flags
            if (patch.fixRequired) {
                for (const [apiName, required] of Object.entries(patch.fixRequired)) {
                    const param = sym.params.find(p => p.apiName === apiName || p.name === `--${apiName}`);
                    if (param) param.required = required;
                }
            }

            // Fix choices
            if (patch.fixChoices) {
                for (const [apiName, choices] of Object.entries(patch.fixChoices)) {
                    const param = sym.params.find(p => p.apiName === apiName || p.name === `--${apiName}`);
                    if (param) param.choices = choices;
                }
            }
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────

    _capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    _kebabCase(str) {
        return str.replace(/_/g, '-').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    }

    _defaultExcludes() {
        return ['__pycache__', '*.pyc', 'node_modules', '.git', 'target', '*.rlib'];
    }
}

module.exports = ZillizCliScanner;

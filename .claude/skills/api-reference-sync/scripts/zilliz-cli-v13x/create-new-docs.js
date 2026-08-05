#!/usr/bin/env node
/**
 * Create v1.x-only docs in the v1.3.x bitable + drive folder.
 *
 * Adds:
 *   - 3 VirtualNode records for new subfolders: History, Quickstart, Milvus Standalone
 *   - 15 Function records + Feishu docs:
 *       Configuration / Auth:           whoami, switch
 *       Configuration / Quickstart:     quickstart
 *       Configuration / History:        list, search, clear
 *       Configuration / Context:        clear
 *       Cloud Management / Milvus Standalone: install, start, stop, restart, delete, upgrade
 *       Cloud Management / Billing:     download-invoice
 *       Data Operations / Collection:   metrics
 *
 * Idempotent:
 *   - Skips VirtualNode records that already exist (matched by Title + folder link).
 *   - Skips docs whose title already exists in the target drive folder; creates
 *     bitable record only if missing.
 *
 * Run with --dry-run to preview without writing.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '..', '..', '.env') });

const fs    = require('fs');
const fetch = require('node-fetch');

const BitableWriter     = require('../../src/sdk-doc-sync/bitable-writer');
const MarkdownToFeishu  = require('../../src/markdown-to-feishu');
const larkTokenFetcher  = require('../../lib/lark-docs/larkTokenFetcher');

const HOST          = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const BITABLE       = 'Rr4lbWr8baQj5psICV9cEFa2nYe';
const TABLE         = 'tblpQmRZvCES9KCF';
const FOLDERS_FILE  = '/tmp/v13x-folders.json';
const FEISHU_DOC    = 'https://zilliverse.feishu.cn/docx';
const FEISHU_FOLDER = 'https://zilliverse.feishu.cn/drive/folder';
const DRY_RUN       = process.argv.includes('--dry-run');

const tf = new larkTokenFetcher();

// ─── Folder + parent record map ────────────────────────────────────────────────

const folders = JSON.parse(fs.readFileSync(FOLDERS_FILE, 'utf8'));

const FOLDER_TOKEN = {
    Auth:                folders.categories.Configuration.subfolders.Auth.token,
    Context:             folders.categories.Configuration.subfolders.Context.token,
    History:             folders.categories.Configuration.subfolders.History.token,
    Quickstart:          folders.categories.Configuration.subfolders.Quickstart.token,
    Billing:             folders.categories['Cloud Management'].subfolders.Billing.token,
    'Milvus Standalone': folders.categories['Cloud Management'].subfolders['Milvus Standalone'].token,
    Collection:          folders.categories['Data Operations'].subfolders.Collection.token,
};

// Existing parent VirtualNode record IDs (for Function records to link parent)
const PARENT_RECORD = {
    Auth:        'recveEKFhSPQuz',
    Context:     'recveEKHeLaXht',
    Billing:     'recveEKuge14Bi',
    Collection:  'recveEKwhIh8Xi',
    // New VirtualNodes (filled in at runtime after creation)
    History:             null,
    Quickstart:          null,
    'Milvus Standalone': null,
};

// Category VirtualNode parents (for the 3 new sub VirtualNodes)
const CATEGORY_PARENT = {
    Configuration:     'recveEKEe2bhtB',
    'Cloud Management': 'recveEKo6iF81X',
};

// ─── New VirtualNode records (subfolders) ─────────────────────────────────────

const NEW_VIRTUAL_NODES = [
    { title: 'History',           parent: 'Configuration',     folderName: 'History' },
    { title: 'Quickstart',        parent: 'Configuration',     folderName: 'Quickstart' },
    { title: 'Milvus Standalone', parent: 'Cloud Management',  folderName: 'Milvus Standalone' },
];

// ─── New Function docs ────────────────────────────────────────────────────────

const NEW_DOCS = [
    // Configuration / Auth
    {
        title: 'whoami',
        slug: 'Auth-whoami',
        parentSubfolder: 'Auth',
        description: 'This operation shows the currently signed-in identity, the resolved control-plane endpoint, and the list of organizations available to switch into. Alias: `zilliz info`.',
        synopsis: 'zilliz whoami',
        options: [],
        examples: ['zilliz whoami'],
    },
    // NOTE: top-level `zilliz switch` is the canonical v1.x form, but the v0.1.x
    //       bitable record `Auth/switch` already exists and was patched with a
    //       deprecation note describing the rename. We keep one doc for both
    //       invocations rather than creating a duplicate.

    // Configuration / Quickstart
    {
        title: 'quickstart',
        slug: 'Quickstart-quickstart',
        parentSubfolder: 'Quickstart',
        description: 'This operation walks first-time users through sign-in, organization selection, cluster context, and a short menu of common operations (list clusters, set context, list collections, view billing). When stdout is not a TTY or `--non-interactive` is set, only the cheatsheet is printed.',
        synopsis: 'zilliz quickstart\n[--non-interactive]\n[--skip-login]',
        options: [
            {
                name: '--non-interactive',
                type: 'boolean',
                description: 'Skips all prompts and prints only the cheatsheet. Useful for CI or for scripting an environment-bootstrap step.',
            },
            {
                name: '--skip-login',
                type: 'boolean',
                description: 'Skips the auth bootstrap step. Use when credentials are already configured (for example, via `zilliz login` or an environment-provided API key).',
            },
        ],
        examples: [
            '# Interactive guided onboarding',
            'zilliz quickstart',
            '',
            '# Print the cheatsheet only',
            'zilliz quickstart --non-interactive',
        ],
    },

    // Configuration / History
    {
        title: 'list',
        slug: 'History-list',
        parentSubfolder: 'History',
        description: 'This operation lists recent commands recorded in the local history log, ordered newest first. Each entry includes the timestamp, command line, command type, and success flag.',
        synopsis: 'zilliz history list\n[--limit <integer>]\n[--all]',
        options: [
            {
                name: '--limit',
                type: 'integer',
                description: 'Indicates the maximum number of entries to display. Default: 50. Ignored when `--all` is set.',
            },
            {
                name: '--all',
                type: 'boolean',
                description: 'Shows every recorded entry instead of the most recent `--limit` entries.',
            },
        ],
        examples: [
            '# Last 50 entries',
            'zilliz history list',
            '',
            '# Last 10 entries as JSON',
            'zilliz history list --limit 10 -o json',
            '',
            '# Full history',
            'zilliz history list --all',
        ],
    },
    {
        title: 'search',
        slug: 'History-search',
        parentSubfolder: 'History',
        description: 'This operation filters command history to entries whose command line contains the given keyword (case-insensitive substring match), ordered newest first.',
        synopsis: 'zilliz history search\n--keyword <string>',
        options: [
            {
                name: '--keyword',
                type: 'string',
                required: true,
                description: 'Specifies the search term. Case-insensitive substring match against the recorded command line.',
            },
        ],
        examples: [
            '# Find every recorded `cluster create` invocation',
            'zilliz history search --keyword "cluster create"',
            '',
            '# Find any command that mentioned a specific cluster ID',
            'zilliz history search --keyword inxx-1234567890ab',
        ],
    },
    {
        title: 'clear',
        slug: 'History-clear',
        parentSubfolder: 'History',
        description: 'This operation truncates the local command history file. The script holds an exclusive lock during the truncate-then-remove sequence so concurrent CLI invocations cannot lose appended records.',
        synopsis: 'zilliz history clear\n[--force]',
        options: [
            {
                name: '--force',
                type: 'boolean',
                description: 'Skips the interactive `[y/N]` confirmation prompt. Required for non-interactive scripts.',
            },
        ],
        examples: [
            '# Interactive (asks for confirmation)',
            'zilliz history clear',
            '',
            '# Non-interactive',
            'zilliz history clear --force',
        ],
    },

    // Configuration / Context (clear is new in v1.x)
    {
        title: 'clear',
        slug: 'Context-clear',
        parentSubfolder: 'Context',
        description: 'This operation removes the active cluster context. Cluster ID, endpoint, database, and plan are all cleared. Use this before switching organizations or when troubleshooting stale context state.',
        synopsis: 'zilliz context clear',
        options: [],
        examples: ['zilliz context clear'],
    },

    // Cloud Management / Milvus Standalone
    {
        title: 'install',
        slug: 'Milvus_Standalone-install',
        parentSubfolder: 'Milvus Standalone',
        description: 'This operation downloads the official `standalone_embed.sh` script into a local install directory. Pass `--start` to launch the container immediately after download. Requires `bash` and a working Docker daemon if `--start` is used.',
        synopsis: 'zilliz milvus standalone install\n[--dir <path>]\n[--script-url <url>]\n[--dry-run]\n[--start]\n[--force]',
        options: [
            {
                name: '--dir',
                type: 'path',
                description: 'Indicates the install directory. Default: `./milvus-standalone`. Created if missing.',
            },
            {
                name: '--script-url',
                type: 'url',
                description: 'Indicates an HTTPS URL to download `standalone_embed.sh` from. Default: `https://raw.githubusercontent.com/milvus-io/milvus/master/scripts/standalone_embed.sh`. Non-HTTPS URLs are rejected.',
            },
            {
                name: '--dry-run',
                type: 'boolean',
                description: 'Prints the download and start steps without touching the filesystem or Docker.',
            },
            {
                name: '--start',
                type: 'boolean',
                description: 'After downloading, runs `bash standalone_embed.sh start` to launch the Milvus container.',
            },
            {
                name: '--force',
                type: 'boolean',
                description: 'Overwrites an existing `standalone_embed.sh` in the install directory. Without `--force`, install fails if the script is already present.',
            },
        ],
        examples: [
            '# Download into the default directory',
            'zilliz milvus standalone install',
            '',
            '# Download and start in one step',
            'zilliz milvus standalone install --start',
            '',
            '# Custom install directory and overwrite existing script',
            'zilliz milvus standalone install --dir ~/milvus --force',
        ],
    },
    {
        title: 'start',
        slug: 'Milvus_Standalone-start',
        parentSubfolder: 'Milvus Standalone',
        description: 'This operation launches the Milvus standalone container by running `bash standalone_embed.sh start` from the install directory. Default endpoints after start: Milvus `localhost:19530`, WebUI `http://localhost:9091`, embedded etcd `localhost:2379`. Requires a working Docker daemon.',
        synopsis: 'zilliz milvus standalone start\n[--dir <path>]\n[--dry-run]\n[--yes]',
        options: [
            {
                name: '--dir',
                type: 'path',
                description: 'Indicates the install directory containing `standalone_embed.sh`. Default: `./milvus-standalone`.',
            },
            {
                name: '--dry-run',
                type: 'boolean',
                description: 'Prints the command that would run without invoking it.',
            },
            {
                name: '--yes, -y',
                type: 'boolean',
                description: 'Skips confirmation. No-op for non-destructive lifecycle commands but accepted for parity with `delete` / `upgrade`.',
            },
        ],
        examples: [
            'zilliz milvus standalone start',
            '',
            '# From a custom install directory',
            'zilliz milvus standalone start --dir ~/milvus',
        ],
    },
    {
        title: 'stop',
        slug: 'Milvus_Standalone-stop',
        parentSubfolder: 'Milvus Standalone',
        description: 'This operation stops the Milvus standalone container by running `bash standalone_embed.sh stop` from the install directory. Data volumes and config files are left untouched.',
        synopsis: 'zilliz milvus standalone stop\n[--dir <path>]\n[--dry-run]\n[--yes]',
        options: [
            {
                name: '--dir',
                type: 'path',
                description: 'Indicates the install directory. Default: `./milvus-standalone`.',
            },
            {
                name: '--dry-run',
                type: 'boolean',
                description: 'Prints the command that would run without invoking it.',
            },
            {
                name: '--yes, -y',
                type: 'boolean',
                description: 'Skips confirmation. No-op for non-destructive lifecycle commands but accepted for parity with `delete` / `upgrade`.',
            },
        ],
        examples: ['zilliz milvus standalone stop'],
    },
    {
        title: 'restart',
        slug: 'Milvus_Standalone-restart',
        parentSubfolder: 'Milvus Standalone',
        description: 'This operation stops and then starts the Milvus standalone container by running `bash standalone_embed.sh restart`. Requires a working Docker daemon.',
        synopsis: 'zilliz milvus standalone restart\n[--dir <path>]\n[--dry-run]\n[--yes]',
        options: [
            {
                name: '--dir',
                type: 'path',
                description: 'Indicates the install directory. Default: `./milvus-standalone`.',
            },
            {
                name: '--dry-run',
                type: 'boolean',
                description: 'Prints the command that would run without invoking it.',
            },
            {
                name: '--yes, -y',
                type: 'boolean',
                description: 'Skips confirmation. No-op for non-destructive lifecycle commands but accepted for parity with `delete` / `upgrade`.',
            },
        ],
        examples: ['zilliz milvus standalone restart'],
    },
    {
        title: 'delete',
        slug: 'Milvus_Standalone-delete',
        parentSubfolder: 'Milvus Standalone',
        description: 'This operation removes the `milvus-standalone` container, the `volumes/` data directory, and the `embedEtcd.yaml` / `user.yaml` config files. Destructive — requires confirmation or `--yes`. Useful when you want a clean reinstall.',
        synopsis: 'zilliz milvus standalone delete\n[--dir <path>]\n[--dry-run]\n[--yes]',
        options: [
            {
                name: '--dir',
                type: 'path',
                description: 'Indicates the install directory whose contents will be removed. Default: `./milvus-standalone`.',
            },
            {
                name: '--dry-run',
                type: 'boolean',
                description: 'Prints what would be removed without touching the filesystem or Docker.',
            },
            {
                name: '--yes, -y',
                type: 'boolean',
                description: 'Skips the destructive confirmation prompt. Required for non-interactive scripts.',
            },
        ],
        examples: [
            '# Interactive (prompts for confirmation)',
            'zilliz milvus standalone delete',
            '',
            '# Non-interactive',
            'zilliz milvus standalone delete --yes',
            '',
            '# Preview without touching anything',
            'zilliz milvus standalone delete --dry-run',
        ],
    },
    {
        title: 'upgrade',
        slug: 'Milvus_Standalone-upgrade',
        parentSubfolder: 'Milvus Standalone',
        description: 'This operation stops the container and replaces `standalone_embed.sh` with the latest version from upstream master, then restarts. Destructive — requires confirmation or `--yes`. Alias: `update`.',
        synopsis: 'zilliz milvus standalone upgrade\n[--dir <path>]\n[--dry-run]\n[--yes]',
        options: [
            {
                name: '--dir',
                type: 'path',
                description: 'Indicates the install directory. Default: `./milvus-standalone`.',
            },
            {
                name: '--dry-run',
                type: 'boolean',
                description: 'Prints the upgrade steps without invoking them.',
            },
            {
                name: '--yes, -y',
                type: 'boolean',
                description: 'Skips the destructive confirmation prompt. Required for non-interactive scripts.',
            },
        ],
        examples: [
            '# Interactive',
            'zilliz milvus standalone upgrade',
            '',
            '# Non-interactive (alias: update)',
            'zilliz milvus standalone update --yes',
        ],
    },

    // Cloud Management / Billing
    {
        title: 'download-invoice',
        slug: 'Billing-download-invoice',
        parentSubfolder: 'Billing',
        description: 'This operation downloads an invoice as PDF. Use `zilliz billing invoices` to list available invoice IDs first. The PDF is saved as `./<invoiceId>.pdf` if neither `--output-file` nor `--dir` is supplied.',
        synopsis: 'zilliz billing download-invoice\n--invoice-id <string>\n[--output-file <path> | --dir <path>]',
        options: [
            {
                name: '--invoice-id',
                type: 'string',
                required: true,
                description: 'Specifies the invoice ID to download. Use `zilliz billing invoices` to list IDs.',
            },
            {
                name: '--output-file, -o',
                type: 'path',
                description: 'Specifies the output file path. Auto-appends `.pdf` if missing. Mutually exclusive with `--dir`.',
            },
            {
                name: '--dir, -d',
                type: 'path',
                description: 'Specifies a directory to save the PDF as `<dir>/<invoiceId>.pdf`. Mutually exclusive with `--output-file`.',
            },
        ],
        examples: [
            '# Save to ./<invoiceId>.pdf',
            'zilliz billing download-invoice --invoice-id inv-xxxx',
            '',
            '# Save to a specific directory',
            'zilliz billing download-invoice --invoice-id inv-xxxx -d ~/Downloads',
            '',
            '# Save to an explicit file path',
            'zilliz billing download-invoice --invoice-id inv-xxxx -o ~/Downloads/march.pdf',
        ],
    },

    // Data Operations / Collection
    {
        title: 'metrics',
        slug: 'Collection-metrics',
        parentSubfolder: 'Collection',
        description: 'This operation fetches per-collection metrics (QPS, latency, VPS, failure rate, entity counts) for the given metric names over the requested time window. By default the result is rendered as an inline Braille chart; pass `-o table` for a pivot table or `-o json` / `-o yaml` / `-o csv` / `--query` for raw data.',
        synopsis: 'zilliz collection metrics\n[--cluster-id <string>]\n--collection-name <string>\n--metric <string>...\n[--period <string>]\n[--start <iso8601>]\n[--end <iso8601>]\n[--granularity <string>]',
        options: [
            {
                name: '--cluster-id',
                type: 'string',
                description: 'Indicates the cluster ID. When omitted, the active context cluster is used.',
            },
            {
                name: '--collection-name, -c',
                type: 'string',
                required: true,
                description: 'Specifies the collection name to fetch metrics for.',
            },
            {
                name: '--metric, -m',
                type: 'string',
                required: true,
                description: 'Specifies a metric name. Repeatable. Valid collection-scope metrics include: `SEARCH_QPS`, `QUERY_QPS`, `INSERT_QPS`, `UPSERT_QPS`, `DELETE_QPS`, `BULK_INSERT_QPS`, `HYBRID_SEARCH_QPS`, `SEARCH_LATENCY_AVG`, `SEARCH_LATENCY_P99`, `QUERY_LATENCY_AVG`, `QUERY_LATENCY_P99`, `INSERT_LATENCY_AVG`, `INSERT_LATENCY_P99`, `UPSERT_LATENCY_AVG`, `UPSERT_LATENCY_P99`, `DELETE_LATENCY_AVG`, `DELETE_LATENCY_P99`, `HYBRID_SEARCH_LATENCY_AVG`, `HYBRID_SEARCH_LATENCY_P99`, `SEARCH_VPS`, `INSERT_VPS`, `UPSERT_VPS`, `DELETE_VPS`, `BULK_INSERT_VPS`, `SEARCH_FAIL_RATE`, `QUERY_FAIL_RATE`, `INSERT_FAIL_RATE`, `UPSERT_FAIL_RATE`, `DELETE_FAIL_RATE`, `HYBRID_SEARCH_FAIL_RATE`, `BULK_INSERT_FAIL_RATE`, `ENTITIES`, `ENTITIES_LOADED`, `ENTITIES_INDEXED`.',
            },
            {
                name: '--period',
                type: 'string',
                description: 'Indicates the look-back window. Accepted values: `10m`, `1h`, `6h`, `24h`, `3d`, `7d`. Default: `1h`. Mutually exclusive with `--start` / `--end`.',
            },
            {
                name: '--start',
                type: 'string',
                description: 'Indicates the start timestamp in ISO 8601 format (for example, `2026-04-01T00:00:00Z`). Use with `--end` instead of `--period` for explicit ranges.',
            },
            {
                name: '--end',
                type: 'string',
                description: 'Indicates the end timestamp in ISO 8601 format. Pairs with `--start`.',
            },
            {
                name: '--granularity, -g',
                type: 'string',
                description: 'Indicates the data-point interval. Accepted values: `1m`, `5m`, `1h`, `1d`. Defaults to a sensible value based on `--period`.',
            },
        ],
        examples: [
            '# Inline chart of insert + search QPS over the last hour',
            'zilliz collection metrics -c my_collection -m INSERT_QPS -m SEARCH_QPS',
            '',
            '# Pivot table of latency for the last 24 hours, 5-minute granularity',
            'zilliz collection metrics -c my_collection -m SEARCH_LATENCY_P99 -m QUERY_LATENCY_P99 --period 24h -g 5m -o table',
            '',
            '# Raw JSON for downstream tooling',
            'zilliz collection metrics -c my_collection -m ENTITIES -o json',
        ],
    },
];

// ─── Markdown builder ─────────────────────────────────────────────────────────

function buildMarkdown(doc) {
    const lines = [];
    lines.push(doc.description);
    lines.push('');
    lines.push('## Synopsis');
    lines.push('');
    lines.push('```bash');
    lines.push(doc.synopsis);
    lines.push('```');
    lines.push('');

    if (doc.options && doc.options.length > 0) {
        lines.push('## Options');
        lines.push('');
        for (const opt of doc.options) {
            const reqMark = opt.required ? ' ' : ' ';
            lines.push(`- **${opt.name}** (*${opt.type}*) -`);
            if (opt.required) {
                lines.push(`  **[REQUIRED]**`);
            }
            lines.push(`  ${opt.description}`);
        }
        lines.push('');
    }

    lines.push('## Example');
    lines.push('');
    lines.push('```bash');
    lines.push(...doc.examples);
    lines.push('```');
    lines.push('');

    return lines.join('\n');
}

// ─── Drive helpers ────────────────────────────────────────────────────────────

async function listFolderDocs(folderToken) {
    const items = [];
    let pageToken = null;
    do {
        let url = `${HOST}/open-apis/drive/v1/files?folder_token=${folderToken}&page_size=200`;
        if (pageToken) url += `&page_token=${pageToken}`;
        const t   = await tf.token();
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${t}` } });
        const d   = await res.json();
        if (d.code !== 0) throw new Error(`listFolder ${folderToken}: ${d.msg}`);
        for (const f of (d.data.files || [])) items.push(f);
        pageToken = d.data.has_more ? d.data.next_page_token : null;
    } while (pageToken);
    return items;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
    console.log(`create-new-docs${DRY_RUN ? ' (DRY RUN)' : ''}`);
    const bw = new BitableWriter({ baseToken: BITABLE, tableId: TABLE });

    // Index existing bitable records once
    console.log('\nIndexing existing bitable records...');
    const existingRecords = await bw.listRecords();
    const recordByTitleAndParent = new Map();
    for (const r of existingRecords) {
        const title = r.fields['Docs']?.text || r.fields['Title'];
        if (!title) continue;
        const parentArr = r.fields['父记录'];
        const parentId = Array.isArray(parentArr) && parentArr.length > 0
            ? (parentArr[0].record_ids?.[0] || parentArr[0])
            : null;
        recordByTitleAndParent.set(`${parentId || 'null'}:${title}`, r);
    }
    const recordByTitle = new Map();
    for (const r of existingRecords) {
        const title = r.fields['Docs']?.text || r.fields['Title'];
        if (title) recordByTitle.set(title, r);
    }

    // ── Step 1: VirtualNode records for new subfolders ────────────────────────
    console.log('\n=== Step 1: VirtualNode records for new subfolders ===');
    for (const vn of NEW_VIRTUAL_NODES) {
        const folderTok = FOLDER_TOKEN[vn.folderName];
        const link      = `${FEISHU_FOLDER}/${folderTok}`;
        const parentRec = CATEGORY_PARENT[vn.parent];

        const existing = recordByTitleAndParent.get(`${parentRec}:${vn.title}`);
        if (existing) {
            console.log(`  [skip] VirtualNode "${vn.title}" already exists (${existing.record_id})`);
            PARENT_RECORD[vn.title] = existing.record_id;
            continue;
        }

        if (DRY_RUN) {
            console.log(`  [dry] Would create VirtualNode "${vn.title}" under ${vn.parent} -> ${link}`);
            PARENT_RECORD[vn.title] = '<dry-run-record-id>';
            continue;
        }

        const created = await bw.createRecord({
            title:          vn.title,
            link,
            type:           'VirtualNode',
            parentRecordId: parentRec,
        });
        const recId = created.record_id || created.record?.record_id;
        console.log(`  [create] VirtualNode "${vn.title}" -> ${recId}`);
        PARENT_RECORD[vn.title] = recId;
        await sleep(250);
    }

    // ── Step 2: Function docs + bitable records ───────────────────────────────
    console.log('\n=== Step 2: Function docs + bitable records ===');

    // Pre-list each target folder once
    const folderContents = new Map();
    for (const doc of NEW_DOCS) {
        const folderTok = FOLDER_TOKEN[doc.parentSubfolder];
        if (!folderContents.has(folderTok)) {
            const files = DRY_RUN ? [] : await listFolderDocs(folderTok);
            folderContents.set(folderTok, new Map(files.map(f => [f.name, f])));
            await sleep(120);
        }
    }

    let createdDocs = 0, skippedDocs = 0, createdRecs = 0, skippedRecs = 0;

    for (let i = 0; i < NEW_DOCS.length; i++) {
        const doc       = NEW_DOCS[i];
        const idx       = `[${i+1}/${NEW_DOCS.length}]`;
        const folderTok = FOLDER_TOKEN[doc.parentSubfolder];
        const parentRec = PARENT_RECORD[doc.parentSubfolder];

        if (!folderTok) throw new Error(`No folder token for ${doc.parentSubfolder}`);
        if (!parentRec) throw new Error(`No parent record for ${doc.parentSubfolder}`);

        // Check if doc already exists in folder
        const existingDoc = folderContents.get(folderTok).get(doc.title);
        let docId, docLink;

        if (existingDoc && existingDoc.type === 'docx') {
            docId   = existingDoc.token;
            docLink = `${FEISHU_DOC}/${docId}`;
            console.log(`${idx} [doc skip] ${doc.parentSubfolder}/${doc.title} -> ${docId}`);
            skippedDocs++;
        } else if (DRY_RUN) {
            console.log(`${idx} [dry] Would push doc "${doc.title}" to folder ${folderTok}`);
            docId   = '<dry-run-doc-id>';
            docLink = `${FEISHU_DOC}/${docId}`;
            createdDocs++;
        } else {
            const md  = buildMarkdown(doc);
            const m2f = new MarkdownToFeishu({
                sourceType: 'drive',
                rootToken:  folderTok,
                baseToken:  null,
            });
            const result = await m2f.push_markdown({
                markdown_content: md,
                title:            doc.title,
                folder_token:     folderTok,
            });
            docId   = result.document_id;
            docLink = `${FEISHU_DOC}/${docId}`;
            console.log(`${idx} [doc create] ${doc.parentSubfolder}/${doc.title} -> ${docId} (${result.blocks_created} blocks)`);
            createdDocs++;
            await sleep(250);
        }

        // Bitable record
        const existingRec = recordByTitleAndParent.get(`${parentRec}:${doc.title}`);
        if (existingRec) {
            console.log(`${idx} [rec skip] record for "${doc.title}" already exists (${existingRec.record_id})`);
            skippedRecs++;
            continue;
        }
        if (DRY_RUN) {
            console.log(`${idx} [dry] Would create bitable record for "${doc.title}" -> ${docLink}`);
            createdRecs++;
            continue;
        }

        const created = await bw.createRecord({
            title:          doc.title,
            link:           docLink,
            type:           'Function',
            addedSince:     'v1.x',
            progress:       'Draft',
            targets:        ['Zilliz'],
            parentRecordId: parentRec,
        });
        const recId = created.record_id || created.record?.record_id;
        console.log(`${idx} [rec create] -> ${recId}`);
        createdRecs++;
        await sleep(250);
    }

    console.log('\nSummary:');
    console.log(`  docs:    ${createdDocs} created, ${skippedDocs} skipped`);
    console.log(`  records: ${createdRecs} created, ${skippedRecs} skipped`);
})().catch(e => {
    console.error(`\nFATAL: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

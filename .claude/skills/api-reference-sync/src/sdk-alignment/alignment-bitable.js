/**
 * AlignmentBitable — writes SDK alignment data to a Feishu bitable.
 *
 * Each interface becomes an interface row (Parameter empty);
 * each parameter becomes a param row (Parameter filled, 父记录 → interface record).
 * Language columns are single-select: ✓, -, or N/A.
 */

const fetch = require('node-fetch');
const larkTokenFetcher = require('../../lib/lark-docs/larkTokenFetcher');

require('dotenv').config();

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';

const LANG_COLS = ['Python', 'Java', 'Node', 'C++', 'Go'];
const LANG_KEY_MAP = { Python: 'python', Java: 'java', Node: 'node', 'C++': 'cpp', Go: 'go' };

const STATUS_OPTIONS = ['✓', '-', 'N/A'];

const CATEGORY_OPTIONS = [
    'Client', 'Collections', 'Database', 'Management',
    'Partitions', 'Vector', 'Authentication', 'ResourceGroup',
];

class AlignmentBitable {
    /**
     * @param {Object} opts
     * @param {string} [opts.appToken] - Existing bitable app token (omit to create new)
     * @param {string} [opts.tableId] - Existing table ID (omit to auto-resolve)
     * @param {string} [opts.folderToken] - Feishu folder to create bitable in
     * @param {boolean} [opts.dryRun] - Log stats but skip API calls
     * @param {boolean} [opts.cleanup] - Delete orphan records
     */
    constructor({ appToken = null, tableId = null, folderToken = null, dryRun = false, cleanup = false } = {}) {
        this.appToken = appToken;
        this.tableId = tableId;
        this.folderToken = folderToken;
        this.dryRun = dryRun;
        this.cleanup = cleanup;
        this.tokenFetcher = new larkTokenFetcher();
    }

    /**
     * Main entry — populate the bitable from alignment data.
     * @param {Map} registry - canonical name → { category, sdks }
     * @param {Object} paramComparisons - canonical name → { params: Map, allLanguages }
     * @param {string[]} languages - ordered list of language keys
     */
    async populate(registry, paramComparisons, languages) {
        // Build flat row data first (no API calls)
        const { interfaceRows, paramRows } = this._buildRows(registry, paramComparisons, languages);

        console.log(`[BITABLE] ${interfaceRows.length} interface rows, ${paramRows.length} param rows`);

        if (this.dryRun) {
            this._printDryRunStats(interfaceRows, paramRows);
            return;
        }

        // Ensure bitable + table + fields exist
        await this._ensureBitable();

        // Load existing records for idempotency
        const existing = await this._loadExistingRecords();

        // Upsert interface records first (need record IDs for parent linking)
        const interfaceIdMap = await this._upsertInterfaceRecords(interfaceRows, existing);

        // Upsert parameter records with parent links
        await this._upsertParameterRecords(paramRows, interfaceIdMap, existing);

        // Warn about (and optionally delete) orphans
        await this._warnOrphans(existing, interfaceRows, paramRows);
    }

    // ──────────────────────────────────────────────
    // Row building (pure logic, no API calls)
    // ──────────────────────────────────────────────

    _buildRows(registry, paramComparisons, languages) {
        const interfaceRows = [];
        const paramRows = [];

        for (const [name, entry] of registry) {
            const sdkCount = Object.keys(entry.sdks).length;

            // Interface row
            const iRow = {
                Interface: name,
                Parameter: '',
                Category: entry.category,
                'SDK Count': sdkCount,
            };
            for (const col of LANG_COLS) {
                const langKey = LANG_KEY_MAP[col];
                iRow[col] = entry.sdks[langKey] ? '✓' : '-';
            }
            interfaceRows.push(iRow);

            // Parameter rows — only for methods in 2+ SDKs
            if (sdkCount < 2) continue;

            const comparison = paramComparisons[name];
            if (!comparison || !comparison.params) continue;

            for (const [param, presence] of comparison.params) {
                const pRow = {
                    Interface: name,
                    Parameter: param,
                    Category: entry.category,
                    'SDK Count': 0,
                };
                let pCount = 0;
                for (const col of LANG_COLS) {
                    const langKey = LANG_KEY_MAP[col];
                    if (!entry.sdks[langKey]) {
                        // Method doesn't exist in this SDK
                        pRow[col] = 'N/A';
                    } else if (presence[langKey]) {
                        pRow[col] = '✓';
                        pCount++;
                    } else {
                        pRow[col] = '-';
                    }
                }
                pRow['SDK Count'] = pCount;
                paramRows.push(pRow);
            }
        }

        return { interfaceRows, paramRows };
    }

    _printDryRunStats(interfaceRows, paramRows) {
        const byCat = {};
        for (const row of interfaceRows) {
            byCat[row.Category] = (byCat[row.Category] || 0) + 1;
        }
        console.log('[BITABLE] Interface rows by category:');
        for (const [cat, count] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
            console.log(`  ${cat}: ${count}`);
        }
        console.log(`[BITABLE] Total param rows: ${paramRows.length}`);

        // Count methods with params
        const methodsWithParams = new Set(paramRows.map(r => r.Interface)).size;
        console.log(`[BITABLE] Methods with params: ${methodsWithParams}`);
    }

    // ──────────────────────────────────────────────
    // Bitable setup
    // ──────────────────────────────────────────────

    async _ensureBitable() {
        if (this.appToken && this.tableId) return;

        if (this.appToken) {
            // Resolve table ID from existing bitable
            const data = await this._feishuAPI('GET',
                `/open-apis/bitable/v1/apps/${this.appToken}/tables`);
            this.tableId = data.items[0].table_id;
            console.log(`[BITABLE] Resolved table: ${this.tableId}`);
            return;
        }

        // Create new bitable
        console.log('[BITABLE] Creating new bitable...');
        const date = new Date().toISOString().slice(0, 10);
        const body = { name: `SDK Alignment - ${date}` };
        if (this.folderToken) body.folder_token = this.folderToken;
        const data = await this._feishuAPI('POST', '/open-apis/bitable/v1/apps', body);
        this.appToken = data.app.app_token;
        console.log(`[BITABLE] Created bitable: ${this.appToken}`);

        // Get default table
        const tables = await this._feishuAPI('GET',
            `/open-apis/bitable/v1/apps/${this.appToken}/tables`);
        this.tableId = tables.items[0].table_id;
        console.log(`[BITABLE] Default table: ${this.tableId}`);

        // Create fields
        await this._createFields();
    }

    async _createFields() {
        console.log('[BITABLE] Creating fields...');
        const basePath = `/open-apis/bitable/v1/apps/${this.appToken}/tables/${this.tableId}/fields`;

        // Interface (text) — likely already exists as default first column, rename it
        // List existing fields first
        const existingFields = await this._feishuAPI('GET', basePath);
        const defaultField = existingFields.items[0];
        await this._feishuAPI('PUT', `${basePath}/${defaultField.field_id}`, {
            field_name: 'Interface',
            type: 1, // text
        });

        // Parameter (text)
        await this._feishuAPI('POST', basePath, {
            field_name: 'Parameter',
            type: 1,
        });

        // Category (single select)
        await this._feishuAPI('POST', basePath, {
            field_name: 'Category',
            type: 3,
            property: {
                options: CATEGORY_OPTIONS.map(name => ({ name })),
            },
        });

        // Language columns (single select with ✓/-/N/A)
        for (const lang of LANG_COLS) {
            await this._feishuAPI('POST', basePath, {
                field_name: lang,
                type: 3,
                property: {
                    options: STATUS_OPTIONS.map(name => ({ name })),
                },
            });
        }

        // SDK Count (number)
        await this._feishuAPI('POST', basePath, {
            field_name: 'SDK Count',
            type: 2,
        });

        // 父记录 (one-way link to self)
        await this._feishuAPI('POST', basePath, {
            field_name: '父记录',
            type: 21, // one-way link
            property: {
                table_id: this.tableId,
            },
        });

        console.log('[BITABLE] Fields created');
    }

    // ──────────────────────────────────────────────
    // Load existing records
    // ──────────────────────────────────────────────

    async _loadExistingRecords() {
        console.log('[BITABLE] Loading existing records...');
        const records = await this._fetchAllRecords();
        console.log(`[BITABLE] Found ${records.length} existing records`);

        const interfaceMap = new Map(); // name → { recordId, fields }
        const paramMap = new Map();     // "interface::param" → { recordId, fields }

        for (const rec of records) {
            const iface = this._textValue(rec.fields['Interface']);
            const param = this._textValue(rec.fields['Parameter']);

            if (!iface) continue;

            if (!param) {
                interfaceMap.set(iface, { recordId: rec.record_id, fields: rec.fields });
            } else {
                paramMap.set(`${iface}::${param}`, { recordId: rec.record_id, fields: rec.fields });
            }
        }

        return { interfaceMap, paramMap };
    }

    async _fetchAllRecords() {
        const all = [];
        let pageToken = null;
        const basePath = `/open-apis/bitable/v1/apps/${this.appToken}/tables/${this.tableId}/records`;

        do {
            let url = `${basePath}?page_size=500`;
            if (pageToken) url += `&page_token=${pageToken}`;

            const data = await this._feishuAPI('GET', url);
            if (data.items) all.push(...data.items);
            pageToken = data.has_more ? data.page_token : null;
        } while (pageToken);

        return all;
    }

    // ──────────────────────────────────────────────
    // Upsert interface records
    // ──────────────────────────────────────────────

    async _upsertInterfaceRecords(interfaceRows, existing) {
        const { interfaceMap } = existing;
        const toCreate = [];
        const toUpdate = [];
        const idMap = new Map(); // name → recordId

        for (const row of interfaceRows) {
            const ex = interfaceMap.get(row.Interface);
            if (ex) {
                idMap.set(row.Interface, ex.recordId);
                if (this._recordNeedsUpdate(ex.fields, row, false)) {
                    toUpdate.push({ recordId: ex.recordId, fields: this._formatRecord(row, false) });
                }
            } else {
                toCreate.push(row);
            }
        }

        console.log(`[BITABLE] Interfaces: ${toCreate.length} create, ${toUpdate.length} update, ${interfaceRows.length - toCreate.length - toUpdate.length} skip`);

        // Batch create
        if (toCreate.length > 0) {
            const created = await this._batchCreateRecords(
                toCreate.map(row => this._formatRecord(row, false))
            );
            for (let i = 0; i < created.length; i++) {
                idMap.set(toCreate[i].Interface, created[i].record_id);
            }
        }

        // Batch update
        if (toUpdate.length > 0) {
            await this._batchUpdateRecords(toUpdate);
        }

        return idMap;
    }

    // ──────────────────────────────────────────────
    // Upsert parameter records
    // ──────────────────────────────────────────────

    async _upsertParameterRecords(paramRows, interfaceIdMap, existing) {
        const { paramMap } = existing;
        const toCreate = [];
        const toUpdate = [];

        for (const row of paramRows) {
            const parentId = interfaceIdMap.get(row.Interface);
            const key = `${row.Interface}::${row.Parameter}`;
            const ex = paramMap.get(key);

            if (ex) {
                if (this._recordNeedsUpdate(ex.fields, row, true)) {
                    toUpdate.push({ recordId: ex.recordId, fields: this._formatRecord(row, true, parentId) });
                }
            } else {
                toCreate.push({ row, parentId });
            }
        }

        console.log(`[BITABLE] Params: ${toCreate.length} create, ${toUpdate.length} update, ${paramRows.length - toCreate.length - toUpdate.length} skip`);

        // Batch create in chunks of 500
        if (toCreate.length > 0) {
            const records = toCreate.map(({ row, parentId }) => this._formatRecord(row, true, parentId));
            await this._batchCreateRecords(records);
        }

        // Batch update in chunks of 500
        if (toUpdate.length > 0) {
            await this._batchUpdateRecords(toUpdate);
        }
    }

    // ──────────────────────────────────────────────
    // Record formatting & comparison
    // ──────────────────────────────────────────────

    _formatRecord(row, isParam, parentId = null) {
        const fields = {
            'Interface': row.Interface,
            'Parameter': row.Parameter || '',
            'Category': row.Category,
            'SDK Count': row['SDK Count'],
        };

        for (const col of LANG_COLS) {
            fields[col] = row[col];
        }

        if (isParam && parentId) {
            fields['父记录'] = [parentId];
        }

        return fields;
    }

    _recordNeedsUpdate(existingFields, row, isParam) {
        // Compare language columns
        for (const col of LANG_COLS) {
            const exVal = this._singleSelectValue(existingFields[col]);
            if (exVal !== row[col]) return true;
        }

        // SDK Count comes back as string from API
        const exCount = Number(existingFields['SDK Count']);
        if (exCount !== row['SDK Count']) return true;

        const exCat = this._singleSelectValue(existingFields['Category']);
        if (exCat !== row.Category) return true;

        return false;
    }

    _textValue(field) {
        if (!field) return '';
        if (typeof field === 'string') return field;
        // Bitable text fields return [{type: "text", text: "value"}]
        if (Array.isArray(field)) {
            return field.map(seg => seg.text || '').join('');
        }
        return '';
    }

    _singleSelectValue(field) {
        if (!field) return '';
        if (typeof field === 'string') return field;
        return '';
    }

    // ──────────────────────────────────────────────
    // Orphan detection
    // ──────────────────────────────────────────────

    async _warnOrphans(existing, interfaceRows, paramRows) {
        const expectedInterfaces = new Set(interfaceRows.map(r => r.Interface));
        const expectedParams = new Set(paramRows.map(r => `${r.Interface}::${r.Parameter}`));

        const orphanIds = [];
        for (const [name, { recordId }] of existing.interfaceMap) {
            if (!expectedInterfaces.has(name)) {
                console.log(`[BITABLE] WARNING: orphan interface record: ${name}`);
                orphanIds.push(recordId);
            }
        }
        for (const [key, { recordId }] of existing.paramMap) {
            if (!expectedParams.has(key)) {
                console.log(`[BITABLE] WARNING: orphan param record: ${key}`);
                orphanIds.push(recordId);
            }
        }
        if (orphanIds.length > 0) {
            if (this.cleanup) {
                await this._batchDeleteRecords(orphanIds);
                console.log(`[BITABLE] Deleted ${orphanIds.length} orphan records`);
            } else {
                console.log(`[BITABLE] ${orphanIds.length} orphan records detected (use --cleanup to delete)`);
            }
        }
    }

    // ──────────────────────────────────────────────
    // Batch API helpers
    // ──────────────────────────────────────────────

    async _batchCreateRecords(recordFields) {
        const allCreated = [];
        const basePath = `/open-apis/bitable/v1/apps/${this.appToken}/tables/${this.tableId}/records/batch_create`;

        for (let i = 0; i < recordFields.length; i += 500) {
            const chunk = recordFields.slice(i, i + 500);
            const data = await this._feishuAPI('POST', basePath, {
                records: chunk.map(fields => ({ fields })),
            });
            if (data.records) allCreated.push(...data.records);
            console.log(`[BITABLE] Batch created ${chunk.length} records (${i + chunk.length}/${recordFields.length})`);
        }

        return allCreated;
    }

    async _batchUpdateRecords(updates) {
        const basePath = `/open-apis/bitable/v1/apps/${this.appToken}/tables/${this.tableId}/records/batch_update`;

        for (let i = 0; i < updates.length; i += 500) {
            const chunk = updates.slice(i, i + 500);
            await this._feishuAPI('POST', basePath, {
                records: chunk.map(({ recordId, fields }) => ({
                    record_id: recordId,
                    fields,
                })),
            });
            console.log(`[BITABLE] Batch updated ${chunk.length} records (${i + chunk.length}/${updates.length})`);
        }
    }

    async _batchDeleteRecords(recordIds) {
        const basePath = `/open-apis/bitable/v1/apps/${this.appToken}/tables/${this.tableId}/records/batch_delete`;

        for (let i = 0; i < recordIds.length; i += 500) {
            const chunk = recordIds.slice(i, i + 500);
            await this._feishuAPI('POST', basePath, { records: chunk });
            console.log(`[BITABLE] Batch deleted ${chunk.length} records (${i + chunk.length}/${recordIds.length})`);
        }
    }

    // ──────────────────────────────────────────────
    // Feishu API helper (self-contained per project convention)
    // ──────────────────────────────────────────────

    async _feishuAPI(method, path, body = null) {
        const token = await this.tokenFetcher.token();
        const url = path.startsWith('http') ? path : `${FEISHU_HOST}${path}`;

        const opts = {
            method,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Bearer ${token}`,
            },
        };
        if (body) opts.body = JSON.stringify(body);

        const res = await fetch(url, opts);
        const data = await res.json();

        if (data.code !== 0) {
            throw new Error(`Feishu API error (${path}): ${data.code} ${data.msg}`);
        }

        return data.data;
    }
}

module.exports = AlignmentBitable;

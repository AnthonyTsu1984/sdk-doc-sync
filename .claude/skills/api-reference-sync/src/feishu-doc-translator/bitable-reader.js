const fetch = require('node-fetch');
const larkTokenFetcher = require('../../lib/lark-docs/larkTokenFetcher');

require('dotenv').config();

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';

/**
 * BitableReader - Read and parse bitable records from Feishu
 */
class BitableReader {
    constructor({ baseToken, tableId = null }) {
        this.baseToken = baseToken;
        this.tableId = tableId;
        this.tokenFetcher = new larkTokenFetcher();
    }

    async _resolveTableId() {
        if (this.tableId) return this.tableId;

        const token = await this.tokenFetcher.token();
        const url = `${FEISHU_HOST}/open-apis/bitable/v1/apps/${this.baseToken}/tables`;

        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Bearer ${token}`,
            },
        });

        const data = await res.json();
        if (data.code !== 0) {
            throw new Error(`Failed to list tables: ${data.msg}`);
        }

        this.tableId = data.data.items[0].table_id;
        return this.tableId;
    }

    /**
     * List all records from the bitable
     * @returns {Array} Array of record objects with normalized structure
     */
    async listRecords({ pageSize = 500 } = {}) {
        const token = await this.tokenFetcher.token();
        const tableId = await this._resolveTableId();

        let allRecords = [];
        let hasMore = true;
        let pageToken = null;

        while (hasMore) {
            const url = pageToken
                ? `${FEISHU_HOST}/open-apis/bitable/v1/apps/${this.baseToken}/tables/${tableId}/records?page_size=${pageSize}&page_token=${pageToken}`
                : `${FEISHU_HOST}/open-apis/bitable/v1/apps/${this.baseToken}/tables/${tableId}/records?page_size=${pageSize}`;

            const res = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Authorization': `Bearer ${token}`,
                },
            });

            const data = await res.json();
            if (data.code !== 0) {
                throw new Error(`Failed to list records: ${data.msg}`);
            }

            allRecords = allRecords.concat(data.data.items || []);
            hasMore = data.data.has_more;
            pageToken = data.data.page_token;
        }

        return allRecords.map(record => this._normalizeRecord(record));
    }

    /**
     * Normalize a raw bitable record to a consistent structure
     * @private
     */
    _normalizeRecord(record) {
        const fields = record.fields;

        return {
            id: record.record_id,
            metadata: {
                title: fields.Docs?.text || '',
                link: fields.Docs?.link || '',
                slug: this._extractSlug(fields.Slug),
                token: fields.Docs?.link ? fields.Docs.link.split('/').pop() : '',
                type: fields.Type || '',
                added_since: fields['Added Since'] || '',
                last_modified: fields['Last Modified At'] || '',
                deprecate_since: fields['Deprecate Since'] || '',
                progress: fields.Progress || '',
                description: fields.Description || '',
                targets: fields.Targets || [],
                labels: fields.Labels || [],
                keywords: fields.Keywords || [],
            },
            parent: fields['父记录']?.[0]?.record_ids?.[0] || fields['Parent']?.[0]?.record_ids?.[0] || null,
        };
    }

    /**
     * Extract slug from various slug field formats
     * @private
     */
    _extractSlug(slugField) {
        if (!slugField) return '';
        if (typeof slugField === 'string') return slugField;
        if (Array.isArray(slugField) && slugField[0]) {
            const item = slugField[0];
            return item[item.type] || '';
        }
        return '';
    }

    /**
     * Get record by ID
     */
    async getRecord(recordId) {
        const token = await this.tokenFetcher.token();
        const tableId = await this._resolveTableId();
        const url = `${FEISHU_HOST}/open-apis/bitable/v1/apps/${this.baseToken}/tables/${tableId}/records/${recordId}`;

        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Bearer ${token}`,
            },
        });

        const data = await res.json();
        if (data.code !== 0) {
            throw new Error(`Failed to get record: ${data.msg}`);
        }

        return this._normalizeRecord(data.data.record);
    }
}

module.exports = BitableReader;

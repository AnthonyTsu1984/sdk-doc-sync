const fetch = require('node-fetch');
const larkTokenFetcher = require('../../lib/lark-docs/larkTokenFetcher');

require('dotenv').config();

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';

class BitableWriter {
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
            method: 'get',
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

    async listRecords({ pageSize = 500 } = {}) {
        const token = await this.tokenFetcher.token();
        const tableId = await this._resolveTableId();
        const url = `${FEISHU_HOST}/open-apis/bitable/v1/apps/${this.baseToken}/tables/${tableId}/records?page_size=${pageSize}`;

        const res = await fetch(url, {
            method: 'get',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Bearer ${token}`,
            },
        });

        const data = await res.json();
        if (data.code !== 0) {
            throw new Error(`Failed to list records: ${data.msg}`);
        }

        return data.data.items || [];
    }

    async createRecord(fields) {
        const token = await this.tokenFetcher.token();
        const tableId = await this._resolveTableId();
        const url = `${FEISHU_HOST}/open-apis/bitable/v1/apps/${this.baseToken}/tables/${tableId}/records`;

        const formatted = this._formatFields(fields);

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ fields: formatted }),
        });

        const data = await res.json();
        if (data.code !== 0) {
            throw new Error(`Failed to create record: ${data.msg}`);
        }

        return data.data.record;
    }

    async updateRecord(recordId, fields) {
        const token = await this.tokenFetcher.token();
        const tableId = await this._resolveTableId();
        const url = `${FEISHU_HOST}/open-apis/bitable/v1/apps/${this.baseToken}/tables/${tableId}/records/${recordId}`;

        const formatted = this._formatFields(fields);

        const res = await fetch(url, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ fields: formatted }),
        });

        const data = await res.json();
        if (data.code !== 0) {
            throw new Error(`Failed to update record: ${data.msg}`);
        }

        return data.data.record;
    }

    async deleteRecord(recordId) {
        const token = await this.tokenFetcher.token();
        const tableId = await this._resolveTableId();
        const url = `${FEISHU_HOST}/open-apis/bitable/v1/apps/${this.baseToken}/tables/${tableId}/records/${recordId}`;

        const res = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Bearer ${token}`,
            },
        });

        const data = await res.json();
        if (data.code !== 0) {
            throw new Error(`Failed to delete record: ${data.msg}`);
        }

        return data.data;
    }

    async searchRecords(filter) {
        const token = await this.tokenFetcher.token();
        const tableId = await this._resolveTableId();
        const url = `${FEISHU_HOST}/open-apis/bitable/v1/apps/${this.baseToken}/tables/${tableId}/records/search`;

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(filter),
        });

        const data = await res.json();
        if (data.code !== 0) {
            throw new Error(`Failed to search records: ${data.msg}`);
        }

        return data.data.items || [];
    }

    _formatFields(fields) {
        const formatted = {};

        if (fields.title && fields.link) {
            formatted['Docs'] = { text: fields.title, link: fields.link };
        } else if (fields.title) {
            formatted['Docs'] = fields.title;
        }

        // Slug is a DuplexLink auto-populated by Feishu — never set it
        if (fields.progress !== undefined) formatted['Progress'] = fields.progress;
        if (fields.addedSince !== undefined) formatted['Added Since'] = fields.addedSince;
        if (fields.deprecateSince !== undefined) formatted['Deprecate Since'] = fields.deprecateSince;
        if (fields.description !== undefined) formatted['Description'] = fields.description;
        if (fields.type !== undefined) formatted['Type'] = fields.type;
        if (fields.tag !== undefined) formatted['Tag'] = Array.isArray(fields.tag) ? fields.tag : [fields.tag];
        if (fields.targets !== undefined) formatted['Targets'] = Array.isArray(fields.targets) ? fields.targets : [fields.targets];
        if (fields.labels !== undefined) formatted['Labels'] = fields.labels;
        if (fields.lastModified !== undefined) formatted['Last Modified At'] = fields.lastModified;
        if (fields.parentRecordId !== undefined) {
            formatted['父记录'] = [fields.parentRecordId];
        }

        return formatted;
    }
}

module.exports = BitableWriter;

'use strict';

// Production plan-time client for localized-doc-sync freshness re-enumeration
// (localization.complete-dual-base-enumeration). Implements the scanner
// contract that src/inventory-scanner.js scanBase() consumes — getBase /
// listTables / listFields / listViews / listRecords, each fully paginated.
// Auth reuses the shared larkTokenFetcher; this module holds no credentials.
// The canonical plan CLI loads this module by default (see
// bin/localized-doc-sync.js, --client-module to override).

const fetch = require('node-fetch');
const LarkTokenFetcher = require('../../api-reference-sync/lib/lark-docs/larkTokenFetcher');

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const PAGE_SIZE = 100;

function page(items) {
    return { items, hasMore: false };
}

class FeishuBaseClient {
    constructor({ baseToken, fetchImpl = fetch, tokenFetcher = null } = {}) {
        if (!baseToken) throw new TypeError('baseToken is required');
        this.baseToken = baseToken;
        this.fetchImpl = fetchImpl;
        this.tokenFetcher = tokenFetcher || new LarkTokenFetcher();
    }

    async _get(path) {
        const token = await this.tokenFetcher.token();
        const res = await this.fetchImpl(`${FEISHU_HOST}${path}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Bearer ${token}`,
            },
        });
        const data = await res.json();
        if (data.code !== 0) {
            throw new Error(`Feishu bitable request failed (${path}): ${data.msg}`);
        }
        return data.data || {};
    }

    async _list(path) {
        const items = [];
        let pageToken = null;
        for (;;) {
            const separator = path.includes('?') ? '&' : '?';
            const data = await this._get(`${path}${separator}page_size=${PAGE_SIZE}${pageToken ? `&page_token=${pageToken}` : ''}`);
            items.push(...(data.items || []));
            if (!data.has_more) return items;
            pageToken = data.page_token;
            if (!pageToken) {
                throw Object.assign(new Error('Feishu pagination token missing while has_more=true'), { code: 'PAGINATION_TOKEN_REQUIRED' });
            }
        }
    }

    // The argument shapes below match scanBase()'s call pattern
    // ({ baseToken, tableId, pageToken }); the per-base client keeps its own
    // baseToken and ignores the caller's. Field-name mappings must stay
    // stable — re-enumeration digests are compared against stored manifests.
    async getBase() {
        const data = await this._get(`/open-apis/bitable/v1/apps/${this.baseToken}`);
        const app = data.app || {};
        return {
            title: app.name || app.title || null,
            revision: app.revision_id ?? null,
            timezone: app.timezone ?? null,
        };
    }

    // scanBase()/collectPages() consume PAGE objects ({items, hasMore,
    // pageToken}) — returning a bare array would silently enumerate to zero.

    async listTables() {
        const items = await this._list(`/open-apis/bitable/v1/apps/${this.baseToken}/tables`);
        return page(items.map((item) => ({
            tableId: item.table_id,
            name: item.name || null,
            primaryFieldId: item.primary_field_id ?? null,
        })));
    }

    async listFields({ tableId } = {}) {
        if (!tableId) throw new TypeError('tableId is required');
        const items = await this._list(`/open-apis/bitable/v1/apps/${this.baseToken}/tables/${tableId}/fields`);
        return page(items.map((item) => ({
            fieldId: item.field_id,
            name: item.field_name,
            type: item.type,
            uiType: item.ui_type ?? null,
        })));
    }

    async listViews({ tableId } = {}) {
        if (!tableId) throw new TypeError('tableId is required');
        const items = await this._list(`/open-apis/bitable/v1/apps/${this.baseToken}/tables/${tableId}/views`);
        return page(items.map((item) => ({
            viewId: item.view_id,
            name: item.view_name || null,
            viewType: item.view_type ?? null,
        })));
    }

    async listRecords({ tableId } = {}) {
        if (!tableId) throw new TypeError('tableId is required');
        // Raw items ({record_id, fields}) on purpose: freshness digests bind
        // the raw record set exactly as the Base returns it.
        const items = await this._list(`/open-apis/bitable/v1/apps/${this.baseToken}/tables/${tableId}/records`);
        return page(items);
    }
}

module.exports = {
    FeishuBaseClient,
    createClient: (options = {}) => new FeishuBaseClient(options),
};

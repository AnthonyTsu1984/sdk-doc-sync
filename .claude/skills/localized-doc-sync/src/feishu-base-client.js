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

// Real Feishu fields carry a numeric `type` plus a string `ui_type`; the
// locale policy compares snake_cased strings ('text', 'single_select'), so
// ui_type is normalized and the numeric code is preserved alongside.
function normalizeFieldType(uiType, typeCode) {
    if (typeof uiType === 'string' && uiType) {
        return uiType.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    }
    return `type_${typeCode}`;
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

    async _list(path, { pageToken: startPageToken = null } = {}) {
        const items = [];
        let pageToken = startPageToken;
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

    async listTables({ pageToken } = {}) {
        const items = await this._list(`/open-apis/bitable/v1/apps/${this.baseToken}/tables`, { pageToken });
        return page(items.map((item) => ({
            tableId: item.table_id,
            name: item.name || null,
            primaryFieldId: item.primary_field_id ?? null,
            revision: item.revision ?? null,
        })));
    }

    // Every schema-bearing property is retained: fieldSchemaDigest must
    // distinguish two selects whose options differ, and the schema profiler
    // needs the string type, the options, and the primary flag.
    async listFields({ tableId, pageToken } = {}) {
        if (!tableId) throw new TypeError('tableId is required');
        const items = await this._list(`/open-apis/bitable/v1/apps/${this.baseToken}/tables/${tableId}/fields`, { pageToken });
        return page(items.map((item) => ({
            fieldId: item.field_id,
            name: item.field_name ?? null,
            type: normalizeFieldType(item.ui_type, item.type),
            typeCode: item.type ?? null,
            isPrimary: item.is_primary === true,
            isSynced: item.is_synced === true,
            isExtend: item.is_extend === true,
            options: item.property?.options || [],
            property: item.property || null,
        })));
    }

    // List-views summaries carry no filter configuration; the authoritative
    // filter/sort scope lives in each view's detail, so every view is fetched
    // and bound before viewScopeDigest is computed.
    async listViews({ tableId, pageToken } = {}) {
        if (!tableId) throw new TypeError('tableId is required');
        const items = await this._list(`/open-apis/bitable/v1/apps/${this.baseToken}/tables/${tableId}/views`, { pageToken });
        const views = [];
        for (const item of items) {
            const detail = await this._get(`/open-apis/bitable/v1/apps/${this.baseToken}/tables/${tableId}/views/${item.view_id}`);
            const view = detail.view || {};
            const property = view.property || item.property || null;
            views.push({
                viewId: item.view_id || view.view_id,
                name: view.view_name || item.view_name || null,
                viewType: view.view_type ?? item.view_type ?? null,
                filterInfo: property?.filter_info ?? null,
                sortInfo: property?.sort_info ?? null,
                property,
            });
        }
        return page(views);
    }

    async listRecords({ tableId, pageToken } = {}) {
        if (!tableId) throw new TypeError('tableId is required');
        // Raw items ({record_id, fields}) on purpose: freshness digests bind
        // the raw record set exactly as the Base returns it.
        const items = await this._list(`/open-apis/bitable/v1/apps/${this.baseToken}/tables/${tableId}/records`, { pageToken });
        return page(items);
    }
}

module.exports = {
    FeishuBaseClient,
    createClient: (options = {}) => new FeishuBaseClient(options),
};

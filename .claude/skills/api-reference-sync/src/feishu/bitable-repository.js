'use strict';

class BitableRepositoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BitableRepositoryError';
    this.code = code;
  }
}

class BitableRepository {
  constructor({ client, baseToken, tableId = null }) {
    if (!client || typeof client.paginate !== 'function') {
      throw new TypeError('BitableRepository requires a client with paginate()');
    }
    if (typeof baseToken !== 'string' || baseToken.trim() === '') {
      throw new TypeError('BitableRepository requires a non-empty baseToken');
    }

    this.client = client;
    this.baseToken = baseToken;
    this.tableId = tableId;
  }

  async listRecords() {
    const tableId = await this._resolveTableId();
    const base = encodeURIComponent(this.baseToken);
    const table = encodeURIComponent(tableId);
    const records = await this.client.paginate({
      path: `/open-apis/bitable/v1/apps/${base}/tables/${table}/records?page_size=500`,
    });
    return records.map((record) => this._normalizeRecord(record));
  }

  async _resolveTableId() {
    if (typeof this.tableId === 'string' && this.tableId.trim() !== '') return this.tableId;

    const tables = await this.client.paginate({
      path: `/open-apis/bitable/v1/apps/${encodeURIComponent(this.baseToken)}/tables`,
    });
    if (tables.length !== 1 || typeof tables[0]?.table_id !== 'string' || !tables[0].table_id) {
      throw new BitableRepositoryError(
        'BITABLE_TABLE_SELECTION_REQUIRED',
        `Bitable base ${this.baseToken} requires an explicit tableId; found ${tables.length} tables`,
      );
    }
    this.tableId = tables[0].table_id;
    return this.tableId;
  }

  _normalizeRecord(record) {
    const fields = record?.fields && typeof record.fields === 'object' ? record.fields : {};
    const type = this._text(fields.Type);
    const docs = this._docs(fields.Docs);
    const title = docs.title;
    const link = docs.link;
    const token = this._documentToken(link);

    if (type !== 'VirtualNode' && !token) {
      throw new BitableRepositoryError(
        'BITABLE_DOCS_LINK_INVALID',
        `Bitable document record ${record?.record_id || '(unknown)'} has a missing or malformed Docs link; expected an absolute URL with a /docx/ or /wiki/ document token`,
      );
    }

    return {
      id: record?.record_id || '',
      metadata: {
        title,
        link,
        token: token || '',
        slug: this._slug(fields.Slug),
        type,
        addedSince: this._text(fields['Added Since']),
        lastModified: this._text(fields['Last Modified At']),
        deprecateSince: this._text(fields['Deprecate Since']),
        progress: this._text(fields.Progress),
        targets: this._targets(fields.Targets),
      },
      parent: this._parent(fields['父记录']) || this._parent(fields.Parent),
    };
  }

  _text(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.map((part) => this._text(part)).join('');
    if (typeof value !== 'object') return '';
    for (const key of ['text', 'title', 'name', 'value']) {
      if (Object.hasOwn(value, key)) return this._text(value[key]);
    }
    return '';
  }

  _docs(value) {
    const findLink = (part) => {
      if (Array.isArray(part)) {
        for (const item of part) {
          const link = findLink(item);
          if (link) return link;
        }
        return '';
      }
      if (!part || typeof part !== 'object') return '';
      if (Object.hasOwn(part, 'link')) return this._text(part.link).trim();
      return '';
    };

    return {
      title: this._text(value),
      link: findLink(value),
    };
  }

  _slug(value) {
    return this._text(value);
  }

  _targets(value) {
    const values = Array.isArray(value) ? value : [value];
    return values.map((item) => this._text(item)).filter(Boolean);
  }

  _parent(value) {
    if (!Array.isArray(value) || value.length === 0) return null;
    const first = value[0];
    if (typeof first === 'string') return first || null;
    if (!first || typeof first !== 'object') return null;
    return first.record_ids?.[0] || first.record_id || null;
  }

  _documentToken(link) {
    if (!link) return null;
    try {
      const url = new URL(link);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      // Document identity is encoded in the path; the URL origin is intentionally irrelevant.
      const match = url.pathname.match(/\/(?:docx|wiki)\/([^/]+)\/?$/);
      return match?.[1] || null;
    } catch {
      return null;
    }
  }
}

module.exports = BitableRepository;
module.exports.BitableRepository = BitableRepository;
module.exports.BitableRepositoryError = BitableRepositoryError;

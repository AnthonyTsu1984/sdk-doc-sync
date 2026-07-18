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
    const docs = fields.Docs && typeof fields.Docs === 'object' ? fields.Docs : {};
    const title = this._text(docs.text);
    const link = this._text(docs.link);
    const token = this._documentToken(link);

    if (type && type !== 'VirtualNode' && !token) {
      throw new BitableRepositoryError(
        'BITABLE_DOCS_LINK_INVALID',
        `Bitable document record ${record?.record_id || '(unknown)'} has a missing or malformed Docs link`,
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
    return typeof value === 'string' ? value : String(value);
  }

  _slug(value) {
    if (typeof value === 'string') return value;
    if (!Array.isArray(value)) return '';
    return value.map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      if (typeof part.text === 'string') return part.text;
      if (typeof part[part.type] === 'string') return part[part.type];
      return '';
    }).join('');
  }

  _targets(value) {
    if (Array.isArray(value)) return value.slice();
    if (typeof value === 'string' && value) return [value];
    return [];
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

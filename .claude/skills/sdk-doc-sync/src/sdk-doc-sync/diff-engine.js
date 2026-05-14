/**
 * DiffEngine — compares scanned SDK symbols against an existing bitable index
 * to produce a list of actions (CREATE, UPDATE, DEPRECATE, SKIP, ORPHAN).
 *
 * Designed for version-incremental workflows:
 *   - Previous version bitable is the baseline
 *   - `Added Since` is carried forward for existing symbols
 *   - Only genuinely new symbols get the current sdkVersion
 */

class DiffEngine {
    /**
     * @param {string} sdkVersion
     * @param {Object} categoryMap - Optional slug remapping, e.g. { 'MilvusClient-insert': 'Vector-insert' }
     */
    constructor({ sdkVersion, categoryMap }) {
        this.sdkVersion = sdkVersion;
        this.categoryMap = categoryMap || {};
        // Build case-insensitive lookup for categoryMap
        this._categoryMapLower = {};
        for (const [k, v] of Object.entries(this.categoryMap)) {
            this._categoryMapLower[k.toLowerCase()] = v;
        }
    }

    /**
     * @param {Array} scannedSymbols - from PythonScanner
     * @param {Array} indexedDocs    - bitable records from previous version (or current)
     *   Each doc: { id, metadata: { title, slug, description, type, added_since, ... } }
     * @returns {Array} DiffAction[]
     */
    diff(scannedSymbols, indexedDocs) {
        const actions = [];
        const docsBySlug = new Map();
        const docsBySlugLower = new Map();

        for (const doc of indexedDocs) {
            const slug = doc.metadata.slug;
            if (slug) {
                docsBySlug.set(slug, doc);
                docsBySlugLower.set(slug.toLowerCase(), doc);
            }
        }

        const matchedSlugs = new Set();

        for (const symbol of scannedSymbols) {
            const slug = this._symbolSlug(symbol);
            const doc = docsBySlug.get(slug) || docsBySlugLower.get(slug.toLowerCase());

            if (!doc) {
                actions.push({
                    type: 'CREATE',
                    symbol,
                    slug,
                    doc: null,
                    reason: 'New symbol, no matching document found',
                });
            } else {
                matchedSlugs.add(doc.metadata.slug);
                const isDeprecated = this._isDeprecated(symbol);

                if (isDeprecated && !doc.metadata.deprecate_since) {
                    actions.push({
                        type: 'DEPRECATE',
                        symbol,
                        slug,
                        doc,
                        reason: 'Symbol marked as deprecated in source',
                    });
                } else if (this._hasChanges(symbol, doc)) {
                    actions.push({
                        type: 'UPDATE',
                        symbol,
                        slug,
                        doc,
                        reason: this._describeChanges(symbol, doc),
                    });
                } else {
                    actions.push({
                        type: 'SKIP',
                        symbol,
                        slug,
                        doc,
                        reason: 'No changes detected',
                    });
                }
            }
        }

        // Orphaned docs
        for (const [slug, doc] of docsBySlug) {
            if (!matchedSlugs.has(slug)) {
                actions.push({
                    type: 'ORPHAN',
                    symbol: null,
                    slug,
                    doc,
                    reason: 'Document exists but no matching symbol in source',
                });
            }
        }

        return actions;
    }

    /**
     * Slug format matching real bitable convention:
     *   - Method: `ClassName-method_name`
     *   - Top-level: `symbol_name`
     * Preserves original casing.
     */
    _symbolSlug(symbol) {
        const rawSlug = symbol.parentClass
            ? `${symbol.parentClass}-${symbol.name}`
            : symbol.name;
        return this.categoryMap[rawSlug] || this._categoryMapLower[rawSlug.toLowerCase()] || rawSlug;
    }

    _isDeprecated(symbol) {
        if (symbol.decorators && symbol.decorators.some(d => d.toLowerCase().includes('deprecated'))) {
            return true;
        }
        // Only check the first line of the docstring (method-level description),
        // not parameter docs which may mention "deprecated" for individual params
        if (symbol.docstring) {
            const firstLine = symbol.docstring.split('\n')[0].trim();
            if (/\bdeprecated\b/i.test(firstLine)) return true;
        }
        return false;
    }

    _hasChanges(symbol, doc) {
        const symbolDesc = symbol.docstring ? symbol.docstring.split('\n')[0].trim() : '';
        const docDesc = doc.metadata.description || '';
        if (symbolDesc && docDesc && symbolDesc !== docDesc) return true;
        return false;
    }

    _describeChanges(symbol, doc) {
        const changes = [];
        const symbolDesc = symbol.docstring ? symbol.docstring.split('\n')[0].trim() : '';
        const docDesc = doc.metadata.description || '';
        if (symbolDesc && docDesc && symbolDesc !== docDesc) {
            changes.push('description changed');
        }
        return changes.join(', ') || 'content changed';
    }
}

module.exports = DiffEngine;

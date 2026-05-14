/**
 * TranslationDiff - Compare source and target bitable records to identify translation work
 */
class TranslationDiff {
    /**
     * @param {Object} options
     * @param {boolean} options.strict - Use strict matching (exact slug match)
     */
    constructor({ strict = true } = {}) {
        this.strict = strict;
    }

    /**
     * Compare source and target records to produce diff actions
     * @param {Array} sourceRecords - Records from source bitable
     * @param {Array} targetRecords - Records from target bitable
     * @returns {Array} Array of diff actions
     */
    diff(sourceRecords, targetRecords) {
        const actions = [];
        const targetBySlug = new Map();
        const targetBySlugLower = new Map();

        // Index target records by slug
        for (const record of targetRecords) {
            const slug = record.metadata.slug;
            if (slug) {
                targetBySlug.set(slug, record);
                targetBySlugLower.set(slug.toLowerCase(), record);
            }
        }

        const matchedSlugs = new Set();

        // Compare each source record
        for (const sourceRecord of sourceRecords) {
            const slug = sourceRecord.metadata.slug;

            // Skip VirtualNodes and non-document types
            if (sourceRecord.metadata.type === 'VirtualNode' ||
                sourceRecord.metadata.type === 'Module' ||
                !sourceRecord.metadata.link) {
                actions.push({
                    type: 'SKIP',
                    source: sourceRecord,
                    target: null,
                    slug,
                    reason: 'Non-document type or VirtualNode',
                });
                continue;
            }

            const targetRecord = this.strict
                ? targetBySlug.get(slug)
                : (targetBySlug.get(slug) || targetBySlugLower.get(slug.toLowerCase()));

            if (!targetRecord) {
                // New document - needs translation
                actions.push({
                    type: 'NEW',
                    source: sourceRecord,
                    target: null,
                    slug,
                    reason: 'Document exists in source but not in target',
                });
            } else {
                matchedSlugs.add(targetRecord.metadata.slug);

                if (this._hasChanges(sourceRecord, targetRecord)) {
                    // Existing document has changes - needs update
                    actions.push({
                        type: 'UPDATE',
                        source: sourceRecord,
                        target: targetRecord,
                        slug,
                        reason: this._describeChanges(sourceRecord, targetRecord),
                    });
                } else {
                    // No changes - skip
                    actions.push({
                        type: 'SKIP',
                        source: sourceRecord,
                        target: targetRecord,
                        slug,
                        reason: 'No changes detected',
                    });
                }
            }
        }

        // Find orphaned target documents
        for (const [slug, targetRecord] of targetBySlug) {
            if (!matchedSlugs.has(slug)) {
                actions.push({
                    type: 'ORPHAN',
                    source: null,
                    target: targetRecord,
                    slug,
                    reason: 'Document exists in target but not in source',
                });
            }
        }

        return actions;
    }

    /**
     * Check if source has changes compared to target
     * @private
     */
    _hasChanges(sourceRecord, targetRecord) {
        const sourceModified = sourceRecord.metadata.last_modified || '';
        const targetModified = targetRecord.metadata.last_modified || '';

        // If source was modified more recently, it has changes
        if (sourceModified && targetModified && sourceModified > targetModified) {
            return true;
        }

        // If source has last_modified but target doesn't, consider it changed
        if (sourceModified && !targetModified) {
            return true;
        }

        // Check if source has deprecation info that target doesn't
        const sourceDeprecated = sourceRecord.metadata.deprecate_since || '';
        const targetDeprecated = targetRecord.metadata.deprecate_since || '';

        if (sourceDeprecated && !targetDeprecated) {
            return true;
        }

        return false;
    }

    /**
     * Describe what changed between source and target
     * @private
     */
    _describeChanges(sourceRecord, targetRecord) {
        const reasons = [];

        const sourceModified = sourceRecord.metadata.last_modified || '';
        const targetModified = targetRecord.metadata.last_modified || '';

        if (sourceModified > targetModified) {
            reasons.push(`source modified at ${sourceModified}, target at ${targetModified || 'unknown'}`);
        }

        const sourceDeprecated = sourceRecord.metadata.deprecate_since || '';
        const targetDeprecated = targetRecord.metadata.deprecate_since || '';

        if (sourceDeprecated && !targetDeprecated) {
            reasons.push(`source deprecated since ${sourceDeprecated}`);
        }

        return reasons.length > 0 ? reasons.join('; ') : 'Content may have changed';
    }

    /**
     * Get summary statistics from diff actions
     */
    getSummary(actions) {
        const summary = {
            total: actions.length,
            new: 0,
            update: 0,
            skip: 0,
            orphan: 0,
        };

        for (const action of actions) {
            const type = action.type.toLowerCase();
            if (summary.hasOwnProperty(type)) {
                summary[type]++;
            }
        }

        return summary;
    }

    /**
     * Filter actions by type
     */
    filterByType(actions, ...types) {
        const typeSet = new Set(types.map(t => t.toUpperCase()));
        return actions.filter(action => typeSet.has(action.type));
    }
}

module.exports = TranslationDiff;

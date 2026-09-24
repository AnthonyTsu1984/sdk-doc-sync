'use strict';

// Identity-coverage reconciliation: the identity map must resolve every
// governed record slug in the track's Bitable, otherwise the record is
// invisible to tag-delta scans and PR intakes (changes to it can never be
// surfaced). The June 2026 onboarding left 51 KB pages unrepresented this
// way; this module turns that drift into a standing diagnostic instead of a
// manual audit.
//
// Detect-only by design: it never mutates the identity map. The generator
// (see bin/identity-reconcile.js --emit-draft) produces evidence-backed entry
// drafts from the same records; merging a draft into the map stays a
// human-reviewed, master-compared edit.

const DIAGNOSTIC_CODE = 'IDENTITY_MAP_INCOMPLETE';

function nonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}

function recordSlug(record) {
    if (!record || typeof record !== 'object') return '';
    const raw = record.slug != null ? record.slug : record.fields?.Slug;
    if (nonEmptyString(raw)) return raw;
    if (Array.isArray(raw)) return raw.map((part) => part?.text || '').join('|').trim();
    if (raw && typeof raw === 'object') return String(raw.text || '').trim();
    return '';
}

function recordType(record) {
    if (!record || typeof record !== 'object') return '';
    const raw = record.type != null ? record.type : record.fields?.Type;
    if (nonEmptyString(raw)) return raw;
    if (Array.isArray(raw)) return raw.map((part) => part?.text || '').join('|').trim();
    if (raw && typeof raw === 'object') return String(raw.text || '').trim();
    return '';
}

// Canonical identity key for a governed record slug: the first dash separates
// the category from the interface name (method names carry no dashes).
function identityKeyForSlug(slug) {
    const dash = slug.indexOf('-');
    if (dash <= 0 || dash === slug.length - 1) return null;
    return `${slug.slice(0, dash)}.${slug.slice(dash + 1)}`;
}

function reconcileIdentityCoverage({ records, identityMap } = {}) {
    const rows = Array.isArray(records) ? records : [];
    const symbols = identityMap?.symbols && typeof identityMap.symbols === 'object' ? identityMap.symbols : {};
    const slugs = new Set();
    for (const record of rows) {
        const slug = recordSlug(record);
        if (!nonEmptyString(slug)) continue;
        if (recordType(record) === 'VirtualNode') continue; // folder records carry bare category slugs
        if (!slug.includes('-')) continue;
        slugs.add(slug);
    }

    const missing = [...slugs]
        .filter((slug) => {
            const key = identityKeyForSlug(slug);
            return key !== null && !symbols[key];
        })
        .sort();

    const representedKeys = new Set([...slugs].map(identityKeyForSlug).filter(Boolean));
    const extras = Object.keys(symbols)
        .filter((key) => {
            const slug = key.replace('.', '-');
            return !representedKeys.has(key) && !slugs.has(slug);
        })
        .sort();

    const diagnostics = missing.length > 0
        ? [{
            level: 'warn',
            code: DIAGNOSTIC_CODE,
            message: `${missing.length} governed record slug(s) resolve to no canonical identity in the identity map and are invisible to scans: ${missing.join(', ')}.`,
            slugs: [...missing],
        }]
        : [];

    return {
        checked: slugs.size,
        missing,
        extras,
        diagnostics,
    };
}

// Evidence-backed identity-map entry drafts for the missing slugs. Each draft
// is derived from an existing governed record; merging stays a manual,
// master-compared map edit.
function identityEntryDrafts({ records, missing }) {
    const bySlug = new Map();
    for (const record of Array.isArray(records) ? records : []) {
        const slug = recordSlug(record);
        if (!nonEmptyString(slug)) continue;
        bySlug.set(slug, record);
    }
    const entries = [];
    const evidence = [];
    for (const slug of Array.isArray(missing) ? missing : []) {
        const key = identityKeyForSlug(slug);
        if (key === null || bySlug.has(key) || !bySlug.has(slug)) continue;
        const record = bySlug.get(slug);
        const dash = slug.indexOf('-');
        const category = slug.slice(0, dash);
        const name = slug.slice(dash + 1);
        const docLink = record.fields?.Docs?.link || record.docLink || null;
        entries.push({
            key,
            entry: {
                stableId: `cpp:${category}:${name}`,
                canonicalSlug: slug,
                category,
            },
        });
        evidence.push({
            slug,
            recordId: record.recordId || record.record_id || null,
            docLink: docLink || null,
            progress: record.progress ?? record.fields?.Progress ?? null,
        });
    }
    return { entries, evidence };
}

module.exports = {
    IDENTITY_MAP_INCOMPLETE: DIAGNOSTIC_CODE,
    reconcileIdentityCoverage,
    identityEntryDrafts,
};

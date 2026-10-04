'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const SdkDocSync = require('../src/sdk-doc-sync');

// Unit-level coverage for the write-approval preview gate (§3.7): the
// presentation refuses to build for content that fails the five rules,
// including verbatim-rebuild artifacts that carry no artifact.layout.

function presentationImpl(language) {
    const impl = Object.create(SdkDocSync.prototype);
    impl.language = language;
    impl.docxLink = () => null;
    impl.recordLink = async () => null;
    return impl;
}

function plannedEntry(artifact) {
    return {
        action: { slug: 'Vector-delete' },
        plan: { stableId: 'java:Vector:delete', action: 'CREATE', source: {} },
        context: { artifact },
    };
}

const COMPLIANT_WITH_CALLOUT = [
    'This operation deletes entities from a collection.',
    '<Admonition icon="📘">',
    'Notes',
    'Deprecated in v3.0.x. Use deleteAsync() to delete entities.',
    '</Admonition>',
    '**PARAMETERS:**',
    '- **collectionName** (*String*) - The name of the target collection.',
    '**RETURN TYPE:**',
    'void',
].join('\n');

test('a compliant preview with a governed deprecation callout passes the gate (Admonition interior exempt)', async () => {
    const entries = await presentationImpl('java')._buildWriteApprovalPresentation([
        plannedEntry({ title: 'delete()', content: COMPLIANT_WITH_CALLOUT, layout: { profileId: 'java', profileVersion: 3 } }),
    ]);
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].contentPreflight, { ok: true, violations: [] });
});

test('a non-compliant preview refuses the presentation with the typed code', async () => {
    await assert.rejects(
        presentationImpl('java')._buildWriteApprovalPresentation([
            plannedEntry({
                title: 'delete()',
                content: 'Deletes entities from a collection.\nNotes\n',
                layout: { profileId: 'java', profileVersion: 3 },
            }),
        ]),
        (error) => error.code === 'PREVIEW_CONTENT_PREFLIGHT_FAILED'
            && /FIRST_SENTENCE_REGISTER/.test(error.message)
            && /INTERNAL_NOTE_LEAK/.test(error.message),
    );
});

test('verbatim-rebuild artifacts without artifact.layout still run the gate via the run language', async () => {
    // The verbatim branch of the artifact provider returns no layout — the
    // 2026-10-03 ruling does not exempt verbatim pages, so the profile must
    // fall back to the run's language.
    await assert.rejects(
        presentationImpl('java')._buildWriteApprovalPresentation([
            plannedEntry({ title: 'delete()', content: 'This operation deletes entities.\n**RETURNS:**\nA single sentence.' }),
        ]),
        (error) => error.code === 'PREVIEW_CONTENT_PREFLIGHT_FAILED' && /RETURNS_MIN_DEPTH/.test(error.message),
    );
    const clean = await presentationImpl('java')._buildWriteApprovalPresentation([
        plannedEntry({ title: 'delete()', content: COMPLIANT_WITH_CALLOUT }),
    ]);
    assert.deepEqual(clean[0].contentPreflight, { ok: true, violations: [] });
});

test('rest/zilliz-cli runs have no layout profile and skip the gate unchanged', async () => {
    const entries = await presentationImpl('zilliz-cli')._buildWriteApprovalPresentation([
        plannedEntry({ title: 'project create', content: 'Creates a Zilliz Cloud project.' }),
    ]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].contentPreflight, null);
});

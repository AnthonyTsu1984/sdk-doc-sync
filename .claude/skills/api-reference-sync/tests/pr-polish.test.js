'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
    INVARIANT_ID,
    assertPolishPreconditions,
    validatePolishManifest,
    applyPolishManifest,
    comparePolishedContent,
    verifyPolishChain,
} = require('../src/sdk-doc-sync/pr-polish');
const { verbatimContentDigest } = require('../src/sdk-doc-sync/verbatim-content');

const BASE = [
    '## Description',
    '',
    'This method grants a role to a user. It is used by automation pipelines.',
    'The call accepts the `with_role()` helper option.',
    '',
    '**REQUEST METHODS:**',
    '',
    '| method | description |',
    '| --- | --- |',
    '| `grant_role(request)` | grants the role |',
    '',
    '```python',
    'client.grant_role(user="a")',
    '```',
    '',
    '<include target="zilliz">Zilliz docs [z-url]</include><include target="milvus">Milvus docs [m-url]</include>',
    '',
    'See the [guide](https://example.com/docs/grant) for details.',
    '',
    '<!-- category: milvus-sdk-cpp; action: update; addedSince: v3.0.x -->',
].join('\n');

const PROSE = 'This method grants a role to a user. It is used by automation pipelines.';
const PASSING_FIDELITY = { invariantId: 'api.pr-verbatim-content', ok: true, contentDigest: verbatimContentDigest(BASE) };

function manifestWith(edits, { baseContent = BASE, schemaVersion = 1 } = {}) {
    return {
        schemaVersion,
        unit: 'unit-1',
        baseContentDigest: verbatimContentDigest(baseContent),
        edits,
    };
}

function firstErrorCode(manifest, baseContent = BASE) {
    try {
        const { errors } = validatePolishManifest({ manifest, baseContent });
        return errors.length > 0 ? errors[0].code : null;
    } catch (error) {
        return error.code;
    }
}

test('assertPolishPreconditions is fail-closed without a passing verbatim outcome', () => {
    assert.throws(
        () => assertPolishPreconditions({ contentFidelity: null }),
        (error) => error.code === 'PR_POLISH_VERBATIM_NOT_PROVEN',
    );
    assert.throws(
        () => assertPolishPreconditions({ contentFidelity: { invariantId: 'api.pr-verbatim-content', ok: false } }),
        (error) => error.code === 'PR_POLISH_VERBATIM_NOT_PROVEN',
    );
    assert.throws(
        () => assertPolishPreconditions({ contentFidelity: { invariantId: 'other.invariant', ok: true, contentDigest: PASSING_FIDELITY.contentDigest } }),
        (error) => error.code === 'PR_POLISH_VERBATIM_NOT_PROVEN',
    );
    // A passing outcome that carries no compared digest is not a proof.
    assert.throws(
        () => assertPolishPreconditions({ contentFidelity: { invariantId: 'api.pr-verbatim-content', ok: true } }),
        (error) => error.code === 'PR_POLISH_VERBATIM_NOT_PROVEN',
    );
    assert.equal(assertPolishPreconditions({ contentFidelity: PASSING_FIDELITY }), true);
    assert.equal(assertPolishPreconditions({ contentFidelity: PASSING_FIDELITY, baseContent: BASE }), true);
    // A proof for OTHER bytes does not unlock polish for these bytes.
    assert.throws(
        () => assertPolishPreconditions({ contentFidelity: PASSING_FIDELITY, baseContent: `${BASE}\ndifferent bytes` }),
        (error) => error.code === 'PR_POLISH_VERBATIM_NOT_PROVEN',
    );
});

test('a valid manifest applies deterministically and records the digest chain', () => {
    const manifest = manifestWith([
        { anchor: PROSE, replacement: 'Grants a role to a user. Intended for automation.' },
        { anchor: 'See the [guide](https://example.com/docs/grant) for details.', replacement: 'See the [guide](https://example.com/docs/grant).' },
    ]);
    const first = applyPolishManifest({ manifest, baseContent: BASE });
    const second = applyPolishManifest({ manifest, baseContent: BASE });
    assert.equal(first.polishedContent, second.polishedContent);
    assert.ok(first.polishedContent.includes('Intended for automation.'));
    // Everything protected is byte-identical.
    for (const untouched of [
        'client.grant_role(user="a")',
        '| `grant_role(request)` | grants the role |',
        '<include target="zilliz">Zilliz docs [z-url]</include>',
        '**REQUEST METHODS:**',
        '<!-- category: milvus-sdk-cpp; action: update; addedSince: v3.0.x -->',
    ]) {
        assert.ok(first.polishedContent.includes(untouched), `polish must not alter: ${untouched}`);
    }
    assert.equal(first.provenance.invariantId, INVARIANT_ID);
    assert.equal(first.provenance.baseContentDigest, manifest.baseContentDigest);
    assert.equal(first.provenance.polishedContentDigest, verbatimContentDigest(first.polishedContent));
    assert.equal(first.provenance.editCount, 2);
    // Applying the same manifest to the polished output is a base-digest
    // mismatch: polish chains are single-hop against the verified bytes.
    assert.throws(
        () => applyPolishManifest({ manifest, baseContent: first.polishedContent }),
        (error) => error.code === 'PR_POLISH_BASE_DIGEST_MISMATCH',
    );
});

test('manifest shape violations are typed', () => {
    assert.equal(firstErrorCode({ ...manifestWith([]), edits: [] }), 'PR_POLISH_MANIFEST_INVALID');
    assert.equal(firstErrorCode(manifestWith([{ anchor: '', replacement: 'x' }])), 'PR_POLISH_MANIFEST_INVALID');
    assert.equal(firstErrorCode({ ...manifestWith([{ anchor: 'a', replacement: 'b' }]), schemaVersion: 2 }), 'PR_POLISH_MANIFEST_INVALID');
    assert.equal(firstErrorCode(manifestWith([{ anchor: 'no such anchor anywhere', replacement: 'x' }])), 'PR_POLISH_ANCHOR_NOT_FOUND');
});

test('a manifest bound to different bytes is rejected', () => {
    const stale = manifestWith([{ anchor: PROSE, replacement: 'Reworded.' }]);
    assert.equal(firstErrorCode(stale, `${BASE}\nextra`), 'PR_POLISH_BASE_DIGEST_MISMATCH');
});

test('protected regions refuse anchors and structure-introducing replacements', () => {
    const protectedAnchors = [
        'client.grant_role(user="a")',                      // fenced code
        'grants the role',                                   // table row
        '## Description',                                    // heading
        'Zilliz docs [z-url]',                               // include marker line
        'addedSince: v3.0.x',                                // metadata footer
        '**REQUEST METHODS:**',                              // request-methods marker
    ];
    for (const anchor of protectedAnchors) {
        assert.equal(
            firstErrorCode(manifestWith([{ anchor, replacement: 'x' }])),
            'PR_POLISH_PROTECTED_REGION',
            `anchor must be protected: ${anchor}`,
        );
    }
    assert.equal(
        firstErrorCode(manifestWith([{ anchor: PROSE, replacement: 'Grants a role.\n| a | b |' }])),
        'PR_POLISH_FORBIDDEN_INTRODUCTION',
    );
    assert.equal(
        firstErrorCode(manifestWith([{ anchor: PROSE, replacement: 'Grants a role.\n```python' }])),
        'PR_POLISH_FORBIDDEN_INTRODUCTION',
    );
});

test('inline code spans and absolute link URLs must survive an edit', () => {
    assert.equal(
        firstErrorCode(manifestWith([
            { anchor: 'The call accepts the `with_role()` helper option.', replacement: 'Accepts the helper option.' },
        ])),
        'PR_POLISH_CODE_SPAN_CHANGED',
    );
    assert.equal(
        firstErrorCode(manifestWith([
            { anchor: 'See the [guide](https://example.com/docs/grant) for details.', replacement: 'See the [guide](https://other.example.com/x) for details.' },
        ])),
        'PR_POLISH_URL_SET_CHANGED',
    );
    // Rewording the link TEXT while keeping the URL target is sanctioned.
    const ok = applyPolishManifest({
        manifest: manifestWith([
            { anchor: 'See the [guide](https://example.com/docs/grant) for details.', replacement: 'See the [documentation](https://example.com/docs/grant).' },
        ]),
        baseContent: BASE,
    });
    assert.ok(ok.polishedContent.includes('[documentation](https://example.com/docs/grant)'));
});

test('anchors must be unique, non-overlapping, and never cover the body', () => {
    const duplicated = `${BASE}\n${PROSE}`;
    assert.equal(
        firstErrorCode(manifestWith([{ anchor: PROSE, replacement: 'x' }], { baseContent: duplicated }), duplicated),
        'PR_POLISH_ANCHOR_NOT_UNIQUE',
    );
    assert.equal(
        firstErrorCode(manifestWith([
            { anchor: PROSE, replacement: 'A.' },
            { anchor: 'This method grants a role to a user.', replacement: 'B.' },
        ])),
        'PR_POLISH_EDIT_OVERLAP',
    );
    const proseHeavy = ['## Notes', '', 'Alpha prose line that a polish subagent may reword freely.', 'Bravo prose line that a polish subagent may reword freely.', 'Charlie prose line that a polish subagent may reword freely.', 'Delta prose line that a polish subagent may reword freely.', 'Echo prose line that a polish subagent may reword freely.', 'Foxtrot prose line that a polish subagent may reword freely.'].join('\n');
    assert.equal(
        firstErrorCode(manifestWith(
            proseHeavy.split('\n').slice(2).map((line) => ({ anchor: line, replacement: 'Reworded.' })),
            { baseContent: proseHeavy },
        ), proseHeavy),
        'PR_POLISH_FULL_REWRITE',
    );
});

test('splice-boundary and partial-overlap exploits are rejected (review round 1 regressions)', () => {
    // Partial anchor starting INSIDE a code span: unbalanced backticks would
    // compare as "no code spans changed" on the bare substrings — the
    // affected-region comparison must catch the rewritten identifier.
    const codeBase = 'Call this with the `grant_role(request)` helper to proceed.\n';
    const codeManifest = {
        schemaVersion: 1,
        unit: 'u',
        baseContentDigest: verbatimContentDigest(codeBase),
        edits: [{ anchor: 'grant_role(request)` helper to proceed.', replacement: 'EVIL_CALL()` helper to proceed.' }],
    };
    assert.equal(firstErrorCode(codeManifest, codeBase), 'PR_POLISH_CODE_SPAN_CHANGED');

    // Partial anchor starting inside a link URL: the URL smuggle must fail
    // even though terminal canonicalization strips URLs entirely.
    const urlBase = 'See the [guide](https://example.com/docs/grant) for details.\n';
    const urlManifest = {
        schemaVersion: 1,
        unit: 'u',
        baseContentDigest: verbatimContentDigest(urlBase),
        edits: [{ anchor: 'See the [guide](https://example.com/docs/gr', replacement: 'See the [guide](https://evil.example.com/at' }],
    };
    assert.equal(firstErrorCode(urlManifest, urlBase), 'PR_POLISH_URL_SET_CHANGED');

    // URL REORDER inside one edited region is not sanctioned polish.
    const reorderBase = [
        'This method grants a role to a user. It is used by automation pipelines.',
        'See [alpha](https://example.com/a) then [beta](https://example.com/b).',
        'The granted role takes effect on the next session.',
        'Automation pipelines should verify the grant before proceeding further.',
        'Role grants are idempotent and safe to replay from a clean state.',
    ].join('\n');
    const reorderManifest = {
        schemaVersion: 1,
        unit: 'u',
        baseContentDigest: verbatimContentDigest(reorderBase),
        edits: [{ anchor: 'See [alpha](https://example.com/a) then [beta](https://example.com/b).', replacement: 'See [beta](https://example.com/b) then [alpha](https://example.com/a).' }],
    };
    assert.equal(firstErrorCode(reorderManifest, reorderBase), 'PR_POLISH_URL_SET_CHANGED');

    // Splice-boundary fence forging: a one-backtick prefix plus a
    // two-backtick replacement must not concatenate into a fence delimiter.
    const fenceBase = '`quoted` text that a polish pass may reword freely.\n';
    const fenceManifest = {
        schemaVersion: 1,
        unit: 'u',
        baseContentDigest: verbatimContentDigest(fenceBase),
        edits: [{ anchor: 'quoted', replacement: '``x' }],
    };
    assert.equal(firstErrorCode(fenceManifest, fenceBase), 'PR_POLISH_FORBIDDEN_INTRODUCTION');

    // A replacement may not introduce a REQUEST METHODS marker either.
    const requestBase = 'This method grants a role to a user. It is used by automation pipelines.\n';
    const requestManifest = {
        schemaVersion: 1,
        unit: 'u',
        baseContentDigest: verbatimContentDigest(requestBase),
        edits: [{ anchor: 'This method grants a role to a user. It is used by automation pipelines.', replacement: 'Grants a role.\n**REQUEST METHODS:**' }],
    };
    assert.equal(firstErrorCode(requestManifest, requestBase), 'PR_POLISH_FORBIDDEN_INTRODUCTION');

    // Unbounded expansion: a small anchor replaced by megabytes of new prose
    // is a rewrite wearing a polish anchor — the tripwire counts the larger
    // side of each edit.
    const expandManifest = {
        schemaVersion: 1,
        unit: 'u',
        baseContentDigest: verbatimContentDigest(requestBase),
        edits: [{ anchor: 'This method grants a role to a user. It is used by automation pipelines.', replacement: `Injected prose. ${'x'.repeat(5000)}` }],
    };
    assert.equal(firstErrorCode(expandManifest, requestBase), 'PR_POLISH_FULL_REWRITE');
});

test('junction composition of individually-clean edits is rejected (review round 2 regressions)', () => {
    const applyErrorCode = (manifest, baseContent) => {
        try {
            applyPolishManifest({ manifest, baseContent });
            return null;
        } catch (error) {
            return error.code;
        }
    };
    const manifestOver = (baseContent, edits) => ({
        schemaVersion: 1,
        unit: 'u',
        baseContentDigest: verbatimContentDigest(baseContent),
        edits,
    });
    // Each junction puts the two anchors on ONE line so the forbidden shape
    // only exists in the COMPOSED splice — neither per-edit candidate ever
    // contains it. Padding lines keep footprints far under the tripwire.
    const padding = [
        'A plain prose line so the page is not trivially small at all.',
        'Another plain prose line keeps the footprint under the tripwire.',
        'A third plain prose line rounds the body out for the pass.',
        'A fourth plain prose line completes the realistic page body.',
    ];

    // J1: edit1 ends its replacement with a newline and edit2 (on the
    // adjacent anchor) starts a fence run — the composed second line is a
    // fence delimiter.
    const fenceBase = ['Alpha opens AnchorOneBetaTwo and closes the line with prose.', ...padding].join('\n');
    assert.equal(
        applyErrorCode(manifestOver(fenceBase, [
            { anchor: 'AnchorOne', replacement: 'X\n' },
            { anchor: 'BetaTwo', replacement: ' ```evil' },
        ]), fenceBase),
        'PR_POLISH_FORBIDDEN_INTRODUCTION',
    );

    // J2: two replacements on adjacent anchors compose a complete
    // <include ...> marker.
    const includeBase = ['Gamma opens AnchorOneBetaTwo and finishes ordinary prose.', ...padding].join('\n');
    assert.equal(
        applyErrorCode(manifestOver(includeBase, [
            { anchor: 'AnchorOne', replacement: 'Zed <include' },
            { anchor: 'BetaTwo', replacement: ' target="zilliz">x</include>' },
        ]), includeBase),
        'PR_POLISH_FORBIDDEN_INTRODUCTION',
    );

    // J3: two replacements on adjacent anchors compose a complete absolute
    // link URL.
    const urlBase = ['Delta opens AnchorOneBetaTwo and ends the prose.', ...padding].join('\n');
    assert.equal(
        applyErrorCode(manifestOver(urlBase, [
            { anchor: 'AnchorOne', replacement: 'see [d](http' },
            { anchor: 'BetaTwo', replacement: 's://evil.example.com/y) now' },
        ]), urlBase),
        'PR_POLISH_URL_SET_CHANGED',
    );

    // No false positive: adjacent legitimate edits that touch neighboring
    // phrases on the same line still compose cleanly.
    const adjacent = applyPolishManifest({
        manifest: manifestOver(fenceBase, [
            { anchor: 'Alpha opens AnchorOne', replacement: 'Reworded opening' },
            { anchor: 'and closes the line with prose.', replacement: 'and closes the sentence with prose.' },
        ]),
        baseContent: fenceBase,
    });
    assert.ok(adjacent.polishedContent.includes('Reworded opening'));
    assert.ok(adjacent.polishedContent.includes('closes the sentence with prose.'));
});

test('comparePolishedContent proves the landed page against the recomputed terminal bytes', () => {
    const { polishedContent } = applyPolishManifest({
        manifest: manifestWith([{ anchor: PROSE, replacement: 'Grants a role to a user.' }]),
        baseContent: BASE,
    });
    const rawLanded = [
        'GrantRole()',
        '',
        'Description',
        '',
        'Grants a role to a user.',
        '',
        'The call accepts the with_role() helper option.',
        '',
        'REQUEST METHODS:',
        '',
        '| method | description |',
        '| --- | --- |',
        '| grant_role(request) | grants the role |',
        '',
        'client.grant_role(user="a")',
        '',
        '<include target="zilliz">Zilliz docs [z-url]</include><include target="milvus">Milvus docs [m-url]</include>',
        '',
        'See the guide for details.',
        '',
    ].join('\n');
    const landed = comparePolishedContent({ polishedContent, rawContent: rawLanded });
    assert.equal(landed.ok, true, JSON.stringify(landed.diffs));
    assert.equal(landed.invariantId, INVARIANT_ID);
    const drifted = comparePolishedContent({ polishedContent, rawContent: rawLanded.replace('Grants a role to a user.', 'Grants a role.') });
    assert.equal(drifted.ok, false);
});

test('verifyPolishChain re-derives the terminal bytes and rejects tampered records', () => {
    const manifest = manifestWith([{ anchor: PROSE, replacement: 'Grants a role to a user.' }]);
    const { polishedContent } = applyPolishManifest({ manifest, baseContent: BASE });
    const chain = verifyPolishChain({ content: BASE, polish: { manifest, polishedContent } });
    assert.equal(chain.ok, true);
    assert.equal(chain.provenance.polishedContentDigest, verbatimContentDigest(polishedContent));
    assert.equal(verifyPolishChain({ content: BASE, polish: { manifest, polishedContent: `${polishedContent} tampered` } }).ok, false);
    assert.equal(verifyPolishChain({ content: BASE, polish: null }).ok, false);
});

test('the CLI validates, emits terminal bytes + provenance, and verifies a refetch', () => {
    const skillRoot = path.resolve(__dirname, '..');
    const repoRoot = path.resolve(skillRoot, '..', '..', '..');
    const cli = path.join(skillRoot, 'bin', 'pr-polish.js');
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-polish-cli-'));
    const baseFile = path.join(temp, 'base.md');
    const fidelityFile = path.join(temp, 'fidelity.json');
    const manifestFile = path.join(temp, 'manifest.json');
    const polishedFile = path.join(temp, 'polished.md');
    const provenanceFile = path.join(temp, 'provenance.json');
    const rawFile = path.join(temp, 'raw.txt');

    const manifest = manifestWith([{ anchor: PROSE, replacement: 'Grants a role to a user.' }]);
    const { polishedContent } = applyPolishManifest({ manifest, baseContent: BASE });
    fs.writeFileSync(baseFile, BASE);
    fs.writeFileSync(fidelityFile, JSON.stringify(PASSING_FIDELITY));
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    fs.writeFileSync(rawFile, [
        'GrantRole()',
        '',
        'Description',
        '',
        'Grants a role to a user.',
        '',
        'The call accepts the with_role() helper option.',
        '',
        'REQUEST METHODS:',
        '',
        '| method | description |',
        '| --- | --- |',
        '| grant_role(request) | grants the role |',
        '',
        'client.grant_role(user="a")',
        '',
        '<include target="zilliz">Zilliz docs [z-url]</include><include target="milvus">Milvus docs [m-url]</include>',
        '',
        'See the guide for details.',
        '',
    ].join('\n'));

    const run = (extra) => spawnSync(process.execPath, [
        cli,
        '--base-content', baseFile,
        '--fidelity-outcome', fidelityFile,
        '--manifest', manifestFile,
        '--polished-output', polishedFile,
        '--provenance-output', provenanceFile,
        ...(extra || []),
    ], { cwd: repoRoot, encoding: 'utf8' });

    const verified = run(['--verify-raw-content', rawFile]);
    assert.equal(verified.status, 0, verified.stderr);
    assert.equal(fs.readFileSync(polishedFile, 'utf8'), polishedContent);
    const provenance = JSON.parse(fs.readFileSync(provenanceFile, 'utf8'));
    assert.equal(provenance.invariantId, INVARIANT_ID);
    assert.equal(provenance.polishedContentDigest, verbatimContentDigest(polishedContent));
    assert.match(verified.stdout, /"verified": ?true/);

    // Divergent refetch fails typed; a failed verbatim precondition fails closed.
    fs.writeFileSync(rawFile, 'GrantRole()\n\nDescription\n\nSomething else entirely.\n');
    const diverged = run(['--verify-raw-content', rawFile]);
    assert.equal(diverged.status, 1);
    assert.match(diverged.stderr, /PR_POLISH_CONTENT_VERIFICATION_FAILED/);

    fs.writeFileSync(fidelityFile, JSON.stringify({ invariantId: 'api.pr-verbatim-content', ok: false, contentDigest: PASSING_FIDELITY.contentDigest }));
    const unproven = run();
    assert.equal(unproven.status, 1);
    assert.match(unproven.stderr, /PR_POLISH_VERBATIM_NOT_PROVEN/);
});

test('restructure manifests are refused on the prose path and validated on their own', () => {
    const {
        validateRestructureManifest,
        applyRestructureManifest,
    } = require('../src/sdk-doc-sync/pr-polish');
    const { compareSemanticContent } = require('../src/sdk-doc-sync/semantic-content-map');

    const base = [
        '```Java',
        'public GetResp get(GetReq request)',
        '```',
        '',
        '**RETURN TYPE:**',
        '',
        '*GetResp*',
        '',
        '**RETURNS:**',
        '',
        'A **GetResp** object representing one or more queried entities.',
        '',
        '<include target="zilliz">Z docs [z]</include><include target="milvus">M docs [m]</include>',
    ].join('\n');
    const table = [
        '**RESPONSE SHAPE:**',
        '',
        '| field | type | description |',
        '| --- | --- | --- |',
        '| getResults | List<QueryResp.QueryResult> | A list of results. |',
    ].join('\n');
    const canonical = base.replace(
        'A **GetResp** object representing one or more queried entities.',
        `A **GetResp** object representing one or more queried entities.\n\n${table}`,
    );
    const manifestFor = (overrides = {}) => ({
        schemaVersion: 1,
        mode: 'restructure',
        unit: 'java-v30-vector-get',
        baseContentDigest: verbatimContentDigest(base),
        replacementContent: canonical,
        sources: [{ tableHeader: 'field | type | description', path: 'QueryResp.java', lines: '37-42' }],
        ...overrides,
    });
    const errorCode = (overrides) => {
        try {
            const { errors } = validateRestructureManifest({ manifest: manifestFor(overrides), baseContent: base });
            return errors.length > 0 ? errors[0].code : null;
        } catch (error) {
            return error.code;
        }
    };

    // Prose path refuses the restructure mode outright.
    assert.throws(
        () => validatePolishManifest({ manifest: manifestFor({ edits: [{ anchor: 'a', replacement: 'b' }] }), baseContent: base }),
        (error) => error.code === 'PR_POLISH_MODE_INVALID',
    );

    assert.equal(errorCode({ baseContentDigest: verbatimContentDigest(`${base}\nother`) }), 'PR_POLISH_BASE_DIGEST_MISMATCH');
    assert.equal(
        errorCode({ replacementContent: base.replace('A **GetResp** object representing one or more queried entities.\n\n', '') }),
        'PR_POLISH_SEMANTIC_CONTENT_LOST',
        'losing the RETURNS prose is a semantic failure',
    );
    assert.equal(errorCode({ sources: [] }), 'PR_POLISH_SOURCE_CITATION_REQUIRED');
    assert.equal(
        errorCode({ sources: [{ tableHeader: 'name | type', path: 'x.java', lines: '1-2' }] }),
        'PR_POLISH_SOURCE_TABLE_UNBOUND',
    );

    const applied = applyRestructureManifest({ manifest: manifestFor(), baseContent: base });
    assert.equal(applied.polishedContent, canonical);
    assert.equal(applied.provenance.mode, 'restructure');
    assert.equal(applied.provenance.baseContentDigest, verbatimContentDigest(base));
    assert.equal(applied.provenance.polishedContentDigest, verbatimContentDigest(canonical));
    assert.ok(applied.provenance.sourcesDigest.length > 0);

    const comparison = compareSemanticContent({ upstreamContent: base, canonicalContent: applied.polishedContent });
    assert.equal(comparison.ok, true, JSON.stringify(comparison.diffs));

    const chain = verifyPolishChain({ content: base, polish: { manifest: manifestFor(), polishedContent: applied.polishedContent } });
    assert.equal(chain.ok, true, JSON.stringify(chain.errors || chain));
    const tampered = verifyPolishChain({ content: base, polish: { manifest: manifestFor(), polishedContent: `${applied.polishedContent}x` } });
    assert.equal(tampered.ok, false);
});

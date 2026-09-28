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
const PASSING_FIDELITY = { invariantId: 'api.pr-verbatim-content', ok: true };

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
        () => assertPolishPreconditions({ contentFidelity: { invariantId: 'other.invariant', ok: true } }),
        (error) => error.code === 'PR_POLISH_VERBATIM_NOT_PROVEN',
    );
    assert.equal(assertPolishPreconditions({ contentFidelity: PASSING_FIDELITY }), true);
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

    fs.writeFileSync(fidelityFile, JSON.stringify({ invariantId: 'api.pr-verbatim-content', ok: false }));
    const unproven = run();
    assert.equal(unproven.status, 1);
    assert.match(unproven.stderr, /PR_POLISH_VERBATIM_NOT_PROVEN/);
});

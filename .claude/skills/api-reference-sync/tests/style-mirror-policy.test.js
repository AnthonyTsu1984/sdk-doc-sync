'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    STYLE_MIRROR_INVARIANT_ID,
    loadStyleMirrorAllowlist,
    checkStyleMirrors,
    defaultAllowlistPath,
} = require('../src/sdk-doc-sync/style-mirror-policy');

function writeAllowlist(config) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'style-mirror-allowlist-'));
    const file = path.join(temp, 'style-mirror-allowlist.json');
    fs.writeFileSync(file, JSON.stringify(config));
    return file;
}

function validAllowlist(overrides = {}) {
    return {
        schemaVersion: 1,
        languages: {
            java: { allowlist: ['describeReplicas'], notes: '' },
            cpp: { allowlist: [], notes: '' },
            python: { allowlist: [], notes: '' },
            node: { allowlist: [], notes: '' },
            go: { allowlist: [], notes: '' },
        },
        ...overrides,
    };
}

test('the shipped config loads and java carries the describeReplicas exemplar', () => {
    const config = loadStyleMirrorAllowlist(defaultAllowlistPath());
    assert.equal(config.schemaVersion, 1);
    assert.deepEqual(config.languages.java.allowlist, ['describeReplicas']);
});

test('malformed allowlist configs all fail closed with STYLE_MIRROR_ALLOWLIST_MALFORMED', () => {
    const cases = [
        validAllowlist({ schemaVersion: 2 }),
        validAllowlist({ languages: null }),
        validAllowlist({
            languages: {
                java: { allowlist: ['describeReplicas'] },
                // four languages missing — absence is malformed, not implicit empty
            },
        }),
        (() => {
            const config = validAllowlist();
            config.languages.cpp = { allowlist: ['ok', 'ok'] }; // duplicate
            return config;
        })(),
        (() => {
            const config = validAllowlist();
            config.languages.go = { allowlist: [''] }; // empty entry
            return config;
        })(),
        (() => {
            const config = validAllowlist();
            config.languages.node = { allowlist: 'describeReplicas' }; // not an array
            return config;
        })(),
    ];
    for (const config of cases) {
        const file = writeAllowlist(config);
        assert.throws(
            () => loadStyleMirrorAllowlist(file),
            (error) => error.code === 'STYLE_MIRROR_ALLOWLIST_MALFORMED',
            JSON.stringify(config).slice(0, 120),
        );
    }
    // Unreadable file fails the same way
    assert.throws(
        () => loadStyleMirrorAllowlist(path.join(os.tmpdir(), 'definitely-missing-allowlist.json')),
        (error) => error.code === 'STYLE_MIRROR_ALLOWLIST_MALFORMED',
    );
});

test('checkStyleMirrors judges declarations against the language allowlist', () => {
    const allowlist = validAllowlist();

    const allowed = checkStyleMirrors({ language: 'java', styleMirrors: ['describeReplicas'], allowlist });
    assert.deepEqual(allowed.violations, []);

    const refused = checkStyleMirrors({ language: 'java', styleMirrors: ['describeReplicas', 'compact'], allowlist });
    assert.equal(refused.violations.length, 1);
    assert.equal(refused.violations[0].code, 'STYLE_MIRROR_SOURCE_NOT_ALLOWLISTED');
    assert.equal(refused.violations[0].source, 'compact');
    assert.match(refused.violations[0].detail, /operator decision/);

    // Language partition: an exemplar of one language does not leak into another
    const crossTrack = checkStyleMirrors({ language: 'go', styleMirrors: ['describeReplicas'], allowlist });
    assert.equal(crossTrack.violations.length, 1);
    assert.equal(crossTrack.violations[0].code, 'STYLE_MIRROR_SOURCE_NOT_ALLOWLISTED');

    // Shape violations
    const wrongType = checkStyleMirrors({ language: 'java', styleMirrors: 'describeReplicas', allowlist });
    assert.equal(wrongType.violations[0].code, 'STYLE_MIRROR_ENTRY_INVALID');
    const emptyEntry = checkStyleMirrors({ language: 'java', styleMirrors: [42], allowlist });
    assert.equal(emptyEntry.violations[0].code, 'STYLE_MIRROR_ENTRY_INVALID');

    // Absence and empty are both clean — declaring no mirror is the default
    assert.deepEqual(checkStyleMirrors({ language: 'java', styleMirrors: undefined, allowlist }).violations, []);
    assert.deepEqual(checkStyleMirrors({ language: 'java', styleMirrors: [], allowlist }).violations, []);
});

test('the policy carries the invariant id for registry binding', () => {
    assert.equal(STYLE_MIRROR_INVARIANT_ID, 'api.style-mirror-allowlist');
});

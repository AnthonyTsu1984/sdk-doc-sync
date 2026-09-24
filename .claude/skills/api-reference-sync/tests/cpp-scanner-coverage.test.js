'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CppScanner = require('../src/sdk-doc-sync/scanners/cpp-scanner');

function writeFixture(methods) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpp-scanner-coverage-'));
    const includeDir = path.join(root, 'src', 'include', 'milvus');
    fs.mkdirSync(includeDir, { recursive: true });
    const declarations = methods
        .map((name) => `    virtual Status\n    ${name}() = 0;`)
        .join('\n');
    fs.writeFileSync(path.join(includeDir, 'MilvusClientV2.h'), [
        '#pragma once',
        'class MilvusClientV2 {',
        ' public:',
        declarations,
        '};',
        '',
    ].join('\n'));
    return root;
}

test('CppScanner reports a coverage warning when a public method is missing from METHOD_CATEGORIES', async () => {
    const root = writeFixture(['CreateCollection', 'SomeBrandNewMethod']);
    const scanner = new CppScanner({ rootDir: root, publicOnly: true });
    const symbols = await scanner.scan();

    const names = symbols.filter((symbol) => symbol.kind === 'method').map((symbol) => symbol.name);
    // The uncategorized method must NOT become a symbol — it is invisible to
    // downstream scans, which is exactly what the coverage diagnostic flags.
    assert.deepEqual(names, ['CreateCollection']);
    assert.equal(scanner.lastScanDiagnostics.length, 1);
    assert.equal(scanner.lastScanDiagnostics[0].code, 'COVERAGE_UNTRACKED_METHODS');
    assert.equal(scanner.lastScanDiagnostics[0].level, 'warn');
    assert.deepEqual(scanner.lastScanDiagnostics[0].methods, ['SomeBrandNewMethod']);
});

test('CppScanner emits no coverage diagnostics when METHOD_CATEGORIES covers the header', async () => {
    const root = writeFixture(['CreateCollection', 'ListFileResources']);
    const scanner = new CppScanner({ rootDir: root, publicOnly: true });
    await scanner.scan();

    assert.deepEqual(scanner.lastScanDiagnostics, []);
});

test('FileResources methods are categorized for the cpp track', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'sdk-doc-sync', 'scanners', 'cpp-scanner.js'),
        'utf8',
    );
    const map = source.match(/METHOD_CATEGORIES\s*=\s*\{([\s\S]*?)\n\};/)[1];
    const known = new Set([...map.matchAll(/^\s*([A-Za-z0-9]+):\s*'/gm)].map((match) => match[1]));
    for (const name of ['AddFileResource', 'ListFileResources', 'RemoveFileResource']) {
        assert.equal(known.has(name), true, `${name} must be categorized`);
    }
});

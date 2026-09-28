'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const JavaScanner = require('../src/sdk-doc-sync/scanners/java-scanner');

function writeJavaFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'java-scanner-categories-'));
    const clientDir = path.join(root, 'sdk-core', 'src', 'main', 'java', 'io', 'milvus', 'v2', 'client');
    const reqDir = path.join(root, 'sdk-core', 'src', 'main', 'java', 'io', 'milvus', 'v2', 'service', 'vector', 'request');
    const commonDir = path.join(root, 'sdk-core', 'src', 'main', 'java', 'io', 'milvus', 'v2', 'common');
    fs.mkdirSync(clientDir, { recursive: true });
    fs.mkdirSync(reqDir, { recursive: true });
    fs.mkdirSync(commonDir, { recursive: true });

    fs.writeFileSync(path.join(clientDir, 'MilvusClientV2.java'), [
        'package io.milvus.v2.client;',
        '',
        'public class MilvusClientV2 {',
        '    public io.milvus.v2.service.vector.response.QueryResp query(io.milvus.v2.service.vector.request.QueryReq request) {',
        '        return null;',
        '    }',
        '    public void loadCollection(io.milvus.v2.service.collection.request.LoadCollectionReq request) {',
        '    }',
        '    public void brandNewUncategorized(io.milvus.v2.service.vector.request.QueryReq request) {',
        '    }',
        '',
        '    public static final class Builder {',
        '        public Builder brandNewUncategorized(java.lang.String value) { return this; }',
        '    }',
        '}',
        '',
    ].join('\n'));

    fs.writeFileSync(path.join(reqDir, 'QueryReq.java'), [
        'package io.milvus.v2.service.vector.request;',
        '',
        'public class QueryReq {',
        '    private String collectionName;',
        '    private io.milvus.v2.common.DataType enumDefaultField;',
        '',
        '    public static final class Builder {',
        '        public Builder collectionName(String collectionName) { return this; }',
        '        public Builder addStructField(String name) { return this; }',
        '        public QueryReq build() { return new QueryReq(); }',
        '    }',
        '}',
        '',
    ].join('\n'));

    fs.writeFileSync(path.join(reqDir, 'LoadCollectionReq.java'), [
        'package io.milvus.v2.service.collection.request;',
        '',
        'public class LoadCollectionReq {',
        '    private String collectionName;',
        '',
        '    public static final class Builder {',
        '        public Builder collectionName(String collectionName) { return this; }',
        '        public LoadCollectionReq build() { return new LoadCollectionReq(); }',
        '    }',
        '}',
        '',
    ].join('\n'));

    fs.writeFileSync(path.join(commonDir, 'FunctionType.java'), [
        'package io.milvus.v2.common;',
        '',
        'public enum FunctionType {',
        '    UNKNOWN,',
        '    BM25,',
        '}',
        '',
    ].join('\n'));

    return root;
}

test('JavaScanner attaches documentation categories to client methods and typed enums', async () => {
    const scanner = new JavaScanner({ rootDir: writeJavaFixture(), publicOnly: true });
    const symbols = await scanner.scan();

    const query = symbols.find((symbol) => symbol.name === 'query' && symbol.parentClass === 'MilvusClientV2');
    assert.ok(query, 'query symbol present');
    assert.equal(query.category, 'Vector');
    // The sdk-java.md exception: LoadCollectionReq documents under Management.
    const loadCollection = symbols.find((symbol) => symbol.name === 'loadCollection');
    assert.equal(loadCollection.category, 'Management');
    const functionType = symbols.find((symbol) => symbol.name === 'FunctionType');
    assert.equal(functionType.category, 'Function');
});

test('JavaScanner reports uncategorized public client methods through the coverage diagnostic', async () => {
    const scanner = new JavaScanner({ rootDir: writeJavaFixture(), publicOnly: true });
    await scanner.scan();

    assert.equal(scanner.lastScanDiagnostics.length, 1);
    assert.equal(scanner.lastScanDiagnostics[0].code, 'COVERAGE_UNTRACKED_METHODS');
    assert.equal(scanner.lastScanDiagnostics[0].level, 'warn');
    assert.deepEqual(scanner.lastScanDiagnostics[0].methods, ['brandNewUncategorized']);
});

test('JavaScanner unions outer-class fields (dotted types) with nested Builder methods as params', async () => {
    const scanner = new JavaScanner({ rootDir: writeJavaFixture(), publicOnly: true });
    const symbols = await scanner.scan();

    const query = symbols.find((symbol) => symbol.name === 'query' && symbol.parentClass === 'MilvusClientV2');
    const names = query.params.map((param) => param.name);
    assert.ok(names.includes('collectionName'), 'plain field extracted');
    assert.ok(names.includes('enumDefaultField'), 'dotted-type field extracted');
    assert.ok(names.includes('addStructField'), 'nested Builder method extracted');
    assert.ok(!names.includes('build'), 'build() excluded');
    const deduped = new Set(names);
    assert.equal(deduped.size, names.length, 'params deduped by name');
});

test('every categorized MilvusClientV2 method maps to one category', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'sdk-doc-sync', 'scanners', 'java-scanner.js'),
        'utf8',
    );
    const map = source.match(/MILVUS_CLIENT_METHOD_CATEGORIES = \{([\s\S]*?)\n\};/)[1];
    const entries = [...map.matchAll(/([A-Za-z0-9_]+):\s*'([^']+)'/g)];
    assert.ok(entries.length >= 140, `expected a full method table, found ${entries.length}`);
    const categories = new Set(entries.map((entry) => entry[2]));
    for (const category of ['Authentication', 'CDC', 'Client', 'Collections', 'Database', 'FileResources', 'Management', 'Partitions', 'ResourceGroup', 'Snapshots', 'Vector']) {
        assert.ok(categories.has(category), `${category} covered`);
    }
    // sdk-java.md category exceptions must be encoded, not the request-class default.
    const byName = new Map(entries.map((entry) => [entry[1], entry[2]]));
    assert.equal(byName.get('loadCollection'), 'Management');
    assert.equal(byName.get('releaseCollection'), 'Management');
    assert.equal(byName.get('describeReplicas'), 'Collections');
    assert.equal(byName.get('updatePassword'), 'Authentication');
});

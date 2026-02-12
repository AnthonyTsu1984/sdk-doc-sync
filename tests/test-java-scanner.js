const fs = require('fs');
const path = require('path');
const JavaScanner = require('../src/sdk-doc-sync/scanners/java-scanner');

const SAMPLE_DIR = path.join(__dirname, '__fixtures__', 'java-sample');

function setup() {
    // Create directory structure matching real SDK layout
    const clientDir = path.join(SAMPLE_DIR, 'v2', 'client');
    const reqDir = path.join(SAMPLE_DIR, 'v2', 'service', 'collection', 'request');
    const reqDir2 = path.join(SAMPLE_DIR, 'v2', 'service', 'vector', 'request');
    const testDir = path.join(SAMPLE_DIR, 'test', 'java');

    fs.mkdirSync(clientDir, { recursive: true });
    fs.mkdirSync(reqDir, { recursive: true });
    fs.mkdirSync(reqDir2, { recursive: true });
    fs.mkdirSync(testDir, { recursive: true });

    // MilvusClientV2.java with various method types
    fs.writeFileSync(path.join(clientDir, 'MilvusClientV2.java'), `
package io.milvus.v2.client;

import io.milvus.v2.service.collection.request.CreateCollectionReq;
import io.milvus.v2.service.vector.request.InsertReq;

public class MilvusClientV2 {

    public MilvusClientV2(ConnectConfig config) {
        // constructor — should be skipped
    }

    public void createCollection(CreateCollectionReq request) {
        // creates a collection
    }

    @Deprecated
    public void dropCollection(DropCollectionReq request) {
        // drops a collection
    }

    /**
     * Insert data into a collection.
     */
    public InsertResp insert(InsertReq request) {
        // inserts data
    }

    public String getServerVersion() {
        // no Req parameter
        return "2.3.0";
    }

    public void setCollectionName(String name) {
        // Lombok setter — should be filtered out
    }

    private void internalMethod() {
        // should not appear
    }
}
`);

    // CreateCollectionReq.java with builder fields
    fs.writeFileSync(path.join(reqDir, 'CreateCollectionReq.java'), `
package io.milvus.v2.service.collection.request;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class CreateCollectionReq {
    private static final long serialVersionUID = 1L;
    private String collectionName;
    private Integer dimension;
    private Boolean autoID = Boolean.FALSE;
    private String description = "";
    private List<IndexParam> indexParams;
}
`);

    // InsertReq.java with builder fields
    fs.writeFileSync(path.join(reqDir2, 'InsertReq.java'), `
package io.milvus.v2.service.vector.request;

@Data
@Builder
public class InsertReq {
    private String collectionName;
    private String partitionName;
    private List<JsonObject> data;
}
`);

    // Test file — should be excluded
    fs.writeFileSync(path.join(testDir, 'MilvusClientV2Test.java'), `
public class MilvusClientV2Test {
    public void testCreateCollection() {}
}
`);
}

function teardown() {
    fs.rmSync(SAMPLE_DIR, { recursive: true, force: true });
}

function assert(condition, message) {
    if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function testBasicScan() {
    console.log('  Test: basic scan discovers methods');

    const scanner = new JavaScanner({ rootDir: SAMPLE_DIR, publicOnly: true });
    const symbols = await scanner.scan();

    const names = symbols.map(s => s.name);
    console.log(`    Found ${symbols.length} symbols: ${names.join(', ')}`);

    assert(symbols.length === 4, `Expected 4 symbols, got ${symbols.length}`);
    assert(symbols.some(s => s.name === 'createCollection'), 'Should find createCollection');
    assert(symbols.some(s => s.name === 'dropCollection'), 'Should find dropCollection');
    assert(symbols.some(s => s.name === 'insert'), 'Should find insert');
    assert(symbols.some(s => s.name === 'getServerVersion'), 'Should find getServerVersion');

    // Should NOT find constructor, private method, or setter
    assert(!symbols.some(s => s.name === 'MilvusClientV2'), 'Should not find constructor');
    assert(!symbols.some(s => s.name === 'internalMethod'), 'Should not find private method');
    assert(!symbols.some(s => s.name === 'setCollectionName'), 'Should not find setter method');

    console.log('    PASS\n');
}

async function testReturnTypes() {
    console.log('  Test: return types extracted correctly');

    const scanner = new JavaScanner({ rootDir: SAMPLE_DIR, publicOnly: true });
    const symbols = await scanner.scan();

    const create = symbols.find(s => s.name === 'createCollection');
    assert(create.returnType === 'void', `createCollection returnType: ${create.returnType}`);

    const insert = symbols.find(s => s.name === 'insert');
    assert(insert.returnType === 'InsertResp', `insert returnType: ${insert.returnType}`);

    const version = symbols.find(s => s.name === 'getServerVersion');
    assert(version.returnType === 'String', `getServerVersion returnType: ${version.returnType}`);

    console.log('    PASS\n');
}

async function testRequestClass() {
    console.log('  Test: requestClass populated for Req methods');

    const scanner = new JavaScanner({ rootDir: SAMPLE_DIR, publicOnly: true });
    const symbols = await scanner.scan();

    const create = symbols.find(s => s.name === 'createCollection');
    assert(create.requestClass === 'CreateCollectionReq', `createCollection requestClass: ${create.requestClass}`);

    const insert = symbols.find(s => s.name === 'insert');
    assert(insert.requestClass === 'InsertReq', `insert requestClass: ${insert.requestClass}`);

    const version = symbols.find(s => s.name === 'getServerVersion');
    assert(version.requestClass === null, `getServerVersion requestClass should be null: ${version.requestClass}`);

    console.log('    PASS\n');
}

async function testBuilderFields() {
    console.log('  Test: builder fields extracted from Req classes');

    const scanner = new JavaScanner({ rootDir: SAMPLE_DIR, publicOnly: true });
    const symbols = await scanner.scan();

    const create = symbols.find(s => s.name === 'createCollection');
    console.log(`    createCollection params: ${create.params.map(p => p.name).join(', ')}`);

    // Should have 5 fields (serialVersionUID excluded)
    assert(create.params.length === 5, `Expected 5 params, got ${create.params.length}`);
    assert(create.params[0].name === 'collectionName', `First field: ${create.params[0].name}`);
    assert(create.params[0].type === 'String', `First field type: ${create.params[0].type}`);
    assert(create.params[0].default === null, `First field default: ${create.params[0].default}`);
    assert(create.params[0].kind === 'keyword', `First field kind: ${create.params[0].kind}`);

    const autoID = create.params.find(p => p.name === 'autoID');
    assert(autoID.type === 'Boolean', `autoID type: ${autoID.type}`);
    assert(autoID.default === 'Boolean.FALSE', `autoID default: ${autoID.default}`);

    const desc = create.params.find(p => p.name === 'description');
    assert(desc.default === '""', `description default: ${desc.default}`);

    // InsertReq fields
    const insert = symbols.find(s => s.name === 'insert');
    assert(insert.params.length === 3, `insert params count: ${insert.params.length}`);

    // No Req → no params
    const version = symbols.find(s => s.name === 'getServerVersion');
    assert(version.params.length === 0, `getServerVersion params should be empty: ${version.params.length}`);

    console.log('    PASS\n');
}

async function testDeprecatedDetection() {
    console.log('  Test: @Deprecated annotation detected');

    const scanner = new JavaScanner({ rootDir: SAMPLE_DIR, publicOnly: true });
    const symbols = await scanner.scan();

    const drop = symbols.find(s => s.name === 'dropCollection');
    assert(drop.decorators.length === 1, `dropCollection decorators count: ${drop.decorators.length}`);
    assert(drop.decorators[0] === '@Deprecated', `dropCollection decorator: ${drop.decorators[0]}`);

    const create = symbols.find(s => s.name === 'createCollection');
    assert(create.decorators.length === 0, `createCollection should have no decorators: ${create.decorators.length}`);

    console.log('    PASS\n');
}

async function testSetterFiltered() {
    console.log('  Test: setter methods are filtered out');

    const scanner = new JavaScanner({ rootDir: SAMPLE_DIR, publicOnly: true });
    const symbols = await scanner.scan();

    const names = symbols.map(s => s.name);
    assert(!names.includes('setCollectionName'), 'setCollectionName should be filtered');

    // Verify _isSetterMethod directly
    assert(scanner._isSetterMethod('setName') === true, 'setName is a setter');
    assert(scanner._isSetterMethod('setFields') === true, 'setFields is a setter');
    assert(scanner._isSetterMethod('setup') === false, 'setup is not a setter');
    assert(scanner._isSetterMethod('getServerVersion') === false, 'getServerVersion is not a setter');
    assert(scanner._isSetterMethod('settings') === false, 'settings is not a setter');

    console.log('    PASS\n');
}

async function testSymbolSchema() {
    console.log('  Test: symbol schema has all required fields');

    const scanner = new JavaScanner({ rootDir: SAMPLE_DIR, publicOnly: true });
    const symbols = await scanner.scan();

    const sym = symbols[0];
    const requiredFields = ['name', 'kind', 'signature', 'docstring', 'params', 'filePath', 'lineNumber', 'parentClass', 'decorators', 'returnType', 'baseClasses', 'requestClass'];
    for (const field of requiredFields) {
        assert(field in sym, `Missing field: ${field}`);
    }
    assert(sym.kind === 'method', `kind should be method: ${sym.kind}`);
    assert(sym.parentClass === 'MilvusClientV2', `parentClass: ${sym.parentClass}`);
    assert(Array.isArray(sym.baseClasses), 'baseClasses should be array');

    console.log('    PASS\n');
}

async function run() {
    console.log('Java Scanner Tests\n');

    setup();
    try {
        await testBasicScan();
        await testReturnTypes();
        await testRequestClass();
        await testBuilderFields();
        await testDeprecatedDetection();
        await testSetterFiltered();
        await testSymbolSchema();
        console.log('All Java Scanner tests passed!');
    } finally {
        teardown();
    }
}

run().catch(err => {
    teardown();
    console.error('FAIL:', err.message);
    process.exit(1);
});

const DocGenerator = require('../src/sdk-doc-sync/doc-generator');

function assert(condition, message) {
    if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function testGenerateMeta() {
    console.log('  Test: generateMeta');

    const gen = new DocGenerator({ sdkName: 'pymilvus', sdkVersion: 'v2.6.x', targets: ['Milvus', 'Zilliz'] });

    const classMeta = gen.generateMeta({
        name: 'MilvusClient',
        kind: 'class',
        docstring: 'The main client for interacting with Milvus.',
        parentClass: null,
        baseClasses: ['BaseClient'],
    });

    assert(classMeta.title === 'MilvusClient', `Class title: ${classMeta.title}`);
    assert(classMeta.slug === 'MilvusClient', `Class slug preserves casing: ${classMeta.slug}`);
    assert(classMeta.type === 'Class', `Bitable type: ${classMeta.type}`);
    assert(classMeta.addedSince === 'v2.6.x', `addedSince: ${classMeta.addedSince}`);
    assert(JSON.stringify(classMeta.targets) === '["Milvus","Zilliz"]', `targets: ${JSON.stringify(classMeta.targets)}`);
    assert(classMeta.progress === 'Draft', `progress: ${classMeta.progress}`);

    const methodMeta = gen.generateMeta({
        name: 'insert',
        kind: 'method',
        docstring: 'Insert data into a collection.\n\nMore details here.',
        parentClass: 'MilvusClient',
        baseClasses: [],
    });

    assert(methodMeta.title === 'insert()', `Method title: ${methodMeta.title}`);
    assert(methodMeta.slug === 'MilvusClient-insert', `Method slug: ${methodMeta.slug}`);
    assert(methodMeta.type === 'Function', `Method bitable type: ${methodMeta.type}`);
    assert(methodMeta.description === 'Insert data into a collection.', `First line only: ${methodMeta.description}`);

    const enumMeta = gen.generateMeta({
        name: 'DataType',
        kind: 'enum',
        docstring: 'Supported data types.',
        parentClass: null,
        baseClasses: ['Enum'],
    });

    assert(enumMeta.title === 'DataType', `Enum title: ${enumMeta.title}`);
    assert(enumMeta.type === 'Enum', `Enum bitable type: ${enumMeta.type}`);

    console.log('    PASS\n');
}

function testGenerateMetaWithParent() {
    console.log('  Test: generateMeta with parentRecordId');

    const gen = new DocGenerator({ sdkName: 'pymilvus', sdkVersion: 'v2.6.x' });

    const meta = gen.generateMeta(
        { name: 'insert', kind: 'method', docstring: 'Insert data.', parentClass: 'MilvusClient', baseClasses: [] },
        { parentRecordId: 'rec123' }
    );

    assert(meta.parentRecordId === 'rec123', `parentRecordId: ${meta.parentRecordId}`);

    console.log('    PASS\n');
}

function testFunctionScaffold() {
    console.log('  Test: function scaffold matches real doc structure');

    const gen = new DocGenerator({ sdkName: 'pymilvus', sdkVersion: 'v2.6.x' });

    const md = gen.generate({
        name: 'insert',
        kind: 'method',
        signature: 'def insert(self, collection_name: str, data: list, partition_name: str = None) -> dict:',
        docstring: 'Insert data into a collection.',
        params: [
            { name: 'collection_name', kind: 'positional', type: 'str', default: null },
            { name: 'data', kind: 'positional', type: 'list', default: null },
            { name: 'partition_name', kind: 'keyword', type: 'str', default: 'None' },
        ],
        filePath: 'pymilvus/client.py',
        lineNumber: 20,
        parentClass: 'MilvusClient',
        decorators: [],
        returnType: 'dict',
        baseClasses: [],
    });

    // Real doc structure checks
    assert(md.includes('Insert data into a collection.'), 'Should have description');
    assert(md.includes('## Request Syntax'), 'Should have Request Syntax heading');
    assert(md.includes('```python'), 'Should have python code block');
    assert(md.includes('**PARAMETERS:**'), 'Should have PARAMETERS section');
    assert(md.includes('**collection_name** (str)'), 'Should have param with type');
    assert(md.includes('[REQUIRED]'), 'Should mark required params');
    assert(md.includes('**RETURN TYPE:**'), 'Should have RETURN TYPE section');
    assert(md.includes('dict'), 'Should have return type value');
    assert(md.includes('**EXCEPTIONS:**'), 'Should have EXCEPTIONS section');
    assert(md.includes('## Examples'), 'Should have Examples heading');
    assert(md.includes('<!-- TODO:'), 'Should have TODO placeholders for Claude');

    console.log('    PASS\n');
}

function testClassScaffold() {
    console.log('  Test: class scaffold');

    const gen = new DocGenerator({ sdkName: 'pymilvus', sdkVersion: 'v2.6.x' });

    const md = gen.generate({
        name: 'MilvusClient',
        kind: 'class',
        signature: 'class MilvusClient(BaseClient):',
        docstring: 'Main Milvus client.',
        params: [],
        filePath: 'pymilvus/client.py',
        lineNumber: 10,
        parentClass: null,
        decorators: [],
        returnType: null,
        baseClasses: ['BaseClient'],
    });

    assert(md.includes('Main Milvus client.'), 'Should have description');
    assert(md.includes('## Constructor'), 'Should have Constructor section');
    assert(md.includes('class MilvusClient(BaseClient):'), 'Should have signature');
    assert(md.includes('**Inherits from:** BaseClient'), 'Should have base classes');
    assert(md.includes('## Methods'), 'Should have Methods section');
    assert(md.includes('## Examples'), 'Should have Examples section');

    console.log('    PASS\n');
}

function testEnumScaffold() {
    console.log('  Test: enum scaffold');

    const gen = new DocGenerator({ sdkName: 'pymilvus', sdkVersion: 'v2.6.x' });

    const md = gen.generate({
        name: 'DataType',
        kind: 'enum',
        signature: 'class DataType(Enum):',
        docstring: 'Data types supported by Milvus.',
        params: [],
        filePath: 'pymilvus/enums.py',
        lineNumber: 5,
        parentClass: null,
        decorators: [],
        returnType: null,
        baseClasses: ['Enum'],
    });

    assert(md.includes('Data types supported by Milvus.'), 'Should have description');
    assert(md.includes('## Values'), 'Should have Values section');
    assert(md.includes('## Examples'), 'Should have Examples section');

    console.log('    PASS\n');
}

function testJavaFunctionScaffold() {
    console.log('  Test: Java function scaffold matches Feishu doc layout');

    const gen = new DocGenerator({ sdkName: 'milvus-sdk-java', sdkVersion: 'v2.5.x', language: 'java' });

    const md = gen.generate({
        name: 'createCollection',
        kind: 'method',
        signature: 'public void createCollection(CreateCollectionReq request)',
        docstring: null,
        params: [
            { name: 'collectionName', kind: 'keyword', type: 'String', default: null },
            { name: 'dimension', kind: 'keyword', type: 'Integer', default: 'null' },
            { name: 'autoID', kind: 'keyword', type: 'Boolean', default: 'Boolean.FALSE' },
        ],
        filePath: 'io/milvus/v2/client/MilvusClientV2.java',
        lineNumber: 42,
        parentClass: 'MilvusClientV2',
        decorators: [],
        returnType: 'void',
        baseClasses: [],
        requestClass: 'CreateCollectionReq',
    });

    // Java-specific structure checks
    assert(md.includes('```java'), 'Should have java code block');
    assert(md.includes('public void createCollection(CreateCollectionReq request)'), 'Should have method signature');
    assert(md.includes('## Request Syntax{#request-syntax}'), 'Should have Request Syntax with anchor');
    assert(md.includes('**BUILDER METHODS:**'), 'Should have BUILDER METHODS section');
    assert(md.includes('`collectionName(String collectionName)`'), 'Should have builder method with backtick code');
    assert(md.includes('`dimension(Integer dimension)`'), 'Should have dimension builder method');
    assert(md.includes('**RETURNS:**'), 'Should have RETURNS section');
    assert(md.includes('*void*'), 'Should have italic return type');
    assert(md.includes('**EXCEPTIONS:**'), 'Should have EXCEPTIONS section');
    assert(md.includes('**MilvusClientExceptions**'), 'Should have default exception');
    assert(md.includes('## Example{#example}'), 'Should have Example with anchor');
    assert(md.includes('CreateCollectionReq.builder()'), 'Should have builder pattern in request syntax');

    // Should NOT have Python-specific elements
    assert(!md.includes('**PARAMETERS:**'), 'Should NOT have PARAMETERS section');
    assert(!md.includes('**RETURN TYPE:**'), 'Should NOT have RETURN TYPE section');
    assert(!md.includes('```python'), 'Should NOT have python code block');
    assert(!md.includes('[REQUIRED]'), 'Should NOT have REQUIRED tags');

    console.log('    PASS\n');
}

function testJavaNoReqScaffold() {
    console.log('  Test: Java scaffold for method with no request class');

    const gen = new DocGenerator({ sdkName: 'milvus-sdk-java', sdkVersion: 'v2.5.x', language: 'java' });

    const md = gen.generate({
        name: 'getServerVersion',
        kind: 'method',
        signature: 'public String getServerVersion()',
        docstring: null,
        params: [],
        filePath: 'io/milvus/v2/client/MilvusClientV2.java',
        lineNumber: 100,
        parentClass: 'MilvusClientV2',
        decorators: [],
        returnType: 'String',
        baseClasses: [],
        requestClass: null,
    });

    // Should have signature and returns
    assert(md.includes('```java'), 'Should have java code block');
    assert(md.includes('**RETURNS:**'), 'Should have RETURNS');
    assert(md.includes('*String*'), 'Should have String return type');

    // Should NOT have builder sections
    assert(!md.includes('## Request Syntax'), 'Should NOT have Request Syntax');
    assert(!md.includes('**BUILDER METHODS:**'), 'Should NOT have BUILDER METHODS');

    console.log('    PASS\n');
}

function testPythonScaffoldUnchanged() {
    console.log('  Test: Python scaffold unchanged (regression)');

    const gen = new DocGenerator({ sdkName: 'pymilvus', sdkVersion: 'v2.6.x', language: 'python' });

    const md = gen.generate({
        name: 'insert',
        kind: 'method',
        signature: 'def insert(self, collection_name: str, data: list) -> dict:',
        docstring: 'Insert data.',
        params: [
            { name: 'collection_name', kind: 'positional', type: 'str', default: null },
            { name: 'data', kind: 'positional', type: 'list', default: null },
        ],
        filePath: 'pymilvus/client.py',
        lineNumber: 20,
        parentClass: 'MilvusClient',
        decorators: [],
        returnType: 'dict',
        baseClasses: [],
    });

    assert(md.includes('**PARAMETERS:**'), 'Python should have PARAMETERS');
    assert(md.includes('**RETURN TYPE:**'), 'Python should have RETURN TYPE');
    assert(md.includes('```python'), 'Python should have python code block');
    assert(md.includes('[REQUIRED]'), 'Python should have REQUIRED tags');
    assert(!md.includes('**BUILDER METHODS:**'), 'Python should NOT have BUILDER METHODS');
    assert(!md.includes('**RETURNS:**'), 'Python should NOT have RETURNS');

    console.log('    PASS\n');
}

function testDefaultLanguagePython() {
    console.log('  Test: default language is python');

    const gen = new DocGenerator({ sdkName: 'pymilvus', sdkVersion: 'v2.6.x' });

    const md = gen.generate({
        name: 'test',
        kind: 'method',
        signature: 'def test(self):',
        docstring: null,
        params: [],
        filePath: 'test.py',
        lineNumber: 1,
        parentClass: 'Foo',
        decorators: [],
        returnType: null,
        baseClasses: [],
    });

    assert(md.includes('**RETURN TYPE:**'), 'Default language should produce Python scaffold');

    console.log('    PASS\n');
}

async function run() {
    console.log('Doc Generator Tests\n');

    testGenerateMeta();
    testGenerateMetaWithParent();
    testFunctionScaffold();
    testClassScaffold();
    testEnumScaffold();
    testJavaFunctionScaffold();
    testJavaNoReqScaffold();
    testPythonScaffoldUnchanged();
    testDefaultLanguagePython();

    console.log('All Doc Generator tests passed!');
}

run().catch(err => {
    console.error('FAIL:', err.message);
    process.exit(1);
});

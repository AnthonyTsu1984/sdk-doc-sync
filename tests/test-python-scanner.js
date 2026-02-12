const fs = require('fs');
const path = require('path');
const PythonScanner = require('../src/sdk-doc-sync/scanners/python-scanner');

const SAMPLE_DIR = path.join(__dirname, '__fixtures__', 'python-sample');

function setup() {
    fs.mkdirSync(path.join(SAMPLE_DIR, 'subpkg'), { recursive: true });

    fs.writeFileSync(path.join(SAMPLE_DIR, 'client.py'), `
"""Client module docstring."""

MAX_RETRIES: int = 3
DEFAULT_TIMEOUT = 30

class MilvusClient(BaseClient):
    """The main Milvus client for interacting with the database."""

    def __init__(self, uri: str = "http://localhost:19530", token: str = None, **kwargs):
        """Initialize MilvusClient.

        Args:
            uri: The connection URI.
            token: Authentication token.
        """
        self.uri = uri

    def insert(self, collection_name: str, data: list, partition_name: str = None) -> dict:
        """Insert data into a collection.

        Args:
            collection_name: Name of the collection.
            data: List of records to insert.
        """
        pass

    def _private_method(self):
        """This should be skipped."""
        pass

    def search(self, collection_name: str, data: list, *args, limit: int = 10, **kwargs) -> list:
        """Search for vectors."""
        pass

class _InternalHelper:
    """This whole class should be skipped when publicOnly=True."""
    def helper(self):
        pass
`);

    fs.writeFileSync(path.join(SAMPLE_DIR, 'enums.py'), `
from enum import Enum

class DataType(Enum):
    """Data types supported by Milvus."""
    BOOL = 1
    INT8 = 2
    FLOAT_VECTOR = 101

class IndexType(str, Enum):
    """Index types."""
    FLAT = "FLAT"
    IVF_FLAT = "IVF_FLAT"
`);

    fs.writeFileSync(path.join(SAMPLE_DIR, 'utils.py'), `
def connect(host: str, port: int = 19530) -> None:
    """Connect to a Milvus server."""
    pass

@deprecated("Use MilvusClient instead")
def get_connection():
    '''Get the default connection.'''
    pass

def _internal_util():
    """Should be skipped."""
    pass
`);

    // File that should be excluded
    fs.writeFileSync(path.join(SAMPLE_DIR, 'test_client.py'), `
def test_insert():
    pass
`);

    // Nested package
    fs.writeFileSync(path.join(SAMPLE_DIR, 'subpkg', 'models.py'), `
class CollectionSchema:
    """Schema for a collection."""

    def __init__(self, fields: list = None, description: str = ""):
        """Create a CollectionSchema."""
        self.fields = fields or []

    def add_field(self, field_name: str, datatype: str, **kwargs) -> None:
        """Add a field to the schema."""
        pass
`);

    // __pycache__ dir should be excluded
    fs.mkdirSync(path.join(SAMPLE_DIR, '__pycache__'), { recursive: true });
    fs.writeFileSync(path.join(SAMPLE_DIR, '__pycache__', 'client.cpython-39.pyc'), 'fake');
}

function teardown() {
    fs.rmSync(SAMPLE_DIR, { recursive: true, force: true });
}

async function testBasicScan() {
    console.log('  Test: basic scan with publicOnly=true');

    const scanner = new PythonScanner({ rootDir: SAMPLE_DIR, publicOnly: true });
    const symbols = await scanner.scan();

    const names = symbols.map(s => `${s.parentClass ? s.parentClass + '.' : ''}${s.name}`);
    console.log(`    Found ${symbols.length} symbols: ${names.join(', ')}`);

    // Should find public classes
    assert(symbols.some(s => s.name === 'MilvusClient' && s.kind === 'class'), 'Should find MilvusClient class');
    assert(symbols.some(s => s.name === 'CollectionSchema' && s.kind === 'class'), 'Should find CollectionSchema class');

    // Should find enums
    assert(symbols.some(s => s.name === 'DataType' && s.kind === 'enum'), 'Should find DataType enum');
    assert(symbols.some(s => s.name === 'IndexType' && s.kind === 'enum'), 'Should find IndexType enum');

    // Should find top-level functions
    assert(symbols.some(s => s.name === 'connect' && s.kind === 'function'), 'Should find connect function');
    assert(symbols.some(s => s.name === 'get_connection' && s.kind === 'function'), 'Should find get_connection function');

    // Should find public methods (including __init__)
    assert(symbols.some(s => s.name === '__init__' && s.parentClass === 'MilvusClient'), 'Should find MilvusClient.__init__');
    assert(symbols.some(s => s.name === 'insert' && s.parentClass === 'MilvusClient'), 'Should find MilvusClient.insert');
    assert(symbols.some(s => s.name === 'search' && s.parentClass === 'MilvusClient'), 'Should find MilvusClient.search');

    // Should find constants
    assert(symbols.some(s => s.name === 'MAX_RETRIES' && s.kind === 'constant'), 'Should find MAX_RETRIES constant');
    assert(symbols.some(s => s.name === 'DEFAULT_TIMEOUT' && s.kind === 'constant'), 'Should find DEFAULT_TIMEOUT constant');

    // Should NOT find private symbols
    assert(!symbols.some(s => s.name === '_private_method'), 'Should not find _private_method');
    assert(!symbols.some(s => s.name === '_InternalHelper'), 'Should not find _InternalHelper');
    assert(!symbols.some(s => s.name === '_internal_util'), 'Should not find _internal_util');

    // Should NOT find test files
    assert(!symbols.some(s => s.name === 'test_insert'), 'Should not find test_insert');

    console.log('    PASS\n');
}

async function testDocstrings() {
    console.log('  Test: docstring extraction');

    const scanner = new PythonScanner({ rootDir: SAMPLE_DIR, publicOnly: true });
    const symbols = await scanner.scan();

    const client = symbols.find(s => s.name === 'MilvusClient' && s.kind === 'class');
    assert(client.docstring === 'The main Milvus client for interacting with the database.', `Class docstring: "${client.docstring}"`);

    const insert = symbols.find(s => s.name === 'insert' && s.parentClass === 'MilvusClient');
    assert(insert.docstring.startsWith('Insert data into a collection.'), `Method docstring: "${insert.docstring}"`);

    const getConn = symbols.find(s => s.name === 'get_connection');
    assert(getConn.docstring === 'Get the default connection.', `Single-quote docstring: "${getConn.docstring}"`);

    console.log('    PASS\n');
}

async function testParams() {
    console.log('  Test: parameter parsing');

    const scanner = new PythonScanner({ rootDir: SAMPLE_DIR, publicOnly: true });
    const symbols = await scanner.scan();

    const init = symbols.find(s => s.name === '__init__' && s.parentClass === 'MilvusClient');
    // Should have uri, token, **kwargs (self stripped)
    assert(init.params.length === 3, `__init__ params count: ${init.params.length}`);
    assert(init.params[0].name === 'uri', `First param: ${init.params[0].name}`);
    assert(init.params[0].type === 'str', `First param type: ${init.params[0].type}`);
    assert(init.params[0].default === '"http://localhost:19530"', `First param default: ${init.params[0].default}`);
    assert(init.params[2].kind === 'kwargs', `kwargs kind: ${init.params[2].kind}`);

    const search = symbols.find(s => s.name === 'search' && s.parentClass === 'MilvusClient');
    assert(search.params.some(p => p.kind === 'args'), 'search should have *args');
    assert(search.params.some(p => p.kind === 'kwargs'), 'search should have **kwargs');
    assert(search.returnType === 'list', `search returnType: ${search.returnType}`);

    const insert = symbols.find(s => s.name === 'insert' && s.parentClass === 'MilvusClient');
    assert(insert.returnType === 'dict', `insert returnType: ${insert.returnType}`);

    console.log('    PASS\n');
}

async function testDecorators() {
    console.log('  Test: decorator extraction');

    const scanner = new PythonScanner({ rootDir: SAMPLE_DIR, publicOnly: true });
    const symbols = await scanner.scan();

    const getConn = symbols.find(s => s.name === 'get_connection');
    assert(getConn.decorators.length === 1, `Decorator count: ${getConn.decorators.length}`);
    assert(getConn.decorators[0].includes('deprecated'), `Decorator: ${getConn.decorators[0]}`);

    console.log('    PASS\n');
}

async function testBaseClasses() {
    console.log('  Test: base class extraction');

    const scanner = new PythonScanner({ rootDir: SAMPLE_DIR, publicOnly: true });
    const symbols = await scanner.scan();

    const client = symbols.find(s => s.name === 'MilvusClient' && s.kind === 'class');
    assert(client.baseClasses.length === 1 && client.baseClasses[0] === 'BaseClient', `Base classes: ${client.baseClasses}`);

    const dataType = symbols.find(s => s.name === 'DataType');
    assert(dataType.baseClasses.includes('Enum'), `DataType bases: ${dataType.baseClasses}`);

    console.log('    PASS\n');
}

async function testPublicOnlyFalse() {
    console.log('  Test: publicOnly=false includes private symbols');

    const scanner = new PythonScanner({ rootDir: SAMPLE_DIR, publicOnly: false });
    const symbols = await scanner.scan();

    assert(symbols.some(s => s.name === '_private_method'), 'Should find _private_method when publicOnly=false');
    assert(symbols.some(s => s.name === '_InternalHelper'), 'Should find _InternalHelper when publicOnly=false');
    assert(symbols.some(s => s.name === '_internal_util'), 'Should find _internal_util when publicOnly=false');

    console.log('    PASS\n');
}

async function testIncludeExclude() {
    console.log('  Test: custom include/exclude patterns');

    const scanner = new PythonScanner({
        rootDir: SAMPLE_DIR,
        publicOnly: true,
        include: ['client.py'],
        exclude: [],
    });
    const symbols = await scanner.scan();

    assert(symbols.some(s => s.name === 'MilvusClient'), 'Should find MilvusClient from client.py');
    assert(!symbols.some(s => s.name === 'connect'), 'Should not find connect from utils.py');
    assert(!symbols.some(s => s.name === 'DataType'), 'Should not find DataType from enums.py');

    console.log('    PASS\n');
}

function assert(condition, message) {
    if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function run() {
    console.log('Python Scanner Tests\n');

    setup();
    try {
        await testBasicScan();
        await testDocstrings();
        await testParams();
        await testDecorators();
        await testBaseClasses();
        await testPublicOnlyFalse();
        await testIncludeExclude();
        console.log('All Python Scanner tests passed!');
    } finally {
        teardown();
    }
}

run().catch(err => {
    teardown();
    console.error('FAIL:', err.message);
    process.exit(1);
});

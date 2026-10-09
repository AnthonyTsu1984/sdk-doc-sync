'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RustScanner = require('../src/sdk-doc-sync/scanners/rust-scanner');

function writeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rust-scanner-'));
  const clientDir = path.join(root, 'src', 'v2', 'client');
  const requestDir = path.join(root, 'src', 'v2', 'request');
  const typesDir = path.join(root, 'src', 'v2', 'types');
  fs.mkdirSync(clientDir, { recursive: true });
  fs.mkdirSync(requestDir, { recursive: true });
  fs.mkdirSync(typesDir, { recursive: true });

  fs.writeFileSync(path.join(clientDir, 'collection.rs'), `\
impl ClientV2 {
    /// Creates a collection.
    pub async fn create_collection(
        &self,
        request: impl Into<request::collection::CreateCollectionRequest>,
    ) -> Result<()> {
        todo!()
    }

    pub async fn server_version(&self) -> Result<String> {
        todo!()
    }

    // No web-content page documents this one.
    pub async fn list_compaction_tasks(&self) -> Result<()> {
        todo!()
    }

    pub fn current_database(&self) -> String {
        todo!()
    }
}

impl MilvusClientV2Session {
    pub fn other(&self) {}
}
`);

  fs.writeFileSync(path.join(requestDir, 'collection.rs'), `\
pub struct CreateCollectionRequest {
    pub(crate) collection_name: String,
    pub(crate) num_partitions: i64,
    pub(crate) schema: Option<CollectionSchema>,
}

pub struct SubSearchRequest {
    vector_field: String,
    vectors: SearchVectors,
}

pub struct HybridSearchRequest {
    pub(crate) collection_name: String,
    pub(crate) sub_requests: Vec<SubSearchRequest>,
}
`);

  fs.writeFileSync(path.join(clientDir, 'dql.rs'), `\
impl ClientV2 {
    pub async fn hybrid_search(
        &self,
        request: impl Into<request::collection::HybridSearchRequest>,
    ) -> Result<SearchResponse> {
        todo!()
    }
}
`);

  const bulkFile = path.join(root, 'src', 'v2', 'bulk_import.rs');
  fs.writeFileSync(bulkFile, `\
pub struct BulkImport {
    client: Client,
}

impl BulkImport {
    pub fn new(config: &BulkImportConfig) -> Result<Self> {
        todo!()
    }
}

pub struct BulkImportRequest {
    collection_name: String,
    files: Vec<String>,
}

pub struct BulkImportConfig {
    url: String,
}
`);

  fs.writeFileSync(path.join(typesDir, 'common.rs'), `\
pub enum ConsistencyLevel {
    /// Strongest guarantee.
    Strong,
    Bounded,
    Customized(String),
}

pub struct NotADocumentedType {
    pub(crate) value: u32,
}
`);

  return root;
}

test('rust scanner extracts client methods, request fields, and page-owning types', async () => {
  const root = writeFixture();
  try {
    const scanner = new RustScanner({ rootDir: root, publicOnly: true, include: ['src/v2/**'] });
    const symbols = await scanner.scan();

    const methods = symbols.filter((symbol) => symbol.kind === 'method');
    assert.deepEqual(methods.map((method) => method.name).sort(),
      ['create_collection', 'current_database', 'hybrid_search', 'list_compaction_tasks', 'new', 'server_version']);

    const create = methods.find((method) => method.name === 'create_collection');
    assert.equal(create.parentClass, 'ClientV2');
    assert.equal(create.category, 'Collections');
    assert.equal(create.requestClass, 'CreateCollectionRequest');
    assert.deepEqual(create.params, [
      { name: 'collection_name', type: 'String' },
      { name: 'num_partitions', type: 'i64' },
      { name: 'schema', type: 'Option<CollectionSchema>' },
    ]);
    // Private builder-encapsulated fields index too (bulk-import shape).
    assert.match(create.signature, /^pub async fn create_collection\(/);
    assert.match(create.signature, /-> Result<\(\)>/);
    assert.equal(create.filePath, 'src/v2/client/collection.rs');
    assert.equal(create.lineNumber, 3);

    // server_version maps to the GetServerVersion page despite the name
    // difference; current_database lives on the container page and is
    // exempt from the coverage gate.
    assert.equal(methods.find((method) => method.name === 'server_version').category, 'Management');
    assert.equal(methods.find((method) => method.name === 'current_database').category, undefined);

    const consistency = symbols.find((symbol) => symbol.name === 'ConsistencyLevel');
    assert.equal(consistency.kind, 'enum');
    assert.equal(consistency.category, 'types');
    assert.deepEqual(consistency.values, ['Strong', 'Bounded', 'Customized']);
    // Enum pages verify declared values through the params set (cpp
    // convention; review r1 P0-2).
    assert.deepEqual(consistency.params.map((param) => param.name), ['Strong', 'Bounded', 'Customized']);

    // HybridSearch flattens SubSearchRequest builder fields into the page's
    // REQUEST FIELDS — the method's params carry the union (review r1 P0-2).
    const hybrid = methods.find((method) => method.name === 'hybrid_search');
    assert.equal(hybrid.category, 'Vector');
    assert.deepEqual(hybrid.params.map((param) => param.name),
      ['collection_name', 'sub_requests', 'vector_field', 'vectors']);

    // Module page symbol carries the flattened request/config builder fields
    // plus the constructor param (review r1 P0-2, DataImport/BulkImport).
    const bulk = symbols.find((symbol) => symbol.name === 'BulkImport');
    assert.equal(bulk.category, 'DataImport');
    assert.ok(bulk.params.map((param) => param.name).includes('collection_name'));
    assert.ok(bulk.params.map((param) => param.name).includes('config'), 'constructor param joins the union');

    // Uncatalogued types are not emitted (java TYPE_CATEGORIES precedent).
    assert.equal(symbols.find((symbol) => symbol.name === 'NotADocumentedType'), undefined);

    // The genuine upstream gap is the only coverage diagnostic.
    assert.equal(symbols.filter((symbol) => symbol.parentClass === 'MilvusClientV2Session').length, 0);
    assert.deepEqual(scanner.lastScanDiagnostics.map((diagnostic) => diagnostic.code), ['COVERAGE_UNTRACKED_METHODS']);
    assert.deepEqual(scanner.lastScanDiagnostics[0].methods, ['list_compaction_tasks']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const fs = require('fs');
const path = require('path');
const CppScanner = require('../src/sdk-doc-sync/scanners/cpp-scanner');

const SAMPLE_DIR = path.join(__dirname, '__fixtures__', 'cpp-sample');

function setup() {
    const includeDir = path.join(SAMPLE_DIR, 'src', 'include', 'milvus');
    const requestColDir = path.join(includeDir, 'request', 'collection');
    const requestDmlDir = path.join(includeDir, 'request', 'dml');
    const requestRbacDir = path.join(includeDir, 'request', 'rbac');
    const typesDir = path.join(includeDir, 'types');

    fs.mkdirSync(requestColDir, { recursive: true });
    fs.mkdirSync(requestDmlDir, { recursive: true });
    fs.mkdirSync(requestRbacDir, { recursive: true });
    fs.mkdirSync(typesDir, { recursive: true });

    // MilvusClientV2.h with sample methods
    fs.writeFileSync(path.join(includeDir, 'MilvusClientV2.h'), `
#pragma once

namespace milvus {

class MilvusClientV2 {
 public:
    virtual ~MilvusClientV2() = default;

    /**
     * @brief Crate a MilvusClientV2 instance.
     */
    static std::shared_ptr<MilvusClientV2>
    Create();

    /**
     * @brief Connect to Milvus server.
     *
     * @param [in] connect_param server address and port
     * @return Status operation successfully or not
     */
    virtual Status
    Connect(const ConnectParam& connect_param) = 0;

    /**
     * @brief Close connections between client and server.
     */
    virtual Status
    Disconnect() = 0;

    /**
     * @brief Switch connection to another database.
     *
     * @param [in] db_name name of the database
     */
    virtual Status
    UseDatabase(const std::string& db_name) = 0;

    /**
     * @brief Create a collection.
     *
     * @param [in] request input parameters
     */
    virtual Status
    CreateCollection(const CreateCollectionRequest& request) = 0;

    /**
     * @brief Create a simple collection with a primary field and a vector field.
     *
     * @param [in] request input parameters
     */
    virtual Status
    CreateCollection(const CreateSimpleCollectionRequest& request) = 0;

    /**
     * @brief Insert data into a collection.
     *
     * @param [in] request input parameters
     * @param [out] response output results
     */
    virtual Status
    Insert(const InsertRequest& request, InsertResponse& response) = 0;

    /**
     * @brief Grant a privilege or a privilege group to a role.
     *
     * @param [in] request input parameters
     */
    virtual Status
    GrantPrivilegeV2(const GrantPrivilegeV2Request& request) = 0;

    /**
     * @brief Search a collection based on the given parameters and return results.
     *
     * @param [in] request input parameters
     * @param [out] response output results
     */
    virtual Status
    Search(const SearchRequest& request, SearchResponse& response) = 0;
};

}  // namespace milvus
`);

    // CollectionRequestBase.h — template base class
    fs.writeFileSync(path.join(requestColDir, 'CollectionRequestBase.h'), `
#pragma once
namespace milvus {
template <typename T>
class CollectionRequestBase {
 protected:
    CollectionRequestBase() = default;
 public:
    /**
     * @brief Set target db name.
     */
    T&
    WithDatabaseName(const std::string& db_name) {
        db_name_ = db_name;
        return static_cast<T&>(*this);
    }

    /**
     * @brief Set the collection name.
     */
    T&
    WithCollectionName(const std::string& collection_name) {
        collection_name_ = collection_name;
        return static_cast<T&>(*this);
    }
 protected:
    std::string db_name_;
    std::string collection_name_;
};
}
`);

    // CreateCollectionRequest.h — standalone (no base class)
    fs.writeFileSync(path.join(requestColDir, 'CreateCollectionRequest.h'), `
#pragma once
namespace milvus {
class CreateCollectionRequest {
 public:
    CreateCollectionRequest() = default;

    /**
     * @brief Set database name.
     */
    CreateCollectionRequest&
    WithDatabaseName(const std::string& db_name);

    /**
     * @brief Set name of the collection.
     */
    CreateCollectionRequest&
    WithCollectionName(const std::string& collection_name);

    /**
     * @brief Set collection schema.
     */
    CreateCollectionRequest&
    WithCollectionSchema(const CollectionSchemaPtr& schema);

    /**
     * @brief Set number of shards.
     */
    CreateCollectionRequest&
    WithNumShards(int64_t num_shards);

    /**
     * @brief Add a property.
     */
    CreateCollectionRequest&
    AddProperty(const std::string& key, const std::string& property);

 private:
    std::string db_name_;
};
}
`);

    // CreateSimpleCollectionRequest.h — inherits CollectionRequestBase
    fs.writeFileSync(path.join(requestColDir, 'CreateSimpleCollectionRequest.h'), `
#pragma once
#include "CollectionRequestBase.h"
namespace milvus {
class CreateSimpleCollectionRequest : public CollectionRequestBase<CreateSimpleCollectionRequest> {
 public:
    CreateSimpleCollectionRequest() = default;

    /**
     * @brief Set the vector field dimension.
     */
    CreateSimpleCollectionRequest&
    WithDimension(int64_t dimension);
};
}
`);

    // DMLRequestBase.h
    fs.writeFileSync(path.join(requestDmlDir, 'DMLRequestBase.h'), `
#pragma once
namespace milvus {
template <typename T>
class DMLRequestBase {
 protected:
    DMLRequestBase() = default;
 public:
    /**
     * @brief Set target db name.
     */
    T&
    WithDatabaseName(const std::string& db_name) {
        db_name_ = db_name;
        return static_cast<T&>(*this);
    }

    /**
     * @brief Set the collection name.
     */
    T&
    WithCollectionName(const std::string& collection_name) {
        collection_name_ = collection_name;
        return static_cast<T&>(*this);
    }

    /**
     * @brief Set the partition name.
     */
    T&
    WithPartitionName(const std::string& partition_name) {
        partition_name_ = partition_name;
        return static_cast<T&>(*this);
    }
};
}
`);

    // InsertRequest.h — inherits DMLRequestBase
    fs.writeFileSync(path.join(requestDmlDir, 'InsertRequest.h'), `
#pragma once
#include "DMLRequestBase.h"
namespace milvus {
class InsertRequest : public DMLRequestBase<InsertRequest> {
 public:
    InsertRequest() = default;

    /**
     * @brief Add column data.
     */
    InsertRequest&
    AddColumnData(const FieldDataPtr& column_data);
};
}
`);

    // PrivilegeV2Request.h with using aliases
    fs.writeFileSync(path.join(requestRbacDir, 'PrivilegeV2Request.h'), `
#pragma once
namespace milvus {
class PrivilegeV2Request {
 public:
    PrivilegeV2Request() = default;

    /**
     * @brief Set name of the role.
     */
    PrivilegeV2Request&
    WithRoleName(const std::string& name);

    /**
     * @brief Set name of the privilege.
     */
    PrivilegeV2Request&
    WithPrivilege(const std::string& privilege);
};

using GrantPrivilegeV2Request = PrivilegeV2Request;
using RevokePrivilegeV2Request = PrivilegeV2Request;
}
`);

    // SearchRequest.h — DQL with multiple inheritance (simplified)
    // We put a minimal DQLRequestBase in a separate file
    const requestDqlDir = path.join(includeDir, 'request', 'dql');
    fs.mkdirSync(requestDqlDir, { recursive: true });

    fs.writeFileSync(path.join(requestDqlDir, 'DQLRequestBase.h'), `
#pragma once
namespace milvus {
template <typename T>
class DQLRequestBase {
 protected:
    DQLRequestBase() = default;
 public:
    /**
     * @brief Set target db name.
     */
    T&
    WithDatabaseName(const std::string& db_name) {
        return static_cast<T&>(*this);
    }

    /**
     * @brief Set the collection name.
     */
    T&
    WithCollectionName(const std::string& collection_name) {
        return static_cast<T&>(*this);
    }

    /**
     * @brief Set the consistency level.
     */
    T&
    WithConsistencyLevel(ConsistencyLevel consistency_level) {
        return static_cast<T&>(*this);
    }

    /**
     * @brief Add an output field.
     */
    T&
    AddOutputField(const std::string& output_field) {
        return static_cast<T&>(*this);
    }
};
}
`);

    fs.writeFileSync(path.join(requestDqlDir, 'SearchRequest.h'), `
#pragma once
#include "DQLRequestBase.h"
namespace milvus {
class SearchRequest : public DQLRequestBase<SearchRequest> {
 public:
    SearchRequest() = default;

    /**
     * @brief Set search limit.
     */
    SearchRequest&
    WithLimit(int64_t limit);

    /**
     * @brief Set filter expression.
     */
    SearchRequest&
    WithFilter(std::string filter);

    /**
     * @brief Set metric type.
     */
    SearchRequest&
    WithMetricType(::milvus::MetricType metric_type);
};
}
`);

    // DataType.h enum
    fs.writeFileSync(path.join(typesDir, 'DataType.h'), `
#pragma once
namespace milvus {
/**
 * @brief Data type of field
 */
enum class DataType {
    UNKNOWN = 0,
    BOOL = 1,
    INT8 = 2,
    INT64 = 5,
    FLOAT = 10,
    VARCHAR = 21,
    FLOAT_VECTOR = 101,
};
}
`);

    // ConsistencyLevel.h enum
    fs.writeFileSync(path.join(typesDir, 'ConsistencyLevel.h'), `
#pragma once
namespace milvus {
/**
 * @brief Consistency level for search/query.
 */
enum class ConsistencyLevel {
    NONE = -1,
    STRONG = 0,
    SESSION = 1,
    BOUNDED = 2,
    EVENTUALLY = 3,
};
}
`);
}

function teardown() {
    fs.rmSync(SAMPLE_DIR, { recursive: true, force: true });
}

function assert(condition, message) {
    if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function testMethodExtraction() {
    console.log('  Test: method extraction from MilvusClientV2.h');

    const scanner = new CppScanner({ rootDir: SAMPLE_DIR });
    const symbols = await scanner.scan();

    const methods = symbols.filter(s => s.kind === 'method');
    const names = methods.map(s => s.name);
    console.log(`    Found ${methods.length} methods: ${names.join(', ')}`);

    assert(methods.length === 9, `Expected 9 methods, got ${methods.length}`);
    assert(names.includes('Create'), 'Should find Create');
    assert(names.includes('Connect'), 'Should find Connect');
    assert(names.includes('Disconnect'), 'Should find Disconnect');
    assert(names.includes('UseDatabase'), 'Should find UseDatabase');
    assert(names.includes('CreateCollection'), 'Should find CreateCollection');
    assert(names.includes('CreateSimpleCollection'), 'Should find CreateSimpleCollection');
    assert(names.includes('Insert'), 'Should find Insert');
    assert(names.includes('GrantPrivilegeV2'), 'Should find GrantPrivilegeV2');

    console.log('    PASS\n');
}

async function testOverloadDisambiguation() {
    console.log('  Test: CreateCollection overload disambiguated as CreateSimpleCollection');

    const scanner = new CppScanner({ rootDir: SAMPLE_DIR });
    const symbols = await scanner.scan();

    const cc = symbols.find(s => s.name === 'CreateCollection');
    assert(cc, 'CreateCollection should exist');
    assert(cc.requestClass === 'CreateCollectionRequest', `requestClass: ${cc.requestClass}`);

    const csc = symbols.find(s => s.name === 'CreateSimpleCollection');
    assert(csc, 'CreateSimpleCollection should exist');
    assert(csc.requestClass === 'CreateSimpleCollectionRequest', `requestClass: ${csc.requestClass}`);

    console.log('    PASS\n');
}

async function testDoxygenExtraction() {
    console.log('  Test: Doxygen @brief extracted as docstring');

    const scanner = new CppScanner({ rootDir: SAMPLE_DIR });
    const symbols = await scanner.scan();

    const connect = symbols.find(s => s.name === 'Connect');
    assert(connect.docstring === 'Connect to Milvus server.', `Connect docstring: "${connect.docstring}"`);

    const disconnect = symbols.find(s => s.name === 'Disconnect');
    assert(disconnect.docstring === 'Close connections between client and server.', `Disconnect docstring: "${disconnect.docstring}"`);

    console.log('    PASS\n');
}

async function testRequestResponseClasses() {
    console.log('  Test: request/response class extraction');

    const scanner = new CppScanner({ rootDir: SAMPLE_DIR });
    const symbols = await scanner.scan();

    const insert = symbols.find(s => s.name === 'Insert');
    assert(insert.requestClass === 'InsertRequest', `Insert requestClass: ${insert.requestClass}`);
    assert(insert.responseClass === 'InsertResponse', `Insert responseClass: ${insert.responseClass}`);

    const disconnect = symbols.find(s => s.name === 'Disconnect');
    assert(disconnect.requestClass === null, `Disconnect should have no requestClass`);
    assert(disconnect.responseClass === null, `Disconnect should have no responseClass`);

    const useDb = symbols.find(s => s.name === 'UseDatabase');
    assert(useDb.requestClass === null, 'UseDatabase should have no requestClass');

    console.log('    PASS\n');
}

async function testDirectParams() {
    console.log('  Test: direct params for non-request methods');

    const scanner = new CppScanner({ rootDir: SAMPLE_DIR });
    const symbols = await scanner.scan();

    const useDb = symbols.find(s => s.name === 'UseDatabase');
    assert(useDb.params.length === 1, `UseDatabase params count: ${useDb.params.length}`);
    assert(useDb.params[0].name === 'db_name', `UseDatabase param name: ${useDb.params[0].name}`);

    const connect = symbols.find(s => s.name === 'Connect');
    assert(connect.params.length === 1, `Connect params count: ${connect.params.length}`);
    assert(connect.params[0].name === 'connect_param', `Connect param name: ${connect.params[0].name}`);

    console.log('    PASS\n');
}

async function testRequestParamsWithBaseClass() {
    console.log('  Test: request params with base class inheritance');

    const scanner = new CppScanner({ rootDir: SAMPLE_DIR });
    const symbols = await scanner.scan();

    // CreateCollectionRequest — standalone, no base class
    const cc = symbols.find(s => s.name === 'CreateCollection');
    const ccNames = cc.params.map(p => p.name);
    console.log(`    CreateCollection params: ${ccNames.join(', ')}`);
    assert(ccNames.includes('WithDatabaseName'), 'Should have WithDatabaseName');
    assert(ccNames.includes('WithCollectionName'), 'Should have WithCollectionName');
    assert(ccNames.includes('WithCollectionSchema'), 'Should have WithCollectionSchema');
    assert(ccNames.includes('WithNumShards'), 'Should have WithNumShards');
    assert(ccNames.includes('AddProperty'), 'Should have AddProperty');

    // CreateSimpleCollectionRequest — inherits CollectionRequestBase
    const csc = symbols.find(s => s.name === 'CreateSimpleCollection');
    const cscNames = csc.params.map(p => p.name);
    console.log(`    CreateSimpleCollection params: ${cscNames.join(', ')}`);
    assert(cscNames.includes('WithDatabaseName'), 'Should inherit WithDatabaseName from base');
    assert(cscNames.includes('WithCollectionName'), 'Should inherit WithCollectionName from base');
    assert(cscNames.includes('WithDimension'), 'Should have own WithDimension');

    // InsertRequest — inherits DMLRequestBase
    const ins = symbols.find(s => s.name === 'Insert');
    const insNames = ins.params.map(p => p.name);
    console.log(`    Insert params: ${insNames.join(', ')}`);
    assert(insNames.includes('WithDatabaseName'), 'Should inherit WithDatabaseName from DMLRequestBase');
    assert(insNames.includes('WithCollectionName'), 'Should inherit WithCollectionName');
    assert(insNames.includes('WithPartitionName'), 'Should inherit WithPartitionName from DMLRequestBase');
    assert(insNames.includes('AddColumnData'), 'Should have own AddColumnData');

    console.log('    PASS\n');
}

async function testUsingAliasResolution() {
    console.log('  Test: using alias resolution');

    const scanner = new CppScanner({ rootDir: SAMPLE_DIR });
    const symbols = await scanner.scan();

    // GrantPrivilegeV2Request is an alias for PrivilegeV2Request
    const gp = symbols.find(s => s.name === 'GrantPrivilegeV2');
    const gpNames = gp.params.map(p => p.name);
    console.log(`    GrantPrivilegeV2 params: ${gpNames.join(', ')}`);
    assert(gpNames.includes('WithRoleName'), 'Should have WithRoleName from PrivilegeV2Request');
    assert(gpNames.includes('WithPrivilege'), 'Should have WithPrivilege from PrivilegeV2Request');

    console.log('    PASS\n');
}

async function testSearchWithDQLBase() {
    console.log('  Test: SearchRequest inherits DQLRequestBase params');

    const scanner = new CppScanner({ rootDir: SAMPLE_DIR });
    const symbols = await scanner.scan();

    const search = symbols.find(s => s.name === 'Search');
    const names = search.params.map(p => p.name);
    console.log(`    Search params: ${names.join(', ')}`);

    // From DQLRequestBase
    assert(names.includes('WithDatabaseName'), 'Should inherit WithDatabaseName');
    assert(names.includes('WithCollectionName'), 'Should inherit WithCollectionName');
    assert(names.includes('WithConsistencyLevel'), 'Should inherit WithConsistencyLevel');
    assert(names.includes('AddOutputField'), 'Should inherit AddOutputField');

    // From SearchRequest itself
    assert(names.includes('WithLimit'), 'Should have own WithLimit');
    assert(names.includes('WithFilter'), 'Should have own WithFilter');
    assert(names.includes('WithMetricType'), 'Should have own WithMetricType');

    console.log('    PASS\n');
}

async function testEnumExtraction() {
    console.log('  Test: enum extraction');

    const scanner = new CppScanner({ rootDir: SAMPLE_DIR });
    const symbols = await scanner.scan();

    const enums = symbols.filter(s => s.kind === 'enum');
    const enumNames = enums.map(e => e.name);
    console.log(`    Found ${enums.length} enums: ${enumNames.join(', ')}`);

    // We created DataType and ConsistencyLevel in fixtures
    assert(enums.length === 2, `Expected 2 enums, got ${enums.length}`);
    assert(enumNames.includes('DataType'), 'Should find DataType');
    assert(enumNames.includes('ConsistencyLevel'), 'Should find ConsistencyLevel');

    const dt = enums.find(e => e.name === 'DataType');
    assert(dt.parentClass === 'Collections', `DataType category: ${dt.parentClass}`);
    assert(dt.params.length === 7, `DataType values count: ${dt.params.length}`);
    assert(dt.params[0].name === 'UNKNOWN', `First value: ${dt.params[0].name}`);
    assert(dt.docstring === 'Data type of field', `DataType docstring: "${dt.docstring}"`);

    const cl = enums.find(e => e.name === 'ConsistencyLevel');
    assert(cl.parentClass === 'Collections', `ConsistencyLevel category: ${cl.parentClass}`);
    assert(cl.params.length === 5, `ConsistencyLevel values count: ${cl.params.length}`);

    console.log('    PASS\n');
}

async function testCategoryAssignment() {
    console.log('  Test: category assignment via parentClass');

    const scanner = new CppScanner({ rootDir: SAMPLE_DIR });
    const symbols = await scanner.scan();

    const create = symbols.find(s => s.name === 'Create');
    assert(create.parentClass === 'Client', `Create category: ${create.parentClass}`);

    const cc = symbols.find(s => s.name === 'CreateCollection');
    assert(cc.parentClass === 'Collections', `CreateCollection category: ${cc.parentClass}`);

    const insert = symbols.find(s => s.name === 'Insert');
    assert(insert.parentClass === 'Vector', `Insert category: ${insert.parentClass}`);

    const gp = symbols.find(s => s.name === 'GrantPrivilegeV2');
    assert(gp.parentClass === 'Authentication', `GrantPrivilegeV2 category: ${gp.parentClass}`);

    console.log('    PASS\n');
}

async function testSymbolSchema() {
    console.log('  Test: symbol schema has all required fields');

    const scanner = new CppScanner({ rootDir: SAMPLE_DIR });
    const symbols = await scanner.scan();

    const method = symbols.find(s => s.kind === 'method');
    const requiredFields = ['name', 'kind', 'signature', 'docstring', 'params', 'filePath', 'lineNumber', 'parentClass', 'requestClass', 'responseClass'];
    for (const field of requiredFields) {
        assert(field in method, `Missing field: ${field}`);
    }

    const enumSym = symbols.find(s => s.kind === 'enum');
    for (const field of ['name', 'kind', 'signature', 'docstring', 'params', 'filePath', 'parentClass']) {
        assert(field in enumSym, `Enum missing field: ${field}`);
    }

    console.log('    PASS\n');
}

async function run() {
    console.log('C++ Scanner Tests\n');

    setup();
    try {
        await testMethodExtraction();
        await testOverloadDisambiguation();
        await testDoxygenExtraction();
        await testRequestResponseClasses();
        await testDirectParams();
        await testRequestParamsWithBaseClass();
        await testUsingAliasResolution();
        await testSearchWithDQLBase();
        await testEnumExtraction();
        await testCategoryAssignment();
        await testSymbolSchema();
        console.log('All C++ Scanner tests passed!');
    } finally {
        teardown();
    }
}

run().catch(err => {
    teardown();
    console.error('FAIL:', err.message);
    process.exit(1);
});

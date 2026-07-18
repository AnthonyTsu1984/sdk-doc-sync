const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validateReferenceDocument } = require('../src/sdk-reference-ir/validate');
const pythonAdapter = require('../src/sdk-reference-ir/adapters/python');
const javaAdapter = require('../src/sdk-reference-ir/adapters/java');
const nodeAdapter = require('../src/sdk-reference-ir/adapters/node');
const goAdapter = require('../src/sdk-reference-ir/adapters/go');
const cppAdapter = require('../src/sdk-reference-ir/adapters/cpp');
const cliAdapter = require('../src/sdk-reference-ir/adapters/zilliz-cli');

const fixtureDir = path.join(__dirname, 'fixtures', 'scanners');

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
}

function context(language, category, overrides = {}) {
  const realistic = {
    python: {
      repository: 'milvus-io/pymilvus',
      summary: 'Searches vectors in a Milvus collection.',
      example: 'client.search(collection_name="docs", data=[[0.1, 0.2]], limit=10)',
    },
    java: {
      repository: 'zilliztech/milvus-sdk-java',
      summary: 'Creates a collection through the Java v2 client.',
      example: 'client.createCollection(CreateCollectionReq.builder().collectionName("docs").dimension(128).build());',
    },
    node: {
      repository: 'zilliztech/milvus-sdk-node',
      summary: 'Creates a collection through the Node.js client.',
      example: 'await client.createCollection({ collection_name: "docs", dimension: 128 });',
    },
    go: {
      repository: 'milvus-io/milvus-sdk-go',
      summary: 'Creates a collection through the Go client.',
      example: 'err := client.CreateCollection(ctx, milvusclient.SimpleCreateCollectionOptions("docs", 128))',
    },
    cpp: {
      repository: 'zilliztech/milvus-sdk-cpp',
      summary: 'Creates a collection through the C++ client.',
      example: 'auto status = client->CreateCollection(request, response);',
    },
    'zilliz-cli': {
      repository: 'zilliztech/zilliz-cli',
      summary: 'Creates a Zilliz Cloud project.',
      example: 'zilliz project create --name docs --region aws-us-west-2',
    },
  }[language];
  return {
    repository: realistic.repository,
    revision: 'v2.6.0',
    category,
    summary: realistic.summary,
    examples: [{
      title: `${category} example`,
      description: `Uses the ${language} scanner fixture.`,
      language,
      code: realistic.example,
    }],
    audienceVariants: [{ audience: 'milvus', summary: 'Available to Milvus users.' }],
    reviewedEvidence: [{
      kind: 'curated',
      locator: `reviews/${language}-operation.md`,
      revision: 'v2.6.0',
      confidence: 'reviewed',
    }],
    notes: ['The adapter preserves scanner-owned structure.'],
    related: [{ title: 'Related guide', url: '/docs/related' }],
    ...overrides,
  };
}

const cases = [
  ['python-search.json', pythonAdapter, 'python', 'Vector'],
  ['java-create-collection.json', javaAdapter, 'java', 'Collections'],
  ['node-create-collection.json', nodeAdapter, 'node', 'Collections'],
  ['go-create-collection.json', goAdapter, 'go', 'Collections'],
  ['cpp-create-collection.json', cppAdapter, 'cpp', 'Collections'],
  ['cli-project-create.json', cliAdapter, 'zilliz-cli', 'Project'],
];

test('all scanner adapters produce immutable deterministic production-valid documents', () => {
  for (const [name, adapter, language, category] of cases) {
    const symbol = fixture(name);
    const before = JSON.stringify(symbol);
    const adapterContext = context(language, category, language === 'python' ? {
      exceptions: [{
        name: 'MilvusException',
        condition: 'The search request is rejected by the server.',
        description: 'Reports a server-side search failure.',
      }],
    } : language === 'cpp' ? {
      result: {
        type: 'Status',
        description: 'Returns status and fills the response object.',
        fields: [{
          name: 'response',
          type: 'CreateCollectionResponse',
          required: true,
          description: 'Created collection response.',
        }],
      },
    } : {});

    const first = adapter.toReferenceDocument(symbol, adapterContext);
    const second = adapter.toReferenceDocument(symbol, adapterContext);

    assert.equal(JSON.stringify(symbol), before, `${language} input mutated`);
    assert.deepEqual(first, second, `${language} output is not deterministic`);
    assert.equal(Object.isFrozen(first), true, `${language} document is not frozen`);
    assert.equal(Object.isFrozen(first.identity), true, `${language} identity is not frozen`);
    assert.equal(first.identity.stableId, `${language}:${category}:${symbol.name}`);
    assert.equal(first.source.file, symbol.filePath);
    assert.equal(first.source.line, symbol.lineNumber);
    assert.ok(first.evidence.some((item) => item.locator === `${symbol.filePath}:${symbol.lineNumber}`));

    const validation = validateReferenceDocument(first, { production: true });
    assert.equal(validation.valid, true, `${language}: ${JSON.stringify(validation.errors)}`);
  }
});

test('Python preserves direct parameter semantics, return type, and supplied exceptions', () => {
  const doc = pythonAdapter.toReferenceDocument(
    fixture('python-search.json'),
    context('python', 'Vector', {
      exceptions: [{
        name: 'MilvusException',
        condition: 'The server rejects the search.',
        description: 'Reports a server-side search error.',
      }],
    }),
  );

  assert.deepEqual(doc.signatures[0].inputs.map((field) => field.name), [
    'collection_name', 'data', 'limit', 'kwargs',
  ]);
  assert.deepEqual(doc.requestVariants[0].inputs.map((field) => field.name), [
    'collection_name', 'data', 'limit', 'kwargs',
  ]);
  assert.equal(doc.signatures[0].inputs[0].required, true);
  assert.equal(doc.signatures[0].inputs[2].defaultValue, '10');
  assert.ok(doc.signatures[0].inputs[2].constraints.includes('kind: keyword'));
  assert.equal(doc.result.type.display, 'list[SearchResult]');
  assert.equal(doc.errors[0].name, 'MilvusException');
});

test('Java maps request fields to a request variant and builder members only when requestClass exists', () => {
  const symbol = fixture('java-create-collection.json');
  const requestEvidence = [{
    kind: 'source',
    locator: 'src/main/java/io/milvus/v2/service/collection/request/CreateCollectionReq.java:32',
    revision: 'v2.6.0',
    confidence: 'direct',
  }];
  const doc = javaAdapter.toReferenceDocument(symbol, context('java', 'Collections', {
    fieldEvidence: { collectionName: requestEvidence, dimension: requestEvidence, metricType: requestEvidence },
    memberEvidence: { collectionName: requestEvidence, dimension: requestEvidence, metricType: requestEvidence },
  }));

  assert.equal(doc.requestVariants[0].id, 'CreateCollectionReq');
  assert.deepEqual(doc.callableMembers.map((member) => member.kind), ['builder', 'builder', 'builder']);
  assert.equal(doc.callableMembers[0].name, 'collectionName');
  assert.equal(doc.callableMembers[0].signature.display, 'collectionName(String collectionName)');
  assert.equal(doc.callableMembers[0].signature.inputs[0].name, 'collectionName');
  assert.equal(doc.callableMembers[0].signature.inputs[0].type.display, 'String');
  assert.equal(doc.requestVariants[0].inputs[0].required, true);
  assert.equal(doc.requestVariants[0].inputs[2].required, false);
  assert.equal(doc.requestVariants[0].inputs[2].defaultValue, 'MetricType.COSINE');
  assert.equal(doc.requestVariants[0].inputs[0].evidence[0].locator, requestEvidence[0].locator);
  assert.equal(doc.callableMembers[0].evidence[0].locator, requestEvidence[0].locator);

  const ownSourceSymbol = fixture('java-create-collection.json');
  ownSourceSymbol.params[0].sourceFile = 'src/main/java/io/milvus/v2/service/collection/request/CreateCollectionReq.java';
  ownSourceSymbol.params[0].sourceLine = 32;
  const ownSourceDoc = javaAdapter.toReferenceDocument(
    ownSourceSymbol,
    context('java', 'Collections'),
  );
  assert.equal(
    ownSourceDoc.requestVariants[0].inputs[0].evidence[0].locator,
    'src/main/java/io/milvus/v2/service/collection/request/CreateCollectionReq.java:32',
  );
  assert.equal(ownSourceDoc.requestVariants[0].inputs[0].evidence[0].confidence, 'direct');

  const withoutRequest = javaAdapter.toReferenceDocument(
    { ...symbol, requestClass: null },
    context('java', 'Collections'),
  );
  assert.deepEqual(withoutRequest.requestVariants, []);
  assert.deepEqual(withoutRequest.callableMembers, []);
});

test('Java explicit required wins and derived request evidence needs document review', () => {
  const symbol = fixture('java-create-collection.json');
  symbol.params[0].required = false;
  const reviewed = javaAdapter.toReferenceDocument(symbol, context('java', 'Collections'));
  assert.equal(reviewed.requestVariants[0].inputs[0].required, false);
  assert.equal(reviewed.requestVariants[0].inputs[1].evidence[0].confidence, 'derived');
  assert.equal(validateReferenceDocument(reviewed, { production: true }).valid, true);

  const withoutReview = javaAdapter.toReferenceDocument(symbol, context('java', 'Collections', {
    reviewedEvidence: [],
  }));
  const validation = validateReferenceDocument(withoutReview, { production: true });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === 'MISSING_REVIEWED_EVIDENCE'));
});

test('Node preserves explicit request variants and recursively normalizes nested fields', () => {
  const doc = nodeAdapter.toReferenceDocument(
    fixture('node-create-collection.json'),
    context('node', 'Collections'),
  );

  assert.equal(doc.signatures[0].display, 'client.createCollection(data)');
  assert.deepEqual(doc.requestVariants.map((variant) => variant.id), ['simple', 'schema']);
  assert.equal(doc.requestVariants[1].title, 'Custom schema');
  assert.deepEqual(
    doc.requestVariants[1].inputs[1].children.map((field) => field.name),
    ['name', 'data_type'],
  );
  assert.equal(doc.result.type.display, 'Promise<CreateCollectionResponse>');
  assert.equal(doc.result.fields[0].name, 'status');
  assert.deepEqual(doc.callableMembers, []);
  assert.doesNotMatch(JSON.stringify(doc), /python|builder/i);
});

test('Node maps raw scanner kinds and flat params without inventing alternatives or results', () => {
  const rawFunction = {
    name: 'createCollection',
    parentClass: 'Collections',
    kind: 'Function',
    docstring: 'Creates a collection.',
    filePath: 'milvus/MilvusClient.ts',
    lineNumber: 146,
    params: [{ name: 'data', type: 'CreateCollectionReq | SimpleCreateCollectionReq' }],
  };
  const functionDoc = nodeAdapter.toReferenceDocument(rawFunction, context('node', 'Collections'));
  assert.equal(functionDoc.identity.kind, 'function');
  assert.deepEqual(functionDoc.requestVariants.map((variant) => variant.id), ['default']);
  assert.deepEqual(functionDoc.requestVariants[0].inputs.map((field) => field.name), ['data']);
  assert.equal(functionDoc.result, null);

  const classDoc = nodeAdapter.toReferenceDocument({
    name: 'MilvusClient', kind: 'Class', parentClass: 'Client', docstring: 'Milvus client.',
    filePath: 'milvus/MilvusClient.ts', lineNumber: 1, params: [],
  }, context('node', 'Client'));
  const enumDoc = nodeAdapter.toReferenceDocument({
    name: 'DataType', kind: 'Enum', parentClass: 'Collections', docstring: 'Data type enumeration.',
    filePath: 'milvus/const/milvus.ts', lineNumber: 18, params: [],
  }, context('node', 'Collections'));
  assert.equal(classDoc.identity.kind, 'class');
  assert.equal(enumDoc.identity.kind, 'enum');
  assert.deepEqual(classDoc.requestVariants, []);
  assert.deepEqual(enumDoc.requestVariants, []);
  assert.deepEqual(enumDoc.callableMembers, []);
});

test('Node stable IDs add deterministic overload suffixes without collisions', () => {
  const symbol = fixture('node-create-collection.json');
  const simple = nodeAdapter.toReferenceDocument(symbol, context('node', 'Collections', { overloadKey: 'simple' }));
  const schemaVariant = nodeAdapter.toReferenceDocument(
    { ...symbol, overloadKey: 'schema' },
    context('node', 'Collections'),
  );
  assert.equal(simple.identity.stableId, 'node:Collections:createCollection:simple');
  assert.equal(schemaVariant.identity.stableId, 'node:Collections:createCollection:schema');
  assert.notEqual(simple.identity.stableId, schemaVariant.identity.stableId);
});

test('Go keeps constructor inputs and option method full signatures', () => {
  const doc = goAdapter.toReferenceDocument(
    fixture('go-create-collection.json'),
    context('go', 'Collections'),
  );

  assert.deepEqual(doc.signatures[0].inputs.map((field) => field.name), ['collectionName', 'dimension']);
  assert.deepEqual(doc.callableMembers.map((member) => member.kind), ['option', 'option']);
  assert.equal(doc.callableMembers[0].signature.display, 'WithMetricType(metricType entity.MetricType)');
  assert.equal(doc.result.type.display, 'error');
});

test('C++ keeps request methods and canonical Status/result structure', () => {
  const requestEvidence = [{
    kind: 'source',
    locator: 'include/milvus/requests/CreateCollectionRequest.h:44',
    revision: 'v2.6.0',
    confidence: 'direct',
  }];
  const doc = cppAdapter.toReferenceDocument(
    fixture('cpp-create-collection.json'),
    context('cpp', 'Collections', {
      fieldEvidence: {
        collection_name: requestEvidence,
        dimension: requestEvidence,
        field: requestEvidence,
      },
      memberEvidence: {
        WithCollectionName: requestEvidence,
        WithDimension: requestEvidence,
        AddField: requestEvidence,
      },
      result: {
        type: 'Status',
        description: 'Returns status and fills the response object.',
        fields: [{ name: 'response', type: 'CreateCollectionResponse', required: true, description: 'Response object.' }],
      },
    }),
  );

  assert.equal(doc.requestVariants[0].id, 'CreateCollectionRequest');
  assert.deepEqual(doc.callableMembers.map((member) => member.kind), ['request', 'request', 'request']);
  assert.equal(doc.callableMembers[0].signature.display, 'WithCollectionName(const std::string& collection_name)');
  assert.equal(doc.result.type.display, 'Status');
  assert.equal(doc.result.fields[0].type.display, 'CreateCollectionResponse');
  assert.equal(doc.requestVariants[0].inputs[0].evidence[0].locator, requestEvidence[0].locator);
  assert.equal(doc.callableMembers[0].evidence[0].locator, requestEvidence[0].locator);
});

test('C++ direct methods use params as direct inputs and never invent request members', () => {
  const doc = cppAdapter.toReferenceDocument(
    fixture('cpp-get-server-version.json'),
    context('cpp', 'Client', {
      summary: 'Gets the Milvus server version.',
      result: { type: 'Status', description: 'Returns operation status.', fields: [] },
    }),
  );

  assert.deepEqual(doc.signatures[0].inputs.map((field) => field.name), ['version']);
  assert.deepEqual(doc.requestVariants.map((variant) => variant.id), ['default']);
  assert.deepEqual(doc.requestVariants[0].inputs.map((field) => field.name), ['version']);
  assert.deepEqual(doc.callableMembers, []);
});

test('C++ enums preserve values without request or callable sections', () => {
  const symbol = {
    name: 'DataType', kind: 'enum', signature: 'enum class DataType { None = 0, Bool = 1 }',
    docstring: 'Supported data types.',
    params: [
      { name: 'None', value: '0', comment: 'No type.' },
      { name: 'Bool', value: '1', comment: 'Boolean type.' },
    ],
    filePath: 'include/milvus/types/DataType.h', lineNumber: 1,
    parentClass: 'Collections', requestClass: null, responseClass: null,
  };
  const doc = cppAdapter.toReferenceDocument(symbol, context('cpp', 'Collections', {
    summary: 'Lists C++ field data types.',
    examples: [],
  }));

  assert.equal(doc.identity.kind, 'enum');
  assert.deepEqual(doc.requestVariants, []);
  assert.deepEqual(doc.callableMembers, []);
  assert.equal(doc.result, null);
  assert.deepEqual(doc.notes.slice(-2), ['None = 0 — No type.', 'Bool = 1 — Boolean type.']);
  assert.equal(validateReferenceDocument(doc, { production: true }).valid, true);
});

test('Python maps supported raw kinds explicitly and represents constants without method sections', () => {
  const classDoc = pythonAdapter.toReferenceDocument({
    name: 'MilvusClient', kind: 'class', signature: 'class MilvusClient:', docstring: 'Milvus client.',
    params: [], filePath: 'pymilvus/milvus_client/milvus_client.py', lineNumber: 24, parentClass: null,
  }, context('python', 'Client'));
  const enumDoc = pythonAdapter.toReferenceDocument({
    name: 'ConsistencyLevel', kind: 'enum', signature: 'class ConsistencyLevel(Enum):', docstring: 'Consistency levels.',
    params: [], filePath: 'pymilvus/client/types.py', lineNumber: 11, parentClass: null,
  }, context('python', 'Collections', { examples: [] }));
  const constantDoc = pythonAdapter.toReferenceDocument({
    name: 'DEFAULT_TIMEOUT', kind: 'constant', signature: 'DEFAULT_TIMEOUT = 30', docstring: null,
    params: [], filePath: 'pymilvus/settings.py', lineNumber: 8, parentClass: null,
  }, context('python', 'Client', { summary: 'Defines the default request timeout.', examples: [] }));

  assert.equal(classDoc.identity.kind, 'class');
  assert.equal(enumDoc.identity.kind, 'enum');
  assert.equal(constantDoc.identity.kind, 'enum');
  assert.deepEqual(constantDoc.requestVariants, []);
  assert.deepEqual(constantDoc.callableMembers, []);
  assert.ok(constantDoc.notes.includes('DEFAULT_TIMEOUT = 30'));
  assert.throws(() => pythonAdapter.toReferenceDocument({ kind: 'mystery' }, {}), /unsupported Python scanner kind/i);
});

test('CLI preserves option metadata and never creates SDK result or error sections', () => {
  const doc = cliAdapter.toReferenceDocument(
    fixture('cli-project-create.json'),
    context('zilliz-cli', 'Project'),
  );

  assert.equal(doc.identity.kind, 'command');
  assert.equal(doc.identity.language, 'zilliz-cli');
  assert.equal(doc.signatures[0].display, 'zilliz project create [OPTIONS]');
  const region = doc.signatures[0].inputs.find((field) => field.name === '--region');
  const plan = doc.signatures[0].inputs.find((field) => field.name === '--plan');
  assert.equal(region.required, true);
  assert.ok(region.constraints.includes('repeatable'));
  assert.ok(region.constraints.includes('choices: aws-us-west-2, gcp-us-west1'));
  assert.ok(region.constraints.includes('shorthand: -r'));
  assert.equal(plan.defaultValue, 'serverless');
  assert.equal(plan.description, 'Subscription plan.');
  assert.equal(doc.result, null);
  assert.deepEqual(doc.errors, []);
});

test('missing context remains missing and fails production validation for every adapter', () => {
  for (const [name, adapter, language] of cases) {
    const doc = adapter.toReferenceDocument(fixture(name), {});
    const validation = validateReferenceDocument(doc, { production: true });

    assert.equal(doc.examples.length, 0, language);
    assert.equal(doc.evidence.length, 0, language);
    assert.equal(validation.valid, false, language);
    assert.ok(validation.errors.some((error) => error.path === '$.source.repository'), language);
    assert.ok(validation.errors.some((error) => error.code === 'MISSING_EVIDENCE'), language);
    if (!['enum'].includes(doc.identity.kind)) {
      assert.ok(validation.errors.some((error) => error.path === '$.examples'), language);
    }
  }
});

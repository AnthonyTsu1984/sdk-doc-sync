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
  return {
    repository: `example/${language}-sdk`,
    revision: 'v2.6.0',
    category,
    summary: `Production summary for the ${language} operation.`,
    examples: [{
      title: 'Create or search example',
      description: 'Uses explicit test values.',
      language,
      code: language === 'zilliz-cli'
        ? 'zilliz project create --name docs --region aws-us-west-2'
        : `${language}Client.callOperation({ name: "docs" });`,
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
  const doc = javaAdapter.toReferenceDocument(symbol, context('java', 'Collections'));

  assert.equal(doc.requestVariants[0].id, 'CreateCollectionReq');
  assert.deepEqual(doc.callableMembers.map((member) => member.kind), ['builder', 'builder', 'builder']);
  assert.equal(doc.callableMembers[0].name, 'collectionName');
  assert.equal(doc.callableMembers[0].signature.display, 'collectionName(String collectionName)');
  assert.equal(doc.callableMembers[0].signature.inputs[0].name, 'collectionName');
  assert.equal(doc.callableMembers[0].signature.inputs[0].type.display, 'String');

  const withoutRequest = javaAdapter.toReferenceDocument(
    { ...symbol, requestClass: null },
    context('java', 'Collections'),
  );
  assert.deepEqual(withoutRequest.requestVariants, []);
  assert.deepEqual(withoutRequest.callableMembers, []);
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
  const doc = cppAdapter.toReferenceDocument(
    fixture('cpp-create-collection.json'),
    context('cpp', 'Collections', {
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

test('missing context remains missing and fails production validation', () => {
  const doc = pythonAdapter.toReferenceDocument(fixture('python-search.json'), {});
  const validation = validateReferenceDocument(doc, { production: true });

  assert.equal(doc.examples.length, 0);
  assert.equal(doc.evidence.length, 0);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.path === '$.source.repository'));
  assert.ok(validation.errors.some((error) => error.path === '$.examples'));
  assert.ok(validation.errors.some((error) => error.code === 'MISSING_EVIDENCE'));
});

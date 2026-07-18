'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validateReferenceDocument } = require('../src/sdk-reference-ir/validate');
const { validateDocumentIr } = require('../src/document-ir/validate');
const { renderMarkdown } = require('../src/document-ir/ir-to-markdown');
const pythonAdapter = require('../src/sdk-reference-ir/adapters/python');
const javaAdapter = require('../src/sdk-reference-ir/adapters/java');
const nodeAdapter = require('../src/sdk-reference-ir/adapters/node');
const goAdapter = require('../src/sdk-reference-ir/adapters/go');
const cppAdapter = require('../src/sdk-reference-ir/adapters/cpp');
const pythonRenderer = require('../src/renderers/languages/python');
const javaRenderer = require('../src/renderers/languages/java');
const nodeRenderer = require('../src/renderers/languages/node');
const goRenderer = require('../src/renderers/languages/go');
const cppRenderer = require('../src/renderers/languages/cpp');

const scannerDir = path.join(__dirname, 'fixtures', 'scanners');
const goldenDir = path.join(__dirname, 'fixtures', 'golden', 'sdk');

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(scannerDir, name), 'utf8'));
}

function sourceEvidence(language) {
  return [{
    kind: 'curated',
    locator: `reviews/${language}-renderer.md`,
    revision: 'v2.6.0',
    confidence: 'reviewed',
  }];
}

function context(language) {
  const values = {
    python: {
      repository: 'milvus-io/pymilvus', category: 'Vector',
      summary: 'Searches vectors in a collection and returns the nearest matches.',
      examples: [{
        title: 'Search a collection', description: 'Runs a vector search.', language: 'python',
        code: 'results = client.search(collection_name="docs", data=[[0.1, 0.2]], limit=10)\nprint(results)',
      }],
      result: {
        type: 'list[SearchResult]',
        description: 'Returns the matching entities ordered by similarity.',
        fields: [{
          name: 'items', type: 'SearchResult[]', required: true,
          description: 'The matching entities.',
          children: [{ name: 'score', type: 'float', required: true, description: 'The similarity score.' }],
        }],
      },
      exceptions: [{
        name: 'MilvusException', condition: 'The server rejects the search request.',
        description: 'Reports the server error code and message.',
      }],
      typeUrls: {
        str: '/reference/python/str',
        'list[SearchResult]': '/reference/python/search-result',
        'SearchResult[]': '/reference/python/search-result',
      },
    },
    java: {
      repository: 'zilliztech/milvus-sdk-java', category: 'Collections',
      summary: 'Creates a collection through the Java v2 client.', requiredFields: ['collectionName', 'dimension'],
      examples: [{
        title: 'Create a collection', description: 'Builds and submits a collection request.', language: 'java',
        code: 'client.createCollection(CreateCollectionReq.builder()\n    .collectionName("docs")\n    .dimension(128)\n    .build());',
      }],
      result: { type: 'void', description: 'Completes after the collection is created.', fields: [] },
      exceptions: [{
        name: 'MilvusClientException', condition: 'The request cannot be completed.',
        description: 'Reports client or server failures.',
      }],
      typeUrls: { MetricType: '/reference/java/metric-type' },
    },
    node: {
      repository: 'zilliztech/milvus-sdk-node', category: 'Collections',
      summary: 'Creates a collection through the Node.js client.',
      examples: [{
        title: 'JavaScript example', description: 'Creates a simple collection with JavaScript.', language: 'node',
        fence: 'JavaScript',
        code: 'await client.createCollection({ collection_name: "docs", dimension: 128 });',
      }, {
        title: 'TypeScript example', description: 'Creates a typed collection request.', language: 'node',
        fence: 'TypeScript',
        code: 'const request: SimpleCreateCollectionReq = { collection_name: "docs", dimension: 128 };\nawait client.createCollection(request);',
      }],
      exceptions: [{
        name: 'MilvusError', condition: 'The promise is rejected.',
        description: 'Contains the operation failure details.',
      }],
      typeUrls: {
        'FieldType[]': '/reference/node/field-type',
        DataType: '/reference/node/data-type',
        'Promise<CreateCollectionResponse>': '/reference/node/create-collection-response',
      },
    },
    go: {
      repository: 'milvus-io/milvus-sdk-go', category: 'Collections',
      summary: 'Creates a collection through the Go client.',
      requestSyntax: 'option := milvusclient.SimpleCreateCollectionOptions("docs", 128)\nerr := client.CreateCollection(ctx, option)',
      examples: [{
        title: 'Create a collection', description: 'Creates a collection and checks the returned error.', language: 'go',
        code: 'option := milvusclient.SimpleCreateCollectionOptions("docs", 128)\nerr := client.CreateCollection(ctx, option)\nif err != nil {\n    log.Fatal(err)\n}',
      }],
      result: { type: 'error', description: 'Returns nil on success or an error on failure.', fields: [] },
      exceptions: [{
        name: 'error', condition: 'The operation fails.',
        description: 'Check the returned error for failure details.',
      }],
      typeUrls: { 'entity.MetricType': '/reference/go/metric-type' },
    },
    cpp: {
      repository: 'zilliztech/milvus-sdk-cpp', category: 'Collections',
      summary: 'Creates a collection through the C++ client.',
      examples: [{
        title: 'Create a collection', description: 'Builds a request and checks the returned status.', language: 'cpp',
        code: 'auto request = milvus::CreateCollectionRequest().WithCollectionName("docs").WithDimension(128);\nauto status = client->CreateCollection(request, response);\nif (!status.IsOk()) {\n    std::cout << status.Message() << std::endl;\n}',
      }],
      result: {
        type: 'Status', description: 'Returns the operation status and fills the response object.',
        fields: [{
          name: 'response', type: 'CreateCollectionResponse', required: true,
          description: 'The created collection response.',
        }],
      },
      exceptions: [{
        name: 'Status', condition: 'status.IsOk() is false.',
        description: 'Inspect the status code and message for failure details.',
      }],
      memberInputs: {
        AddExtraParam: [
          { name: 'key', type: 'std::string', description: 'The extra parameter key.' },
          { name: 'value', type: 'std::string', description: 'The extra parameter value.' },
        ],
      },
      typeUrls: { CreateCollectionResponse: '/reference/cpp/create-collection-response' },
    },
  }[language];
  return {
    ...values,
    revision: 'v2.6.0',
    reviewedEvidence: sourceEvidence(language),
    notes: ['Use a client connected to the target Milvus deployment.'],
    related: [{ title: 'Collection guide', url: '/docs/collections' }],
    audienceVariants: [{ audience: 'milvus', summary: 'Available to Milvus users.' }],
  };
}

function enrich(language, symbol) {
  if (language === 'python') {
    const descriptions = {
      collection_name: 'The name of the target collection.',
      data: 'The query vectors.',
      limit: 'The maximum number of matches to return.',
      kwargs: 'Additional search options.',
    };
    symbol.params = symbol.params.map((field) => field.name === '*' ? field : {
      ...field,
      description: descriptions[field.name],
      ...(field.name === 'limit' ? { choices: [10, 20], constraints: ['Must be positive.'] } : {}),
    });
  }
  if (language === 'java') {
    const descriptions = {
      collectionName: 'The name of the collection to create.',
      dimension: 'The vector field dimension.',
      metricType: 'The metric used to compare vectors.',
    };
    symbol.params = symbol.params.map((field) => ({ ...field, description: descriptions[field.name] }));
  }
  if (language === 'node') {
    symbol.requestVariants[0].inputs[1].constraints = ['Must be positive.'];
  }
  if (language === 'go') {
    symbol.params = symbol.params.map((field) => ({
      ...field,
      description: field.name === 'collectionName'
        ? 'The name of the collection to create.'
        : 'The vector field dimension.',
    }));
    symbol.optionMethods = symbol.optionMethods.map((member) => ({
      ...member,
      description: member.description.replace(/^Sets/, 'This sets'),
    }));
  }
  if (language === 'cpp') {
    symbol.params.push({
      name: 'EnableDynamicField', kind: 'keyword', type: 'bool',
      fullArgStr: '', fullSignature: 'EnableDynamicField()',
      description: 'Enables the dynamic field.',
    });
    symbol.params.push({
      name: 'AddExtraParam', kind: 'keyword', type: 'std::string',
      fullArgStr: 'const std::string& key, const std::string& value',
      fullSignature: 'AddExtraParam(const std::string& key, const std::string& value)',
      description: 'Adds an extra request parameter.',
    });
  }
  return symbol;
}

const cases = [
  { language: 'python', fixture: 'python-search.json', adapter: pythonAdapter, renderer: pythonRenderer, golden: 'python-search.md' },
  { language: 'java', fixture: 'java-create-collection.json', adapter: javaAdapter, renderer: javaRenderer, golden: 'java-create-collection.md' },
  { language: 'node', fixture: 'node-create-collection.json', adapter: nodeAdapter, renderer: nodeRenderer, golden: 'node-create-collection.md' },
  { language: 'go', fixture: 'go-create-collection.json', adapter: goAdapter, renderer: goRenderer, golden: 'go-create-collection.md' },
  { language: 'cpp', fixture: 'cpp-create-collection.json', adapter: cppAdapter, renderer: cppRenderer, golden: 'cpp-create-collection.md' },
];

function renderCase(item) {
  const symbol = enrich(item.language, fixture(item.fixture));
  const adapterContext = context(item.language);
  const reference = item.adapter.toReferenceDocument(symbol, adapterContext);
  const referenceValidation = validateReferenceDocument(reference, { production: true });
  assert.equal(referenceValidation.valid, true, `${item.language}: ${JSON.stringify(referenceValidation.errors)}`);
  const before = JSON.stringify(reference);
  const first = item.renderer.render(reference, { typeUrls: adapterContext.typeUrls });
  const second = item.renderer.render(reference, { typeUrls: adapterContext.typeUrls });
  assert.equal(JSON.stringify(reference), before, `${item.language} renderer mutated Reference IR`);
  assert.deepEqual(first, second, `${item.language} Document IR is not deterministic`);
  assert.equal(Object.isFrozen(first), true, `${item.language} Document IR is mutable`);
  assert.deepEqual(validateDocumentIr(first), { valid: true, errors: [], warnings: [] });
  const markdown = renderMarkdown(first);
  assert.equal(markdown, renderMarkdown(second), `${item.language} Markdown is not byte-stable`);
  return { reference, ir: first, markdown };
}

test('scanner fixtures render through production Reference IR and lossless Document IR to language goldens', () => {
  for (const item of cases) {
    const { ir, markdown } = renderCase(item);
    const golden = fs.readFileSync(path.join(goldenDir, item.golden), 'utf8');
    assert.equal(markdown, golden, item.language);
    assert.ok(ir.children.some((node) => node.type === 'audience'), `${item.language} audience missing`);
    assert.doesNotMatch(markdown, /\b(?:TODO|TBD)\b|Brief description|Usage example/i, item.language);
    assert.doesNotMatch(markdown, /reviews\/|pymilvus\/milvus_client\/milvus_client\.py:372/, item.language);
  }
});

test('language policies control exact sections, fences, and conditional request rendering', () => {
  const rendered = Object.fromEntries(cases.map((item) => [item.language, renderCase(item).markdown]));

  assert.match(rendered.python, /## Request Syntax\{#request-syntax\}/);
  assert.match(rendered.python, /\*\*PARAMETERS:\*\*/);
  assert.match(rendered.python, /\*\*RETURN TYPE:\*\*[\s\S]*\*\*RETURNS:\*\*/);
  assert.match(rendered.python, /## Examples\n/);
  assert.match(rendered.python, /### Search a collection/);
  assert.match(rendered.python, /\[str\]\(\/reference\/python\/str\)/);

  const pythonContext = context('python');
  const pythonReference = pythonAdapter.toReferenceDocument(
    enrich('python', fixture('python-search.json')),
    pythonContext,
  );
  const unsafeTypeMarkdown = renderMarkdown(pythonRenderer.render(pythonReference, {
    typeUrls: { ...pythonContext.typeUrls, str: '//unsafe.example.test/str' },
  }));
  assert.doesNotMatch(unsafeTypeMarkdown, /unsafe\.example\.test/);
  assert.match(unsafeTypeMarkdown, /\(\*str\*\)/);

  assert.match(rendered.java, /```java\npublic void createCollection/);
  assert.match(rendered.java, /## Request Syntax\{#request-syntax\}/);
  assert.match(rendered.java, /\*\*BUILDER METHODS:\*\*/);
  assert.match(rendered.java, /## Example\{#example\}/);
  assert.match(rendered.java, /### Create a collection/);

  assert.match(rendered.go, /```go\n/);
  assert.match(rendered.go, /\*\*PARAMETERS:\*\*/);
  assert.match(rendered.go, /\*\*OPTION METHODS:\*\*/);
  assert.match(rendered.go, /\*\*RETURN TYPE:\*\*[\s\S]*\*\*RETURNS:\*\*/);
  assert.match(rendered.go, /\*\*ERROR HANDLING:\*\*/);
  assert.doesNotMatch(rendered.go, /\*\*EXCEPTIONS:\*\*/);
  assert.match(rendered.go, /SimpleCreateCollectionOptions\("docs", 128\)[\s\S]*client\.CreateCollection\(ctx, option\)/);

  assert.match(rendered.node, /```typescript\nclient\.createCollection/);
  assert.match(rendered.node, /### JavaScript example[\s\S]*```javascript\nawait client\.createCollection/);
  assert.match(rendered.node, /### TypeScript example[\s\S]*```typescript\nconst request: SimpleCreateCollectionReq/);
  assert.match(rendered.node, /### Simple collection[\s\S]*### Custom schema/);
  assert.doesNotMatch(rendered.node, /```python|def createCollection|BUILDER METHODS/);

  assert.match(rendered.cpp, /```c\+\+\n/);
  assert.match(rendered.cpp, /\*\*REQUEST METHODS:\*\*/);
  assert.match(rendered.cpp, /\.EnableDynamicField\(\)/);
  assert.match(rendered.cpp, /\.AddExtraParam\(key, value\);/);
  assert.match(rendered.cpp, /\*\*ERROR HANDLING:\*\*/);
  assert.doesNotMatch(rendered.cpp, /\*\*EXCEPTIONS:\*\*/);
  assert.match(rendered.cpp, /status code and message/);

  const direct = fixture('java-create-collection.json');
  direct.requestClass = null;
  direct.params = [];
  const directContext = context('java');
  const directReference = javaAdapter.toReferenceDocument(direct, directContext);
  assert.equal(validateReferenceDocument(directReference, { production: true }).valid, true);
  const directMarkdown = renderMarkdown(javaRenderer.render(directReference, { typeUrls: directContext.typeUrls }));
  assert.doesNotMatch(directMarkdown, /Request Syntax|BUILDER METHODS/);
});

test('Go request syntax is explicit Reference IR metadata and is independent from examples', () => {
  const symbol = enrich('go', fixture('go-create-collection.json'));
  const originalContext = context('go');
  const changedExampleContext = {
    ...originalContext,
    examples: originalContext.examples.map((example) => ({
      ...example,
      code: 'fmt.Println("example changed without changing request syntax")',
    })),
  };
  const original = goAdapter.toReferenceDocument(symbol, originalContext);
  const changed = goAdapter.toReferenceDocument(symbol, changedExampleContext);
  assert.equal(original.requestVariants[0].signature.display, originalContext.requestSyntax);
  assert.equal(changed.requestVariants[0].signature.display, originalContext.requestSyntax);

  const originalMarkdown = renderMarkdown(goRenderer.render(original));
  const changedMarkdown = renderMarkdown(goRenderer.render(changed));
  const requestSection = (value) => value.match(/## Request Syntax\{#request-syntax\}[\s\S]*?(?=\n\*\*PARAMETERS:)/)?.[0];
  assert.equal(requestSection(changedMarkdown), requestSection(originalMarkdown));

  const withoutRequestContext = { ...originalContext };
  delete withoutRequestContext.requestSyntax;
  const withoutRequest = goAdapter.toReferenceDocument(symbol, withoutRequestContext);
  assert.deepEqual(withoutRequest.requestVariants, []);
  assert.doesNotMatch(renderMarkdown(goRenderer.render(withoutRequest)), /Request Syntax/);
});

test('example fence metadata is validated and preserved with example titles', () => {
  const nodeContext = context('node');
  const reference = nodeAdapter.toReferenceDocument(enrich('node', fixture('node-create-collection.json')), nodeContext);
  assert.deepEqual(reference.examples.map((example) => [example.title, example.fence]), [
    ['JavaScript example', 'JavaScript'],
    ['TypeScript example', 'TypeScript'],
  ]);
  assert.equal(validateReferenceDocument(reference, { production: true }).valid, true);

  const malformed = nodeAdapter.toReferenceDocument(fixture('node-create-collection.json'), {
    ...nodeContext,
    examples: [{ ...nodeContext.examples[0], fence: 'bad fence' }],
  });
  assert.ok(validateReferenceDocument(malformed).errors.some((error) => error.code === 'INVALID_EXAMPLE_FENCE'
    && error.path === '$.examples[0].fence'));
});

test('empty field and member descriptions do not create blank list paragraphs', () => {
  const javaContext = context('java');
  const reference = javaAdapter.toReferenceDocument(fixture('java-create-collection.json'), javaContext);
  const rendered = javaRenderer.render(reference);
  const memberList = rendered.children.find((node) => node.type === 'unorderedList'
    && node.metadata?.role === 'member');
  assert.ok(memberList);
  assert.equal(memberList.items[0].children.length, 1);

  const emptyParagraph = JSON.stringify(rendered).includes('"type":"paragraph","children":[{"type":"text","value":""');
  assert.equal(emptyParagraph, false);
});

test('parameter, member, result, and error lists keep signature and description as separate logical blocks', () => {
  for (const item of cases) {
    const { ir } = renderCase(item);
    const lists = [];
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'unorderedList' && ['field', 'member', 'result', 'error'].includes(node.metadata?.role)) {
        lists.push(node);
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') visit(value);
      }
    };
    visit(ir);
    assert.ok(lists.length > 0, `${item.language} has no focused lists`);
    for (const list of lists) {
      for (const listItem of list.items) {
        assert.equal(listItem.children[0]?.type, 'paragraph', `${item.language} missing signature paragraph`);
        assert.equal(listItem.children[1]?.type, 'paragraph', `${item.language} missing description paragraph`);
      }
    }
  }
});

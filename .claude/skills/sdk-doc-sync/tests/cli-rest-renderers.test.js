const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cliAdapter = require('../src/sdk-reference-ir/adapters/zilliz-cli');
const openapiAdapter = require('../src/sdk-reference-ir/adapters/openapi');
const cliRenderer = require('../src/renderers/cli-renderer');
const restRenderer = require('../src/renderers/rest-renderer');
const { validateReferenceDocument } = require('../src/sdk-reference-ir/validate');
const { validateDocumentIr } = require('../src/document-ir/validate');
const { renderMarkdown } = require('../src/document-ir/ir-to-markdown');

const scannerDir = path.join(__dirname, 'fixtures', 'scanners');
const goldenDir = path.join(__dirname, 'fixtures', 'golden');

function jsonFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(scannerDir, name), 'utf8'));
}

function golden(kind, name) {
  return fs.readFileSync(path.join(goldenDir, kind, name), 'utf8');
}

function reviewedEvidence(locator) {
  return [{ kind: 'curated', locator, revision: 'v2.6.0', confidence: 'reviewed' }];
}

test('CLI scanner pipeline renders the exact command golden without SDK-only sections', () => {
  const symbol = jsonFixture('cli-project-create.json');
  const before = JSON.stringify(symbol);
  const context = {
    repository: 'zilliztech/zilliz-cli',
    revision: 'v2.6.0',
    category: 'Project',
    title: 'zilliz project create',
    summary: 'Creates a Zilliz Cloud project.',
    examples: [{
      title: 'Create a project',
      description: '',
      language: 'zilliz-cli',
      code: 'zilliz project create --name docs --region aws-us-west-2 --plan serverless',
      fence: 'Bash',
    }],
    notes: ['The --api-key option overrides the configured API key for this command.'],
    related: [],
    reviewedEvidence: reviewedEvidence('reviews/cli-project-create.md'),
  };

  const reference = cliAdapter.toReferenceDocument(symbol, context);
  assert.equal(validateReferenceDocument(reference, { production: true }).valid, true);
  const options = Object.fromEntries(reference.signatures[0].inputs.map((field) => [field.name, field]));
  assert.equal(options['--name'].required, true);
  assert.equal(options['--plan'].required, false);
  assert.equal(options['--plan'].defaultValue, 'serverless');
  assert.equal(options['--plan'].allowRequiredDefault, false);
  const documentIr = cliRenderer.render(reference);
  assert.equal(validateDocumentIr(documentIr).valid, true);
  const first = renderMarkdown(documentIr);
  const second = renderMarkdown(cliRenderer.render(reference));

  assert.equal(JSON.stringify(symbol), before);
  assert.equal(first, second);
  assert.equal(first, golden('cli', 'project-create.md'));
  assert.doesNotMatch(first, /RETURNS:|RETURN TYPE:|EXCEPTIONS:|ERROR HANDLING:/);
  assert.match(first, /```bash\n/);
  assert.doesNotMatch(first, /\*\*--plan\*\*.*\\\[REQUIRED\\\]/);
  assert.match(first, /choices: serverless, dedicated/);
  assert.match(first, /repeatable/);
  assert.match(first, /API key/);
  assert.doesNotMatch(first, /TODO|TBD|Brief description|Usage example/i);
});

function restInput(spec = jsonFixture('openapi-create-collection.json')) {
  return { spec, path: '/v2/vectordb/collections', method: 'post' };
}

function restContext() {
  return {
    repository: 'zilliztech/cloud-openapi',
    revision: '2026-07-18',
    file: 'openapi/data-plane.json',
    line: 1,
    category: 'Collections',
    related: [],
    notes: [],
  };
}

test('OpenAPI pipeline normalizes production-valid HTTP metadata and renders the REST golden', () => {
  const input = restInput();
  const before = JSON.stringify(input);
  const reference = openapiAdapter.toReferenceDocument(input, restContext());
  const validation = validateReferenceDocument(reference, { production: true });

  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  assert.equal(reference.identity.kind, 'rest-operation');
  assert.equal(reference.identity.language, 'rest');
  assert.equal(reference.http.method, 'POST');
  assert.equal(reference.http.path, '/v2/vectordb/collections');
  assert.equal(reference.http.auth[0].name, 'ApiKeyAuth');
  assert.equal(reference.http.security.length, 1);
  assert.deepEqual(reference.http.security[0].schemes.map((scheme) => scheme.name), ['ApiKeyAuth']);
  assert.equal(reference.http.request.contentType, 'application/json');
  assert.deepEqual(reference.http.request.query.map((field) => field.name), ['dbName']);
  assert.deepEqual(reference.http.request.header.map((field) => field.name), ['X-Request-ID']);
  assert.deepEqual(reference.http.request.body.map((field) => field.name), [
    'collectionName', 'dimension', 'consistencyLevel', 'schema',
  ]);
  const consistency = reference.http.request.body[2];
  assert.equal(consistency.defaultValue, 'Bounded');
  assert.ok(consistency.constraints.includes('enum: Strong, Bounded, Eventually'));
  assert.equal(reference.http.request.body[3].children[0].children[0].name, 'name');
  assert.deepEqual(reference.http.responses.map((response) => response.status), ['200', '400']);
  assert.equal(reference.http.responses[0].fields[1].children[0].name, 'collectionName');
  assert.equal(
    reference.http.request.body[0].evidence[0].locator,
    '#/components/schemas/CreateCollectionRequest/properties/collectionName',
  );
  assert.equal(
    reference.http.responses[0].evidence[0].locator,
    '#/paths/~1v2~1vectordb~1collections/post/responses/200',
  );

  const documentIr = restRenderer.render(reference);
  assert.equal(validateDocumentIr(documentIr).valid, true);
  const first = renderMarkdown(documentIr);
  const second = renderMarkdown(restRenderer.render(reference));
  assert.equal(JSON.stringify(input), before);
  assert.equal(first, second);
  assert.equal(first, golden('rest', 'create-collection.md'));
  assert.match(first, /## Authentication/);
  assert.match(first, /### Query/);
  assert.match(first, /### Header/);
  assert.match(first, /### Body/);
  assert.match(first, /### 200/);
  assert.match(first, /### 400/);
  assert.match(first, /```bash\n/);
  assert.match(first, /```json\n/);
  assert.doesNotMatch(first, /TODO|TBD|Brief description|Usage example/i);
});

test('OpenAPI resolver handles nested local refs and rejects missing, cyclic, and remote refs', () => {
  const resolved = openapiAdapter.toReferenceDocument(restInput(), restContext());
  assert.equal(resolved.http.request.body[3].children[0].children[1].name, 'dataType');

  const pathParameter = jsonFixture('openapi-create-collection.json');
  pathParameter.paths['/v2/vectordb/collections'].parameters = [{
    name: 'tenant', in: 'header', required: true, description: 'Tenant identifier.', schema: { type: 'string' },
  }];
  const withPathParameter = openapiAdapter.toReferenceDocument(restInput(pathParameter), restContext());
  const tenant = withPathParameter.http.request.header.find((field) => field.name === 'tenant');
  assert.equal(
    tenant.evidence[0].locator,
    '#/paths/~1v2~1vectordb~1collections/parameters/0',
  );

  const missing = jsonFixture('openapi-create-collection.json');
  missing.paths['/v2/vectordb/collections'].post.requestBody.content['application/json'].schema.$ref = '#/components/schemas/Missing';
  assert.throws(() => openapiAdapter.toReferenceDocument(restInput(missing), restContext()), /missing OpenAPI reference/i);

  const cyclic = jsonFixture('openapi-create-collection.json');
  cyclic.components.schemas.CycleA = { $ref: '#/components/schemas/CycleB' };
  cyclic.components.schemas.CycleB = { $ref: '#/components/schemas/CycleA' };
  cyclic.paths['/v2/vectordb/collections'].post.requestBody.content['application/json'].schema = { $ref: '#/components/schemas/CycleA' };
  assert.throws(() => openapiAdapter.toReferenceDocument(restInput(cyclic), restContext()), /OpenAPI reference cycle/i);

  const remote = jsonFixture('openapi-create-collection.json');
  remote.paths['/v2/vectordb/collections'].post.requestBody.content['application/json'].schema.$ref = 'https://example.test/schema.json';
  assert.throws(() => openapiAdapter.toReferenceDocument(restInput(remote), restContext()), /remote OpenAPI references are not supported/i);
});

test('OpenAPI operation parameters override path parameters by location and name without duplicates', () => {
  const spec = jsonFixture('openapi-create-collection.json');
  const pathItem = spec.paths['/v2/vectordb/collections'];
  pathItem.parameters = [
    { name: 'dbName', in: 'query', description: 'Path-level database.', schema: { type: 'string', default: 'path-default' } },
    { name: 'tenant', in: 'header', required: true, description: 'Tenant identifier.', schema: { type: 'string' } },
  ];
  const operationDbName = pathItem.post.parameters.find((parameter) => parameter.name === 'dbName');
  operationDbName.description = 'Operation database.';
  operationDbName.schema.default = 'operation-default';

  const reference = openapiAdapter.toReferenceDocument(restInput(spec), restContext());
  assert.deepEqual(reference.http.request.query.map((field) => field.name), ['dbName']);
  assert.equal(reference.http.request.query[0].description, 'Operation database.');
  assert.equal(reference.http.request.query[0].defaultValue, 'operation-default');
  assert.equal(
    reference.http.request.query[0].evidence[0].locator,
    '#/paths/~1v2~1vectordb~1collections/post/parameters/0',
  );
  assert.deepEqual(reference.http.request.header.map((field) => field.name), ['tenant', 'X-Request-ID']);
});

test('OpenAPI allOf composes local object schemas and unsupported combinators fail explicitly', () => {
  const spec = jsonFixture('openapi-create-collection.json');
  spec.components.schemas.BaseRequest = {
    type: 'object',
    required: ['collectionName'],
    properties: {
      collectionName: { type: 'string', description: 'Collection name from the base schema.' },
    },
  };
  spec.components.schemas.CreateCollectionRequest = {
    description: 'Composed request.',
    allOf: [
      { $ref: '#/components/schemas/BaseRequest' },
      {
        type: 'object',
        required: ['dimension'],
        properties: {
          dimension: { type: 'integer', format: 'int64', description: 'Vector dimension.' },
        },
      },
    ],
  };
  const reference = openapiAdapter.toReferenceDocument(restInput(spec), restContext());
  assert.deepEqual(reference.http.request.body.map((field) => [field.name, field.required]), [
    ['collectionName', true],
    ['dimension', true],
  ]);
  assert.equal(reference.http.request.body[0].description, 'Collection name from the base schema.');
  assert.equal(
    reference.http.request.body[0].evidence[0].locator,
    '#/components/schemas/BaseRequest/properties/collectionName',
  );

  const conflict = jsonFixture('openapi-create-collection.json');
  conflict.components.schemas.CreateCollectionRequest = {
    allOf: [
      { type: 'object', properties: { value: { type: 'string' } } },
      { type: 'object', properties: { value: { type: 'integer' } } },
    ],
  };
  assert.throws(
    () => openapiAdapter.toReferenceDocument(restInput(conflict), restContext()),
    /OPENAPI_ALLOF_CONFLICT.*CreateCollectionRequest.*value/i,
  );

  for (const combinator of ['oneOf', 'anyOf', 'not']) {
    const unsupported = jsonFixture('openapi-create-collection.json');
    unsupported.components.schemas.CreateCollectionRequest = {
      type: 'object',
      [combinator]: combinator === 'not' ? { type: 'string' } : [{ type: 'string' }],
    };
    assert.throws(
      () => openapiAdapter.toReferenceDocument(restInput(unsupported), restContext()),
      new RegExp(`OPENAPI_UNSUPPORTED_COMBINATOR.*CreateCollectionRequest.*${combinator}`, 'i'),
    );
  }

  const discriminator = jsonFixture('openapi-create-collection.json');
  discriminator.components.schemas.CreateCollectionRequest = {
    type: 'object', discriminator: { propertyName: 'kind' }, properties: { kind: { type: 'string' } },
  };
  assert.throws(
    () => openapiAdapter.toReferenceDocument(restInput(discriminator), restContext()),
    /OPENAPI_UNSUPPORTED_COMBINATOR.*CreateCollectionRequest.*discriminator/i,
  );
});

test('OpenAPI recursive schemas fail explicitly instead of silently losing fields', () => {
  const spec = jsonFixture('openapi-create-collection.json');
  spec.components.schemas.CreateCollectionRequest = {
    type: 'object',
    properties: { child: { $ref: '#/components/schemas/CreateCollectionRequest' } },
  };
  assert.throws(
    () => openapiAdapter.toReferenceDocument(restInput(spec), restContext()),
    /OpenAPI reference cycle/i,
  );
});

test('OpenAPI security preserves OR alternatives, AND schemes, OAuth scopes, and anonymous access', () => {
  const spec = jsonFixture('openapi-create-collection.json');
  spec.components.securitySchemes.OAuth = {
    type: 'oauth2',
    description: 'OAuth access token.',
    flows: { clientCredentials: { tokenUrl: 'https://example.test/token', scopes: { 'collections:write': 'Create collections.' } } },
  };
  spec.paths['/v2/vectordb/collections'].post.security = [
    { ApiKeyAuth: [], OAuth: ['collections:write'] },
    { OAuth: ['collections:read'] },
    {},
  ];
  const reference = openapiAdapter.toReferenceDocument(restInput(spec), restContext());
  assert.equal(reference.http.security.length, 3);
  assert.deepEqual(reference.http.security[0].schemes.map((scheme) => [scheme.name, scheme.scopes]), [
    ['ApiKeyAuth', []],
    ['OAuth', ['collections:write']],
  ]);
  assert.deepEqual(reference.http.security[1].schemes[0].scopes, ['collections:read']);
  assert.equal(reference.http.security[2].anonymous, true);
  assert.equal(validateReferenceDocument(reference, { production: true }).valid, true);

  const markdown = renderMarkdown(restRenderer.render(reference));
  assert.match(markdown, /Use one of:/);
  assert.match(markdown, /All of:/);
  assert.match(markdown, /Scopes: collections:write/);
  assert.match(markdown, /Anonymous access/);
});

test('OpenAPI examples retain selected media-type evidence pointers', () => {
  const spec = jsonFixture('openapi-create-collection.json');
  const operation = spec.paths['/v2/vectordb/collections'].post;
  const requestJson = operation.requestBody.content['application/json'];
  operation.requestBody.content = { 'application/merge-patch+json': requestJson };
  const responseJson = operation.responses['200'].content['application/json'];
  operation.responses['200'].content = { 'application/problem+json': responseJson };

  const reference = openapiAdapter.toReferenceDocument(restInput(spec), restContext());
  const requestExample = reference.examples.find((example) => example.title === 'Request body');
  const responseExample = reference.examples.find((example) => example.title === '200 response');
  assert.equal(
    requestExample.evidence[0].locator,
    '#/paths/~1v2~1vectordb~1collections/post/requestBody/content/application~1merge-patch+json/example',
  );
  assert.equal(
    responseExample.evidence[0].locator,
    '#/paths/~1v2~1vectordb~1collections/post/responses/200/content/application~1problem+json/example',
  );
});

test('HTTP validation restricts methods and status keys while OpenAPI responses render in semantic order', () => {
  const spec = jsonFixture('openapi-create-collection.json');
  const responses = spec.paths['/v2/vectordb/collections'].post.responses;
  responses.default = { description: 'Fallback response.' };
  responses['5XX'] = { description: 'Server error.' };
  responses['201'] = { description: 'Created response.' };
  responses['101'] = { description: 'Switching protocols.' };
  const reference = openapiAdapter.toReferenceDocument(restInput(spec), restContext());
  assert.deepEqual(reference.http.responses.map((response) => response.status), ['101', '200', '201', '400', '5XX', 'default']);

  const invalidMethod = JSON.parse(JSON.stringify(reference));
  invalidMethod.http.method = 'FETCH';
  const methodValidation = validateReferenceDocument(invalidMethod);
  assert.ok(methodValidation.errors.some((error) => error.code === 'INVALID_HTTP_METHOD'));

  for (const status of ['99', '600', '20X', 'DEFAULT']) {
    const invalidStatus = JSON.parse(JSON.stringify(reference));
    invalidStatus.http.responses[0].status = status;
    const validation = validateReferenceDocument(invalidStatus);
    assert.ok(validation.errors.some((error) => error.code === 'INVALID_HTTP_STATUS'), status);
  }
});

test('REST production validation requires HTTP evidence and examples', () => {
  const valid = openapiAdapter.toReferenceDocument(restInput(), restContext());
  for (const mutate of [
    (doc) => { doc.http.evidence = []; },
    (doc) => { doc.http.auth[0].evidence = []; },
    (doc) => { doc.http.request.evidence = []; },
    (doc) => { doc.http.responses[0].evidence = []; },
    (doc) => { doc.examples = []; },
  ]) {
    const candidate = JSON.parse(JSON.stringify(valid));
    mutate(candidate);
    const validation = validateReferenceDocument(candidate, { production: true });
    assert.equal(validation.valid, false);
  }

  const wrongFamily = JSON.parse(JSON.stringify(valid));
  wrongFamily.identity.kind = 'method';
  wrongFamily.identity.language = 'node';
  const familyValidation = validateReferenceDocument(wrongFamily);
  assert.equal(familyValidation.valid, false);
  assert.ok(familyValidation.errors.some((error) => error.code === 'HTTP_METADATA_WRONG_FAMILY'));
});

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
  assert.equal(options['--plan'].required, true);
  assert.equal(options['--plan'].defaultValue, 'serverless');
  const documentIr = cliRenderer.render(reference);
  assert.equal(validateDocumentIr(documentIr).valid, true);
  const first = renderMarkdown(documentIr);
  const second = renderMarkdown(cliRenderer.render(reference));

  assert.equal(JSON.stringify(symbol), before);
  assert.equal(first, second);
  assert.equal(first, golden('cli', 'project-create.md'));
  assert.doesNotMatch(first, /RETURNS:|RETURN TYPE:|EXCEPTIONS:|ERROR HANDLING:/);
  assert.match(first, /```bash\n/);
  assert.match(first, /\*\*--plan\*\*.*\\\[REQUIRED\\\]/);
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

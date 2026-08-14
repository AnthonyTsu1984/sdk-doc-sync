const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {inventoryOpenApi} = require('../src/rest-track/openapi-inventory');

const fixtureDir = path.join(__dirname, 'fixtures', 'rest-track');

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
}

test('inventories one operation and its public contract elements', () => {
  const inventory = inventoryOpenApi(readFixture('2.6.x.json'), {
    track: '2.6.x',
    sourceFile: '2.6.x.json',
  });
  const unitId = '2.6.x|/v2/vectordb/entities/search|post';

  assert.deepEqual([...inventory.operations.keys()], [unitId]);
  assert.equal(
    inventory.operations.get(unitId).pointer,
    '#/paths/~1v2~1vectordb~1entities~1search/post',
  );
  assert.equal(inventory.operations.get(unitId).endpoint, '/v2/vectordb/entities/search');
  assert.equal(inventory.operations.get(unitId).method, 'post');
  assert.equal(inventory.operations.get(unitId).operationId, 'searchEntities');

  const elements = inventory.operations.get(unitId).elements;
  assert.ok(elements.some(element =>
    element.pointer === '#/components/schemas/SearchRequest/properties/collectionName'));
  assert.ok(elements.some(element =>
    element.pointer === '#/paths/~1v2~1vectordb~1entities~1search/post'));
  assert.ok(inventory.operations.get(unitId).componentRefs.includes(
    '#/components/responses/SearchResponse'));

  assert.ok(elements.some((element) => element.kind === 'parameter'));
  assert.ok(elements.some((element) => element.kind === 'schemaProperty'));

  const structural = elements.filter((element) =>
    element.pointer.endsWith('/properties') || element.pointer.includes('/content/'));
  assert.deepEqual(structural, []);
});

test('deduplicates shared components and tracks affected operations', () => {
  const inventory = inventoryOpenApi(readFixture('3.0.x.json'), {
    track: '3.0.x',
    sourceFile: '3.0.x.json',
  });
  const searchUnit = '3.0.x|/v2/vectordb/entities/search|post';
  const listUnit = '3.0.x|/v2/vectordb/file_resources/list|post';

  assert.deepEqual([...inventory.operations.keys()], [searchUnit, listUnit]);
  assert.ok(inventory.components.get('#/components/parameters/AuthorizationHeader')
    .referencedBy.includes(searchUnit));
  assert.ok(inventory.components.get('#/components/parameters/AuthorizationHeader')
    .referencedBy.includes(listUnit));
  assert.ok(inventory.components.get('#/components/schemas/SearchRequest')
    .referencedBy.includes(searchUnit));
});

test('semantic projections omit authoring examples and i18n metadata', () => {
  const inventory = inventoryOpenApi(readFixture('2.6.x.json'), {
    track: '2.6.x',
    sourceFile: '2.6.x.json',
  });
  const property = inventory.operations
    .get('2.6.x|/v2/vectordb/entities/search|post')
    .elements.find((element) =>
      element.pointer === '#/components/schemas/SearchRequest/properties/collectionName');

  assert.ok(property);
  assert.deepEqual(property.semantic['x-i18n'], undefined);
  assert.deepEqual(property.semantic.example, undefined);
  assert.deepEqual(property.semantic['x-added-at'], '2.6.x');
});

test('missing local refs fail with REST_OPENAPI_REF_MISSING', () => {
  const spec = {
    openapi: '3.0.3',
    paths: {
      '/v2/vectordb/missing': {
        post: {
          'x-added-at': '2.6.x',
          'x-last-modified': '2.6.x',
          'x-deprecated-since': null,
          requestBody: {
            content: {
              'application/json': {
                schema: {$ref: '#/components/schemas/MissingRequest'},
              },
            },
          },
          responses: {},
        },
      },
    },
    components: {},
  };

  assert.throws(
    () => inventoryOpenApi(spec, {track: '2.6.x', sourceFile: 'missing.json'}),
    /REST_OPENAPI_REF_MISSING/,
  );
});

test('follows local refs without hanging on cycles', () => {
  const spec = {
    openapi: '3.0.3',
    paths: {
      '/v2/vectordb/cycle': {
        post: {
          'x-added-at': '2.6.x',
          'x-last-modified': '2.6.x',
          'x-deprecated-since': null,
          requestBody: {
            content: {
              'application/json': {
                schema: {$ref: '#/components/schemas/Node'},
              },
            },
          },
          responses: {},
        },
      },
    },
    components: {
      schemas: {
        Node: {
          type: 'object',
          'x-added-at': '2.6.x',
          'x-last-modified': '2.6.x',
          'x-deprecated-since': null,
          properties: {
            next: {
              $ref: '#/components/schemas/Node',
            },
          },
        },
      },
    },
  };

  assert.doesNotThrow(() => inventoryOpenApi(spec, {
    track: '2.6.x',
    sourceFile: 'cycle.json',
  }));
});

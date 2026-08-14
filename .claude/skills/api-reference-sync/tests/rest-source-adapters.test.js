'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {evaluateGoString, parseMilvusRoutes, parseStringConstants, scanMilvusRoutes} = require('../src/rest-source/milvus-adapter');
const {annotationPaths, parseJavaStringConstants, parseSpringController, scanZillizCloudRoutes} = require('../src/rest-source/zilliz-cloud-adapter');

const MILVUS_REPO = '/Users/anthony/Documents/projects/feishu-markdown-bridge/repos/milvus';
const MILVUS_SHA = '487e2b95e3a5e4f150a33efd33ad9d12a834f3a8';
const CLOUD_REPO = '/Users/anthony/Documents/projects/feishu-markdown-bridge/repos/zilliz-cloud';
const CLOUD_SHA = '9fd0dd74da5c6b892735e5e690110e6fdb23e901';

test('parses Go constants and composed Gin routes', () => {
  const constants = parseStringConstants('const (\n Category = "/items/"\n List = `list`\n)');
  assert.equal(evaluateGoString('Category + List', constants), '/items/list');
  const routes = parseMilvusRoutes('router.POST(Category+List, wrapperPost(func() any { return &ListReq{} }, wrapperTraceLog(h.listItems)))', constants,
    {file: 'handler_v2.go', revision: 'a'.repeat(40), repository: 'milvus'});
  assert.deepEqual(routes.map(route => [route.method, route.path, route.handler, route.requestType]),
    [['POST', '/v2/vectordb/items/list', 'listItems', 'ListReq']]);
});

test('parses Spring class and method mappings including arrays', () => {
  const source = '@RequestMapping("/v2")\npublic class Example {\n@GetMapping(value={"/a","/b"})\npublic GenericResp<Item> list(@RequestBody ListReq request) { return null; }\n}';
  assert.deepEqual(annotationPaths('value={"/a","/b"}'), ['/a', '/b']);
  const routes = parseSpringController(source, {file: 'Example.java', revision: 'b'.repeat(40), repository: 'cloud', serviceId: 'example'});
  assert.deepEqual(routes.map(route => [route.method, route.path, route.handler]), [['GET', '/v2/a', 'list'], ['GET', '/v2/b', 'list']]);
});

test('resolves Java string constants used by Spring mapping annotations', () => {
  const constants = parseJavaStringConstants('public static final String BASE = "/cloud/v1";\npublic static final String LIST = "/role/list";');
  const source = '@RequestMapping(BASE)\npublic class RoleController {\n@GetMapping(LIST)\npublic Result list() { return null; }\n}';
  const routes = parseSpringController(source, {file: 'RoleController.java', revision: 'b'.repeat(40), repository: 'cloud', serviceId: 'acl', constants});
  assert.deepEqual(routes.map(route => [route.method, route.path]), [['GET', '/cloud/v1/role/list']]);
});

test('supports individually imported static mapping constants', () => {
  const source = 'import static example.RoleUris.BASE;\nimport static example.RoleUris.LIST;\n@RequestMapping(BASE)\npublic class RoleController {\n@GetMapping(LIST)\npublic Result list() { return null; }\n}';
  assert.match(source, /import static example\.RoleUris\.BASE/);
  const constants = new Map([['BASE', '/cloud/v1'], ['LIST', '/role/list']]);
  assert.deepEqual(parseSpringController(source, {file: 'RoleController.java', revision: 'b'.repeat(40), repository: 'cloud', serviceId: 'acl', constants})
    .map(route => route.path), ['/cloud/v1/role/list']);
});

test('real pinned Milvus source produces deterministic route evidence', {skip: !fs.existsSync(MILVUS_REPO)}, () => {
  const routes = scanMilvusRoutes({repo: MILVUS_REPO, revision: MILVUS_SHA});
  assert.ok(routes.length > 90);
  assert.ok(routes.some(route => route.path === '/v2/vectordb/entities/search' && route.method === 'POST'));
  assert.ok(routes.every(route => route.source.revision === MILVUS_SHA));
});

test('real pinned zilliz-cloud source scans only configured services', {skip: !fs.existsSync(CLOUD_REPO)}, () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/rest-control-plane-services.json'), 'utf8'));
  const inventory = scanZillizCloudRoutes({repo: CLOUD_REPO, revision: CLOUD_SHA, config});
  assert.equal(inventory.services.length, 18);
  assert.ok(inventory.services.find(service => service.id === 'cloud-api-keys').routes.some(route => route.path === '/v2/api-keys'));
  assert.equal(inventory.services.find(service => service.id === 'cloud-access-control').status, 'CONTROLLER_MISSING');
});

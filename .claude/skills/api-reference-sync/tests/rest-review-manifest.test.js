const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {inventoryOpenApi} = require('../src/rest-track/openapi-inventory');
const {buildRestReviewManifest} = require('../src/rest-track/review-manifest');

const fixtureDir = path.join(__dirname, 'fixtures', 'rest-track');

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
}

function inventory26() {
  return inventoryOpenApi(readFixture('2.6.x.json'), {
    track: '2.6.x',
    sourceFile: '2.6.x.json',
  });
}

function inventory30() {
  return inventoryOpenApi(readFixture('3.0.x.json'), {
    track: '3.0.x',
    sourceFile: '3.0.x.json',
  });
}

function sourceEvidence() {
  return {
    '2.6.x': {repository: 'milvus-io/milvus', revision: 'v2.6.22'},
    '3.0.x': {repository: 'milvus-io/milvus', revision: 'v3.0.0'},
  };
}

function buildManifest(tracks = [inventory26(), inventory30()]) {
  return buildRestReviewManifest({
    tracks,
    managedFloor: '2.6.x',
    sourceEvidence: sourceEvidence(),
  });
}

test('classifies one review unit per version track, endpoint, and method', () => {
  const manifest = buildManifest();
  const search26 = 'rest:2.6.x:post:%2Fv2%2Fvectordb%2Fentities%2Fsearch';
  const search30 = 'rest:3.0.x:post:%2Fv2%2Fvectordb%2Fentities%2Fsearch';
  const list30 = 'rest:3.0.x:post:%2Fv2%2Fvectordb%2Ffile_resources%2Flist';

  assert.deepEqual(manifest.units.map((unit) => unit.reviewUnitId), [
    search26,
    search30,
    list30,
  ]);
  assert.equal(manifest.units[0].action, 'BACKFILL_LIFECYCLE');
  assert.equal(manifest.units[1].action, 'UPDATE');
  assert.equal(manifest.units[2].action, 'ADD');

  const search30Unit = manifest.units.find((unit) => unit.reviewUnitId === search30);
  assert.ok(search30Unit.contractChanges.some((change) =>
    change.pointer === '#/components/schemas/SearchRequest/properties/functionChains'
      && change.change === 'ADDED'));
  assert.ok(search30Unit.contractChanges.some((change) =>
    change.pointer === '#/components/schemas/SearchResult/properties/id'
      && change.change === 'MODIFIED'));
});

test('deduplicates shared components and expands affected operations', () => {
  const manifest = buildManifest();
  const pointers = manifest.sharedComponents.map((component) => component.pointer);
  assert.equal(new Set(pointers).size, pointers.length);

  for (const pointer of [
    '#/components/schemas/SearchRequest',
    '#/components/schemas/SearchResult',
  ]) {
    const component = manifest.sharedComponents.find((entry) => entry.pointer === pointer);
    assert.ok(component, pointer);
    assert.deepEqual(
      component.affectedOperations,
      ['rest:3.0.x:post:%2Fv2%2Fvectordb%2Fentities%2Fsearch'],
    );
  }
});

test('produces deterministic semantic digests', () => {
  const first = buildManifest();
  const second = buildManifest();

  assert.deepEqual(first, second);
  assert.equal(first.manifestDigest, second.manifestDigest);
  assert.match(first.manifestDigest, /^sha256:[a-f0-9]{64}$/);
});

test('rejects invalid lifecycle values', () => {
  const inventory = inventory26();
  const unit = inventory.operations.get('2.6.x|/v2/vectordb/entities/search|post');
  unit.lifecycle['x-added-at'] = '2.6.22';

  assert.throws(() => buildRestReviewManifest({
    tracks: [inventory],
    managedFloor: '2.6.x',
    sourceEvidence: sourceEvidence(),
  }), /REST_LIFECYCLE_INVALID/);
});

test('rejects lifecycle ordering where added precedes last modified', () => {
  const inventory = inventory26();
  const unit = inventory.operations.get('2.6.x|/v2/vectordb/entities/search|post');
  unit.lifecycle['x-added-at'] = '3.0.x';
  unit.lifecycle['x-last-modified'] = '2.6.x';

  assert.throws(() => buildRestReviewManifest({
    tracks: [inventory],
    managedFloor: '2.6.x',
    sourceEvidence: sourceEvidence(),
  }), /REST_LIFECYCLE_ORDER_INVALID/);
});

test('rejects deprecation without deprecation metadata', () => {
  const inventory = inventory26();
  const unit = inventory.operations.get('2.6.x|/v2/vectordb/entities/search|post');
  const operationElement = unit.elements.find((element) => element.kind === 'operation');
  operationElement.semantic.deprecated = true;

  assert.throws(() => buildRestReviewManifest({
    tracks: [inventory],
    managedFloor: '2.6.x',
    sourceEvidence: sourceEvidence(),
  }), /REST_DEPRECATION_METADATA_MISSING/);
});

test('rejects changed shared components with no operation owner', () => {
  const current = inventory30();
  current.components.set('#/components/schemas/UnownedChanged', {
    semantic: {
      type: 'object',
      'x-added-at': '3.0.x',
      'x-last-modified': '3.0.x',
      'x-deprecated-since': null,
    },
    referencedBy: [],
  });

  assert.throws(() => buildRestReviewManifest({
    tracks: [inventory26(), current],
    managedFloor: '2.6.x',
    sourceEvidence: sourceEvidence(),
  }), /REST_COMPONENT_OWNER_UNKNOWN/);
});

test('rejects duplicate track endpoint method review units', () => {
  assert.throws(() => buildRestReviewManifest({
    tracks: [inventory26(), inventory26()],
    managedFloor: '2.6.x',
    sourceEvidence: sourceEvidence(),
  }), /REST_REVIEW_UNIT_DUPLICATE/);
});

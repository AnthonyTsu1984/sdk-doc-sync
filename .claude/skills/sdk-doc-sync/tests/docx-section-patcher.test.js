'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { planApiReferencePatch } = require('../src/sdk-doc-sync/docx-section-patcher');

const fixtureDir = path.join(__dirname, 'fixtures', 'docx');

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8')).items;
}

test('plans minimal updates for signature and parameter additions', () => {
  const existingBlocks = fixture('python-api-reference-before.json');
  const expectedBlocks = fixture('python-api-reference-after.json');
  const patch = planApiReferencePatch(existingBlocks, {
    signature: 'client.create_user(user_name, password, timeout=None, description=None)',
    parameters: [{
      name: 'description',
      description: 'Optional user description.',
    }],
  });

  assert.equal(patch.ok, true);
  assert.deepEqual(patch.errors, []);
  assert.deepEqual(patch.operations.map((operation) => operation.type), [
    'update_text',
    'insert_after',
  ]);
  assert.deepEqual(patch.operations[0], {
    type: 'update_text',
    blockId: 'signature',
    text: 'client.create_user(user_name, password, timeout=None, description=None)',
  });
  assert.equal(patch.operations[1].afterBlockId, 'param1');
  assert.deepEqual(patch.operations[1].block, expectedBlocks[1]);
});

test('does not plan operations for existing signature and parameters', () => {
  const existingBlocks = fixture('python-api-reference-before.json');
  const patch = planApiReferencePatch(existingBlocks, {
    signature: 'client.create_user(user_name, password, timeout=None)',
    parameters: [{
      name: 'user_name',
      description: 'The user name.',
    }],
  });

  assert.equal(patch.ok, true);
  assert.deepEqual(patch.errors, []);
  assert.deepEqual(patch.operations, []);
});

test('updates existing parameter text when its description changes', () => {
  const existingBlocks = fixture('python-api-reference-before.json');
  const patch = planApiReferencePatch(existingBlocks, {
    signature: 'client.create_user(user_name, password, timeout=None)',
    parameters: [{
      name: 'user_name',
      description: 'Updated user name description.',
    }],
  });

  assert.equal(patch.ok, true);
  assert.deepEqual(patch.operations, [{
    type: 'update_text',
    blockId: 'param1',
    text: 'user_name - Updated user name description.',
  }]);
});

test('does not update example code when request syntax signature is missing', () => {
  const existingBlocks = fixture('python-api-reference-before.json')
    .filter((block) => block.block_id !== 'signature');
  const patch = planApiReferencePatch(existingBlocks, {
    signature: 'client.create_user(user_name, password)',
    parameters: [],
  });

  assert.equal(patch.ok, false);
  assert.deepEqual(patch.errors, [{ code: 'SECTION_NOT_FOUND', section: 'signature' }]);
  assert.deepEqual(patch.operations, []);
});

test('plans multiple parameter insertions without synthetic block ids', () => {
  const existingBlocks = fixture('python-api-reference-before.json');
  const patch = planApiReferencePatch(existingBlocks, {
    signature: 'client.create_user(user_name, password, timeout=None)',
    parameters: [{
      name: '**kwargs',
      description: 'Extra keyword arguments.',
    }, {
      name: 'collection.name',
      description: 'Collection name override.',
    }],
  });

  assert.equal(patch.ok, true);
  assert.deepEqual(patch.operations.map((operation) => operation.afterBlockId), ['param1', 'param1']);
  assert.deepEqual(patch.operations.map((operation) => operation.block), [{
    block_type: 12,
    bullet: {
      elements: [{
        text_run: {
          content: '**kwargs - Extra keyword arguments.',
          text_element_style: {},
        },
      }],
    },
  }, {
    block_type: 12,
    bullet: {
      elements: [{
        text_run: {
          content: 'collection.name - Collection name override.',
          text_element_style: {},
        },
      }],
    },
  }]);
});

test('blocks patching when required sections are missing', () => {
  const existingBlocks = fixture('python-api-reference-before.json')
    .filter((block) => block.block_id !== 'parameters');
  const patch = planApiReferencePatch(existingBlocks, {
    signature: 'client.create_user(user_name, password)',
    parameters: [],
  });

  assert.equal(patch.ok, false);
  assert.deepEqual(patch.errors, [{ code: 'SECTION_NOT_FOUND', section: 'parameters' }]);
  assert.deepEqual(patch.operations, []);
});

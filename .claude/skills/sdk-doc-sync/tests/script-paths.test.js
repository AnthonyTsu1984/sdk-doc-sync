const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('sdk-doc-sync test runner path exists', () => {
  const runner = path.resolve(__dirname, 'run-all.js');
  assert.equal(fs.existsSync(runner), true, `Missing expected test runner: ${runner}`);
});

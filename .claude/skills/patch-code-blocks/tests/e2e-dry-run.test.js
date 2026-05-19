const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { formatDryRunReport } = require('../src/report');

const SKILL_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SKILL_ROOT, '..', '..', '..');
const BIN_PATH = path.join(SKILL_ROOT, 'bin', 'patch-code-blocks.js');
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'blocks.sample.json');
const CWD = REPO_ROOT;

function runCliWithMocks(mockContent, args) {
  const mockPath = path.join(os.tmpdir(), `patch-code-blocks-mock-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.cjs`);
  fs.writeFileSync(mockPath, mockContent, 'utf8');

  try {
    return spawnSync(process.execPath, [BIN_PATH, ...args], {
      cwd: CWD,
      env: {
        ...process.env,
        NODE_OPTIONS: `--require ${mockPath}`,
      },
      encoding: 'utf8',
    });
  } finally {
    fs.rmSync(mockPath, { force: true });
  }
}

test('formatDryRunReport returns a stable stage payload', () => {
  const payload = formatDryRunReport({
    matrix: {
      'collections/create_collection#python': { operationKey: 'collections/create_collection', language: 'python' },
    },
    candidates: [{ operationKey: 'collections/create_collection', language: 'python' }],
  });

  assert.deepEqual(payload, {
    mode: 'dry-run',
    summary: {
      operations: 1,
      candidates: 1,
    },
    candidates: [{ operationKey: 'collections/create_collection', language: 'python' }],
    matrix: {
      'collections/create_collection#python': { operationKey: 'collections/create_collection', language: 'python' },
    },
  });
});

test('dry run prints dry-run report JSON shape', () => {
  const mock = `
const Module = require('node:module');
const fixture = require(${JSON.stringify(FIXTURE_PATH)});
const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request.endsWith('/src/target') || request === '../src/target') {
    return { resolveDocumentId: async () => 'docx-mocked-1' };
  }

  if (request.endsWith('/sdk-doc-sync/src/markdown-to-feishu')) {
    return class MockMarkdownToFeishu {
      async get_document_blocks() {
        return fixture;
      }
    };
  }

  return originalLoad.apply(this, arguments);
};
`;

  const result = runCliWithMocks(mock, [
    '--target', 'https://example.feishu.cn/docx/anything',
    '--release', 'v2.6.14',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.trim(), '');

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.mode, 'dry-run');
  assert.equal(typeof payload.summary.operations, 'number');
  assert.ok(payload.summary.operations >= 0);
  assert.equal(typeof payload.summary.candidates, 'number');
  assert.equal(payload.summary.candidates, payload.candidates.length);
  assert.equal(payload.summary.operations, Object.keys(payload.matrix).length);
});

test('dry run exits non-zero and prints usage when extraction path fails', () => {
  const mock = `
const Module = require('node:module');
const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request.endsWith('/src/target') || request === '../src/target') {
    return { resolveDocumentId: async () => 'docx-mocked-2' };
  }

  if (request.endsWith('/sdk-doc-sync/src/markdown-to-feishu')) {
    return class MockMarkdownToFeishu {
      async get_document_blocks() {
        throw new Error('mocked extraction failure');
      }
    };
  }

  return originalLoad.apply(this, arguments);
};
`;

  const result = runCliWithMocks(mock, [
    '--target', 'https://example.feishu.cn/docx/anything',
    '--release', 'v2.6.14',
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /ERROR: mocked extraction failure/);
  assert.match(result.stderr, /Usage: patch-code-blocks --target/);
});

test('apply mode is explicitly blocked until mutation flow is implemented', () => {
  const result = spawnSync(process.execPath, [BIN_PATH,
    '--target', 'https://example.feishu.cn/docx/anything',
    '--product', 'zilliz-saas',
    '--apply', 'true',
  ], {
    cwd: CWD,
    env: { ...process.env },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Apply mode is not implemented yet/);
});

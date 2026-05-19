const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const TARGET_MODULE = '/Volumes/CaseSensitive/projects/feishu-markdown-bridge/.worktrees/patch-code-blocks-runner/.claude/skills/patch-code-blocks/src/target.js';

function withTargetMocks(fetchImpl, tokenImpl = async () => 'tenant-token') {
  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'node-fetch') {
      return fetchImpl;
    }

    if (request.endsWith('/larkTokenFetcher')) {
      return class MockTokenFetcher {
        async token() {
          return tokenImpl();
        }
      };
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    delete require.cache[require.resolve(TARGET_MODULE)];
    return require(TARGET_MODULE);
  } finally {
    Module._load = originalLoad;
  }
}

async function withEnv(overrides, fn) {
  const previous = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('parseTarget accepts wiki/docx and rejects unsupported kind', () => {
  const { parseTarget } = withTargetMocks(async () => ({ ok: true, status: 200, json: async () => ({}) }));

  assert.deepEqual(parseTarget('https://host/wiki/abc'), { kind: 'wiki', token: 'abc' });
  assert.deepEqual(parseTarget('https://host/docx/xyz'), { kind: 'docx', token: 'xyz' });
  assert.throws(() => parseTarget('https://host/sheets/1'), /Unsupported target kind/);
});

test('resolveDocumentId returns docx token without network', async () => {
  let called = false;
  const { resolveDocumentId } = withTargetMocks(async () => {
    called = true;
    return { ok: true, status: 200, json: async () => ({}) };
  });

  const result = await resolveDocumentId('https://host/docx/token123');
  assert.equal(result, 'token123');
  assert.equal(called, false);
});

test('resolveDocumentId rejects when FEISHU_HOST is missing', async () => {
  await withEnv({ FEISHU_HOST: undefined }, async () => {
    const { resolveDocumentId } = withTargetMocks(async () => ({ ok: true, status: 200, json: async () => ({}) }));

    await assert.rejects(
      () => resolveDocumentId('https://host/wiki/node1'),
      /Missing FEISHU_HOST environment variable/
    );
  });
});

test('resolveDocumentId handles HTTP errors', async () => {
  await withEnv({ FEISHU_HOST: 'https://api.example.com' }, async () => {
    const { resolveDocumentId } = withTargetMocks(async () => ({
      ok: false,
      status: 502,
      json: async () => ({ code: 0 }),
    }));

    await assert.rejects(
      () => resolveDocumentId('https://host/wiki/node1'),
      /HTTP 502/
    );
  });
});

test('resolveDocumentId handles invalid JSON body', async () => {
  await withEnv({ FEISHU_HOST: 'https://api.example.com' }, async () => {
    const { resolveDocumentId } = withTargetMocks(async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new Error('Unexpected token'); },
    }));

    await assert.rejects(
      () => resolveDocumentId('https://host/wiki/node1'),
      /invalid JSON/
    );
  });
});

test('resolveDocumentId handles API-level failure and missing obj_token', async () => {
  await withEnv({ FEISHU_HOST: 'https://api.example.com' }, async () => {
    const { resolveDocumentId: apiFail } = withTargetMocks(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: 1001, msg: 'bad token' }),
    }));
    await assert.rejects(() => apiFail('https://host/wiki/node1'), /bad token/);

    const { resolveDocumentId: missingToken } = withTargetMocks(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, data: { node: {} } }),
    }));
    await assert.rejects(() => missingToken('https://host/wiki/node1'), /missing obj_token/);
  });
});

test('resolveDocumentId maps AbortError to timeout message', async () => {
  await withEnv({ FEISHU_HOST: 'https://api.example.com', FEISHU_REQUEST_TIMEOUT_MS: '1234' }, async () => {
    const { resolveDocumentId } = withTargetMocks(async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });

    await assert.rejects(
      () => resolveDocumentId('https://host/wiki/node1'),
      /timed out after 1234ms/
    );
  });
});

test('resolveDocumentId falls back to default timeout when FEISHU_REQUEST_TIMEOUT_MS is invalid', async () => {
  await withEnv({ FEISHU_HOST: 'https://api.example.com', FEISHU_REQUEST_TIMEOUT_MS: '12.5' }, async () => {
    const { resolveDocumentId } = withTargetMocks(async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });

    await assert.rejects(
      () => resolveDocumentId('https://host/wiki/node1'),
      /timed out after 10000ms/
    );
  });
});

test('resolveDocumentId returns wiki obj_token on success', async () => {
  await withEnv({ FEISHU_HOST: 'https://api.example.com' }, async () => {
    const { resolveDocumentId } = withTargetMocks(async (_url, options) => {
      assert.equal(options.method, 'GET');
      assert.match(options.headers.Authorization, /^Bearer /);
      assert.ok(options.signal);
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 0, data: { node: { obj_token: 'docx-999' } } }),
      };
    });

    const documentId = await resolveDocumentId('https://host/wiki/node1');
    assert.equal(documentId, 'docx-999');
  });
});

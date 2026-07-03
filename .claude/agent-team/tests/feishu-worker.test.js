const test = require('node:test');
const assert = require('node:assert/strict');

function config() {
  return {
    feishu: { chatId: 'oc_chat', approverIds: ['ou_allowed'] },
    github: { owner: 'zilliztech', repo: 'feishu-markdown-bridge', ref: 'master', dispatchEventPrefix: 'doc-agent' },
    approvalConsumer: { taskTtlMinutes: 1440 },
  };
}

function memoryKv() {
  const values = new Map();
  return {
    get: async key => values.get(key) || null,
    put: async (key, value) => values.set(key, value),
    values,
  };
}

function env(overrides = {}) {
  return {
    DOC_AGENT_CONFIG_JSON: JSON.stringify(config()),
    FEISHU_EVENT_VERIFICATION_TOKEN: 'verify-token',
    FEISHU_HOST: 'https://open.feishu.cn',
    APP_ID: 'cli_test',
    APP_SECRET: 'secret',
    GITHUB_TOKEN: 'github-token',
    DECISIONS: memoryKv(),
    ...overrides,
  };
}

async function encryptPayload(payload, encryptKey) {
  const keyBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encryptKey)));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt']);
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const padLength = 16 - (body.length % 16);
  const padded = new Uint8Array(body.length + padLength);
  padded.set(body);
  padded.fill(padLength, body.length);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: keyBytes.slice(0, 16) }, key, padded);
  return Buffer.from(encrypted).toString('base64');
}

async function withFetchStub(handler) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/tenant_access_token/internal/')) {
      return Response.json({ code: 0, tenant_access_token: 'tenant-token' });
    }
    if (String(url).includes('/open-apis/im/v1/messages')) {
      return Response.json({ code: 0, data: { message_id: 'om_reply' } });
    }
    if (String(url).includes('api.github.com')) {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    await handler(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('Worker processFeishuCallback answers URL verification challenge', async () => {
  const worker = await import('../cloudflare-worker/src/index.mjs');
  const result = await worker.processFeishuCallback({
    env: env(),
    body: { type: 'url_verification', token: 'verify-token', challenge: 'challenge-value' },
  });
  assert.deepEqual(result.response, { challenge: 'challenge-value' });
  assert.equal(result.result.challenge, true);
});

test('Worker replies to local ztrans help intent', async () => {
  const worker = await import('../cloudflare-worker/src/index.mjs');
  await withFetchStub(async calls => {
    const result = await worker.processFeishuCallback({
      env: env(),
      body: {
        schema: '2.0',
        header: { token: 'verify-token', event_id: 'evt_1', event_type: 'im.message.receive_v1', create_time: '1' },
        event: {
          sender: { sender_id: { open_id: 'ou_allowed' } },
          message: {
            chat_id: 'oc_chat',
            message_id: 'om_1',
            content: JSON.stringify({ text: '<at user_id="ou_bot">ztrans</at> help' }),
          },
        },
      },
    });
    assert.equal(result.result.local, true);
    assert.equal(calls.length, 2);
    assert.match(calls[1].init.body, /ztrans understands/);
  });
});

test('Worker dedupes approval dispatches with KV', async () => {
  const worker = await import('../cloudflare-worker/src/index.mjs');
  const localEnv = env();
  const body = {
    schema: '2.0',
    header: { token: 'verify-token', event_id: 'evt_1', event_type: 'im.message.receive_v1', create_time: '1' },
    event: {
      sender: { sender_id: { open_id: 'ou_allowed' } },
      message: {
        chat_id: 'oc_chat',
        message_id: 'om_1',
        content: JSON.stringify({ text: '<at user_id="ou_bot">ztrans</at> approve loc-scan-1 123456' }),
      },
    },
  };
  await withFetchStub(async calls => {
    const first = await worker.processFeishuCallback({ env: localEnv, body });
    const second = await worker.processFeishuCallback({ env: localEnv, body });
    assert.equal(first.result.ok, true);
    assert.equal(second.result.duplicate, true);
    assert.equal(calls.filter(call => call.url.includes('api.github.com')).length, 1);
  });
});

test('Worker decrypts encrypted Feishu callbacks', async () => {
  const worker = await import('../cloudflare-worker/src/index.mjs');
  const encryptKey = 'test-encrypt-key';
  const encrypt = await encryptPayload(
    { type: 'url_verification', token: 'verify-token', challenge: 'encrypted-challenge' },
    encryptKey
  );
  const result = await worker.processFeishuCallback({
    env: env({ FEISHU_EVENT_ENCRYPT_KEY: encryptKey }),
    body: { encrypt },
  });
  assert.deepEqual(result.response, { challenge: 'encrypted-challenge' });
});

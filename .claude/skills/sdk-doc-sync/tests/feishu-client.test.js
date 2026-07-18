const test = require('node:test');
const assert = require('node:assert/strict');

const { FeishuClient } = require('../src/feishu/feishu-client');

function response({ status = 200, body = { code: 0, data: {} }, headers = {} } = {}) {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value)]),
  );

  return {
    status,
    headers: {
      get(name) {
        return normalizedHeaders.get(name.toLowerCase()) ?? null;
      },
    },
    async json() {
      if (body instanceof Error) throw body;
      return body;
    },
  };
}

test('GET request adds a bearer token and validates the Feishu envelope', async () => {
  const calls = [];
  const client = new FeishuClient({
    host: 'https://open.feishu.test/',
    tokenProvider: async () => 'tenant-token',
    transport: async (url, options) => {
      calls.push({ url, options });
      return response({ body: { code: 0, data: { value: 42 } } });
    },
  });

  const result = await client.request({ path: '/open-apis/example' });

  assert.deepEqual(result, { code: 0, data: { value: 42 } });
  assert.equal(calls[0].url, 'https://open.feishu.test/open-apis/example');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tenant-token');
  assert.equal(calls[0].options.body, undefined);
});

test('request JSON-encodes a body', async () => {
  let options;
  const client = new FeishuClient({
    host: 'https://open.feishu.test',
    tokenProvider: async () => 'token',
    transport: async (_url, requestOptions) => {
      options = requestOptions;
      return response();
    },
  });

  await client.request({ method: 'POST', path: '/items', body: { name: 'example' } });

  assert.equal(options.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(options.body, '{"name":"example"}');
});

test('request rejects an empty access token', async () => {
  const client = new FeishuClient({
    host: 'https://open.feishu.test',
    tokenProvider: async () => '  ',
    transport: async () => response(),
  });

  await assert.rejects(client.request({ path: '/items' }), (error) => {
    assert.equal(error.code, 'FEISHU_TOKEN_INVALID');
    assert.match(error.message, /non-empty access token/i);
    return true;
  });
});

test('request rejects invalid JSON and invalid response bodies deterministically', async () => {
  const invalidJsonClient = new FeishuClient({
    host: 'https://open.feishu.test',
    tokenProvider: async () => 'token',
    transport: async () => response({ body: new SyntaxError('bad json') }),
  });
  await assert.rejects(invalidJsonClient.request({ path: '/items' }), (error) => {
    assert.equal(error.code, 'FEISHU_INVALID_JSON');
    return true;
  });

  const invalidBodyClient = new FeishuClient({
    host: 'https://open.feishu.test',
    tokenProvider: async () => 'token',
    transport: async () => response({ body: [] }),
  });
  await assert.rejects(invalidBodyClient.request({ path: '/items' }), (error) => {
    assert.equal(error.code, 'FEISHU_INVALID_RESPONSE');
    assert.match(error.message, /object envelope/i);
    return true;
  });
});

test('request rejects HTTP and Feishu API errors without retrying API failures', async () => {
  const httpClient = new FeishuClient({
    host: 'https://open.feishu.test',
    tokenProvider: async () => 'token',
    transport: async () => response({ status: 404, body: { code: 0 } }),
  });
  await assert.rejects(httpClient.request({ path: '/missing' }), (error) => {
    assert.equal(error.code, 'FEISHU_HTTP_ERROR');
    assert.equal(error.status, 404);
    return true;
  });

  let calls = 0;
  const apiClient = new FeishuClient({
    host: 'https://open.feishu.test',
    tokenProvider: async () => 'token',
    transport: async () => {
      calls += 1;
      return response({ body: { code: 999, msg: 'invalid parameter' } });
    },
  });
  await assert.rejects(apiClient.request({ path: '/items' }), (error) => {
    assert.equal(error.code, 'FEISHU_API_ERROR');
    assert.equal(error.apiCode, 999);
    assert.match(error.message, /invalid parameter/);
    return true;
  });
  assert.equal(calls, 1);
});

test('request waits for the rate-limit reset header before retrying a 429', async () => {
  const waits = [];
  let calls = 0;
  const client = new FeishuClient({
    host: 'https://open.feishu.test',
    tokenProvider: async () => 'token',
    wait: async (milliseconds) => waits.push(milliseconds),
    transport: async () => {
      calls += 1;
      if (calls === 1) {
        return response({
          status: 429,
          body: { code: 999, msg: 'rate limited' },
          headers: { 'x-ogw-ratelimit-reset': '2.5' },
        });
      }
      return response({ body: { code: 0, data: { ok: true } } });
    },
  });

  const result = await client.request({ path: '/items' });

  assert.equal(calls, 2);
  assert.deepEqual(waits, [2500]);
  assert.deepEqual(result.data, { ok: true });
});

test('request stops after the configured number of transient retries', async () => {
  let calls = 0;
  const waits = [];
  const client = new FeishuClient({
    host: 'https://open.feishu.test',
    tokenProvider: async () => 'token',
    maxRetries: 2,
    wait: async (milliseconds) => waits.push(milliseconds),
    transport: async () => {
      calls += 1;
      return response({ status: 503, body: { code: 0 } });
    },
  });

  await assert.rejects(client.request({ path: '/items' }), (error) => {
    assert.equal(error.code, 'FEISHU_RETRY_EXHAUSTED');
    assert.equal(error.status, 503);
    assert.equal(error.attempts, 3);
    return true;
  });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1000, 2000]);
});

test('paginate combines pages and sends the returned page token', async () => {
  const urls = [];
  const client = new FeishuClient({
    host: 'https://open.feishu.test',
    tokenProvider: async () => 'token',
    transport: async (url) => {
      urls.push(url);
      if (urls.length === 1) {
        return response({
          body: {
            code: 0,
            data: { items: [{ id: 'one' }], has_more: true, page_token: 'next token' },
          },
        });
      }
      return response({
        body: { code: 0, data: { items: [{ id: 'two' }], has_more: false } },
      });
    },
  });

  const items = await client.paginate({ path: '/open-apis/items?page_size=100' });

  assert.deepEqual(items, [{ id: 'one' }, { id: 'two' }]);
  assert.deepEqual(urls, [
    'https://open.feishu.test/open-apis/items?page_size=100',
    'https://open.feishu.test/open-apis/items?page_size=100&page_token=next+token',
  ]);
});

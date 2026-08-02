'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadSmokeConfig,
  redactSmokeConfig,
} = require('../harness/smoke-config');

function validEnv() {
  return {
    SMOKE_PROFILE: 'doc-ops-smoke',
    SMOKE_TENANT_MARKER: 'DOC_OPS_TEST',
    SMOKE_FEISHU_HOST: 'https://open.feishu.cn',
    SMOKE_ROOT_TOKEN: 'smoke-root-token',
    SMOKE_BASE_TOKEN: 'smoke-base-token',
    SMOKE_TABLE_ID: 'tblSmokeCases',
    SMOKE_APP_ID: 'cli_smoke_app',
    SMOKE_APP_SECRET: 'smoke-secret',
  };
}

test('smoke config requires an explicit isolated namespace', () => {
  assert.throws(
    () => loadSmokeConfig({}),
    error => error.code === 'SMOKE_CONFIG_MISSING'
      && error.missing.includes('SMOKE_PROFILE')
      && error.missing.includes('SMOKE_ROOT_TOKEN'),
  );
});

test('smoke config rejects production token and app reuse', () => {
  const env = validEnv();
  env.ROOT_TOKEN = env.SMOKE_ROOT_TOKEN;
  env.BASE_TOKEN = env.SMOKE_BASE_TOKEN;
  env.APP_ID = env.SMOKE_APP_ID;
  assert.throws(
    () => loadSmokeConfig(env),
    error => error.code === 'SMOKE_CONFIG_COLLISION'
      && error.collisions.join(',') === 'APP_ID,BASE_TOKEN,ROOT_TOKEN',
  );
});

test('smoke config never exposes credentials in reportable output', () => {
  const config = loadSmokeConfig(validEnv(), { requireCredentials: true });
  assert.deepEqual(redactSmokeConfig(config), {
    appId: 'cli_..._app',
    appSecret: '[redacted]',
    baseToken: 'smok...oken',
    feishuHost: 'https://open.feishu.cn',
    profile: 'doc-ops-smoke',
    rootToken: 'smok...oken',
    tableId: 'tblS...ases',
    tenantMarker: 'DOC_OPS_TEST',
  });
});

test('smoke config allows local contract simulator only behind an explicit flag', () => {
  const env = validEnv();
  env.SMOKE_FEISHU_HOST = 'http://127.0.0.1:43123';
  assert.throws(() => loadSmokeConfig(env), { code: 'SMOKE_HOST_UNSAFE' });
  env.SMOKE_ALLOW_LOCAL_SIMULATOR = '1';
  assert.equal(loadSmokeConfig(env).feishuHost, 'http://127.0.0.1:43123');
});

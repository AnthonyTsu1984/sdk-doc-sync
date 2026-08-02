'use strict';

const REQUIRED_KEYS = [
  'SMOKE_PROFILE',
  'SMOKE_TENANT_MARKER',
  'SMOKE_FEISHU_HOST',
  'SMOKE_ROOT_TOKEN',
  'SMOKE_BASE_TOKEN',
  'SMOKE_TABLE_ID',
];

const CREDENTIAL_KEYS = ['SMOKE_APP_ID', 'SMOKE_APP_SECRET'];
const COLLISION_PAIRS = [
  ['SMOKE_APP_ID', 'APP_ID'],
  ['SMOKE_APP_SECRET', 'APP_SECRET'],
  ['SMOKE_BASE_TOKEN', 'BASE_TOKEN'],
  ['SMOKE_ROOT_TOKEN', 'ROOT_TOKEN'],
  ['SMOKE_TABLE_ID', 'TABLE_ID'],
];

class SmokeConfigError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = 'SmokeConfigError';
    this.code = code;
    Object.assign(this, details);
  }
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function validateHost(value, allowLocalSimulator) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new SmokeConfigError('SMOKE_HOST_UNSAFE', `Invalid SMOKE_FEISHU_HOST: ${value}`);
  }
  const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (local && allowLocalSimulator) return url.toString().replace(/\/$/, '');
  const knownHost = ['open.feishu.cn', 'open.larksuite.com'].includes(url.hostname);
  if (url.protocol !== 'https:' || !knownHost) {
    throw new SmokeConfigError(
      'SMOKE_HOST_UNSAFE',
      'Live smoke host must be the Feishu/Lark OpenAPI host; local HTTP requires SMOKE_ALLOW_LOCAL_SIMULATOR=1',
    );
  }
  return url.toString().replace(/\/$/, '');
}

function loadSmokeConfig(env = process.env, { requireCredentials = false } = {}) {
  const required = requireCredentials ? [...REQUIRED_KEYS, ...CREDENTIAL_KEYS] : REQUIRED_KEYS;
  const missing = required.filter(key => !nonEmpty(env[key])).sort();
  if (missing.length > 0) {
    throw new SmokeConfigError('SMOKE_CONFIG_MISSING', `Missing smoke configuration: ${missing.join(', ')}`, { missing });
  }

  const collisions = COLLISION_PAIRS
    .filter(([smokeKey, productionKey]) => nonEmpty(env[productionKey]) && env[smokeKey] === env[productionKey])
    .map(([, productionKey]) => productionKey)
    .sort();
  if (collisions.length > 0) {
    throw new SmokeConfigError(
      'SMOKE_CONFIG_COLLISION',
      `Smoke configuration reuses production values: ${collisions.join(', ')}`,
      { collisions },
    );
  }

  if (!/^[A-Z0-9][A-Z0-9_-]{2,63}$/.test(env.SMOKE_TENANT_MARKER)) {
    throw new SmokeConfigError(
      'SMOKE_TENANT_MARKER_INVALID',
      'SMOKE_TENANT_MARKER must be an explicit uppercase test-tenant marker',
    );
  }
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(env.SMOKE_PROFILE)) {
    throw new SmokeConfigError('SMOKE_PROFILE_INVALID', 'SMOKE_PROFILE must be a named non-default profile');
  }

  return Object.freeze({
    appId: env.SMOKE_APP_ID || null,
    appSecret: env.SMOKE_APP_SECRET || null,
    baseToken: env.SMOKE_BASE_TOKEN,
    feishuHost: validateHost(env.SMOKE_FEISHU_HOST, env.SMOKE_ALLOW_LOCAL_SIMULATOR === '1'),
    profile: env.SMOKE_PROFILE,
    rootToken: env.SMOKE_ROOT_TOKEN,
    tableId: env.SMOKE_TABLE_ID,
    tenantMarker: env.SMOKE_TENANT_MARKER,
  });
}

function redactIdentifier(value) {
  if (!value) return null;
  if (value.length <= 8) return '[redacted]';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function redactSmokeConfig(config) {
  return {
    appId: redactIdentifier(config.appId),
    appSecret: config.appSecret ? '[redacted]' : null,
    baseToken: redactIdentifier(config.baseToken),
    feishuHost: config.feishuHost,
    profile: config.profile,
    rootToken: redactIdentifier(config.rootToken),
    tableId: redactIdentifier(config.tableId),
    tenantMarker: config.tenantMarker,
  };
}

module.exports = {
  CREDENTIAL_KEYS,
  REQUIRED_KEYS,
  SmokeConfigError,
  loadSmokeConfig,
  redactSmokeConfig,
};

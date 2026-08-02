'use strict';

const { canonicalize } = require('../src/canonical-json');

const RUNTIME_KEYS = new Set(['runtime', 'timestamp', 'startedAt', 'completedAt', 'pid', 'hostname', 'temporaryPath']);

function stripRuntime(value) {
  if (Array.isArray(value)) return value.map(stripRuntime);
  if (value === null || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (RUNTIME_KEYS.has(key) || key === 'semanticDigest') continue;
    result[key] = stripRuntime(child);
  }
  return result;
}

function normalizeSemantic(value) {
  const semantic = value && typeof value === 'object' && Object.hasOwn(value, 'semantic') ? value.semantic : value;
  return canonicalize(stripRuntime(semantic));
}

module.exports = { RUNTIME_KEYS, stripRuntime, normalizeSemantic };

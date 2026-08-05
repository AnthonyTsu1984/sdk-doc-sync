'use strict';

class CanonicalJsonError extends TypeError {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'CanonicalJsonError';
    this.code = code;
  }
}

function compareByKeys(left, right, keys) {
  for (const key of keys) {
    const a = left?.[key] ?? '';
    const b = right?.[key] ?? '';
    const comparison = String(a).localeCompare(String(b));
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function canonicalize(value, options = {}, path = '$', stack = new WeakSet()) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new CanonicalJsonError('NON_FINITE_NUMBER', `${path} contains a non-finite number`);
    }
    return value;
  }
  if (stack.has(value)) throw new CanonicalJsonError('CIRCULAR_VALUE', `${path} is circular`);
  stack.add(value);

  let result;
  if (Array.isArray(value)) {
    result = value.map((entry, index) => {
      const normalized = canonicalize(entry, options, `${path}[${index}]`, stack);
      return normalized === undefined ? null : normalized;
    });
    const sortKeys = options.arraySortKeys?.[path];
    if (Array.isArray(sortKeys) && sortKeys.length > 0) {
      result = result.map((entry, index) => ({ entry, index }))
        .sort((left, right) => compareByKeys(left.entry, right.entry, sortKeys) || left.index - right.index)
        .map(item => item.entry);
    }
  } else {
    result = {};
    for (const key of Object.keys(value).sort()) {
      const normalized = canonicalize(value[key], options, `${path}.${key}`, stack);
      if (normalized !== undefined) result[key] = normalized;
    }
  }

  stack.delete(value);
  return result;
}

function canonicalStringify(value, options = {}) {
  return `${JSON.stringify(canonicalize(value, options))}\n`;
}

function canonicalBytes(value, options = {}) {
  return Buffer.from(canonicalStringify(value, options), 'utf8');
}

function splitSemanticEnvelope(envelope = {}, options = {}) {
  return {
    semantic: canonicalize(envelope.semantic || {}, options),
    runtime: canonicalize(envelope.runtime || {}, options),
  };
}

module.exports = {
  CanonicalJsonError,
  canonicalize,
  canonicalStringify,
  canonicalBytes,
  splitSemanticEnvelope,
};

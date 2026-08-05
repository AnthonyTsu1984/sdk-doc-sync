'use strict';

const { isDeepStrictEqual } = require('node:util');

function normalizedCopy(value) {
  if (Array.isArray(value)) return value.map(normalizedCopy);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, normalizedCopy(value[key])]),
  );
}

function resolvePlanningContexts(values) {
  const defined = values.filter((value) => value !== undefined);
  if (defined.length === 0) return { value: undefined, conflict: false };
  return {
    value: normalizedCopy(defined[0]),
    conflict: defined.slice(1).some((value) => !isDeepStrictEqual(defined[0], value)),
  };
}

module.exports = {
  normalizedCopy,
  resolvePlanningContexts,
};

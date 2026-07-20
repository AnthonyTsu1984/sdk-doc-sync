'use strict';

function freezeProfile(profile) {
  return Object.freeze({
    ...profile,
    order: Object.freeze([...profile.order]),
    fences: Object.freeze({ ...profile.fences }),
    cardinality: Object.freeze(Object.fromEntries(
      Object.entries(profile.cardinality).map(([role, range]) => [role, Object.freeze([...range])]),
    )),
  });
}

const profiles = Object.freeze({
  python: freezeProfile({
    id: 'python', version: 1, bodyTitle: 'omit', canonicalSignature: 'omit',
    order: ['summary', 'audience', 'request', 'parameters', 'members', 'result-type', 'returns', 'exceptions', 'examples', 'extensions', 'notes', 'related'],
    fences: { 'request-signature': 'Python', 'example-code': 'Python' },
    cardinality: { 'canonical-signature': [0, 0], 'request-signature': [0, 1] },
  }),
  java: freezeProfile({
    id: 'java', version: 1, bodyTitle: 'omit', canonicalSignature: 'when-distinct',
    order: ['summary', 'audience', 'canonical-signature', 'request', 'parameters', 'members', 'result-type', 'returns', 'exceptions', 'examples', 'extensions', 'notes', 'related'],
    fences: { 'canonical-signature': 'Java', 'request-signature': 'Java', 'example-code': 'Java' },
    cardinality: { 'canonical-signature': [0, 1], 'request-signature': [0, 1] },
  }),
  node: freezeProfile({
    id: 'node', version: 1, bodyTitle: 'omit', canonicalSignature: 'when-distinct',
    order: ['summary', 'audience', 'canonical-signature', 'request', 'parameters', 'members', 'result-type', 'returns', 'exceptions', 'examples', 'extensions', 'notes', 'related'],
    fences: { 'canonical-signature': 'TypeScript', 'request-signature': 'TypeScript' },
    cardinality: { 'canonical-signature': [0, 1], 'request-signature': [0, Number.POSITIVE_INFINITY] },
  }),
  go: freezeProfile({
    id: 'go', version: 1, bodyTitle: 'omit', canonicalSignature: 'when-distinct',
    order: ['summary', 'audience', 'canonical-signature', 'request', 'parameters', 'members', 'result-type', 'returns', 'exceptions', 'examples', 'extensions', 'notes', 'related'],
    fences: { 'canonical-signature': 'Go', 'request-signature': 'Go', 'example-code': 'Go' },
    cardinality: { 'canonical-signature': [0, 1], 'request-signature': [0, 1] },
  }),
  cpp: freezeProfile({
    id: 'cpp', version: 1, bodyTitle: 'omit', canonicalSignature: 'when-distinct',
    order: ['summary', 'audience', 'canonical-signature', 'request', 'parameters', 'members', 'result-type', 'returns', 'exceptions', 'examples', 'extensions', 'notes', 'related'],
    fences: { 'canonical-signature': 'C++', 'request-signature': 'C++', 'example-code': 'C++' },
    cardinality: { 'canonical-signature': [0, 1], 'request-signature': [0, 1] },
  }),
});

module.exports = profiles;

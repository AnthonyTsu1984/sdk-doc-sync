'use strict';

// Global structural layout rules (2026-09 campaign directives, all tracks):
// a single request type never gets its own H3, the Example section is a bare
// code block, and deprecation notices are titled two-line callouts. Rules a
// language does not declare do not apply to that language — absence is a
// reviewed decision in this data file, not a blind spot. layoutRules carries
// its own version so the renderer-shape version above (pinned by artifacts
// and contracts) stays untouched.
const GLOBAL_LAYOUT_RULES = Object.freeze({
  version: 1,
  requestH3: 'multi-only',
  requestHeadingPattern: 'Request$',
  exampleHeading: false,
  deprecation: Object.freeze({ shape: 'callout', lines: 2, firstLine: 'Notes', prosePattern: 'Deprecated in v' }),
});

const CPP_LAYOUT_RULES = Object.freeze({
  ...GLOBAL_LAYOUT_RULES,
  builderSignature: Object.freeze({ prefixForbidden: Object.freeze(['Request& (With|Add)']) }),
});

function freezeLayoutRules(rules) {
  if (!rules) return undefined;
  return Object.freeze({
    ...rules,
    builderSignature: rules.builderSignature
      ? Object.freeze({
        ...rules.builderSignature,
        prefixForbidden: Object.freeze([...(rules.builderSignature.prefixForbidden || [])]),
      })
      : undefined,
    deprecation: rules.deprecation ? Object.freeze({ ...rules.deprecation }) : undefined,
  });
}

function freezeProfile(profile) {
  return Object.freeze({
    ...profile,
    order: Object.freeze([...profile.order]),
    fences: Object.freeze({ ...profile.fences }),
    cardinality: Object.freeze(Object.fromEntries(
      Object.entries(profile.cardinality).map(([role, range]) => [role, Object.freeze([...range])]),
    )),
    ...(profile.layoutRules ? { layoutRules: freezeLayoutRules(profile.layoutRules) } : {}),
  });
}

const profiles = Object.freeze({
  python: freezeProfile({
    id: 'python', version: 1, bodyTitle: 'omit', canonicalSignature: 'omit',
    order: ['summary', 'audience', 'request', 'parameters', 'members', 'result-type', 'returns', 'exceptions', 'examples', 'extensions', 'notes', 'related'],
    fences: { 'request-signature': 'Python', 'example-code': 'Python' },
    cardinality: { 'canonical-signature': [0, 0], 'request-signature': [0, 1] },
    layoutRules: GLOBAL_LAYOUT_RULES,
  }),
  java: freezeProfile({
    id: 'java', version: 2, bodyTitle: 'omit', canonicalSignature: 'when-distinct',
    order: ['summary', 'audience', 'canonical-signature', 'request', 'parameters', 'members', 'result-type', 'returns', 'exceptions', 'examples', 'extensions', 'notes', 'related'],
    fences: { 'canonical-signature': 'Java', 'request-signature': 'Java', 'example-code': 'Java' },
    cardinality: { 'canonical-signature': [0, 1], 'request-signature': [0, Number.POSITIVE_INFINITY] },
    layoutRules: GLOBAL_LAYOUT_RULES,
  }),
  node: freezeProfile({
    id: 'node', version: 1, bodyTitle: 'omit', canonicalSignature: 'when-distinct',
    order: ['summary', 'audience', 'canonical-signature', 'request', 'parameters', 'members', 'result-type', 'returns', 'exceptions', 'examples', 'extensions', 'notes', 'related'],
    fences: { 'canonical-signature': 'TypeScript', 'request-signature': 'TypeScript' },
    cardinality: { 'canonical-signature': [0, 1], 'request-signature': [0, Number.POSITIVE_INFINITY] },
    layoutRules: GLOBAL_LAYOUT_RULES,
  }),
  go: freezeProfile({
    id: 'go', version: 1, bodyTitle: 'omit', canonicalSignature: 'when-distinct',
    order: ['summary', 'audience', 'canonical-signature', 'request', 'parameters', 'members', 'result-type', 'returns', 'exceptions', 'examples', 'extensions', 'notes', 'related'],
    fences: { 'canonical-signature': 'Go', 'request-signature': 'Go', 'example-code': 'Go' },
    cardinality: { 'canonical-signature': [0, 1], 'request-signature': [0, 1] },
    layoutRules: GLOBAL_LAYOUT_RULES,
  }),
  cpp: freezeProfile({
    id: 'cpp', version: 2, bodyTitle: 'omit', canonicalSignature: 'when-distinct',
    order: ['summary', 'audience', 'canonical-signature', 'request', 'parameters', 'members', 'result-type', 'returns', 'exceptions', 'examples', 'extensions', 'notes', 'related'],
    fences: { 'canonical-signature': 'C++', 'request-signature': 'C++', 'example-code': 'C++' },
    cardinality: { 'canonical-signature': [0, 1], 'request-signature': [0, 1] },
    layoutRules: CPP_LAYOUT_RULES,
  }),
});

module.exports = profiles;

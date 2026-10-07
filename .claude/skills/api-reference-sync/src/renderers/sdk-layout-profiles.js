'use strict';

// Global structural layout rules (2026-09 campaign directives, all tracks):
// a single request type never gets its own H3, the Example section is a bare
// code block, and deprecation notices are titled two-line callouts. Rules a
// language does not declare do not apply to that language — absence is a
// reviewed decision in this data file, not a blind spot. layoutRules carries
// its own version so the renderer-shape version above (pinned by artifacts
// and contracts) stays untouched.
const GLOBAL_LAYOUT_RULES = Object.freeze({
  version: 4,
  requestH3: 'multi-only',
  requestHeadingPattern: 'Request$',
  exampleHeading: false,
  deprecation: Object.freeze({ shape: 'callout', lines: 2, firstLine: 'Notes', prosePattern: 'Deprecated in v' }),
  // 2026-10-03 global ruling: the five byte-judgeable content rules apply to
  // every track. Open-ended wording quality still stays with the governed
  // polish phase and model evals — these five are deterministic page facts.
  // 2026-10-04 adjudication (revised same day): two registered first-sentence
  // forms — operation (and getter) pages "This operation …", class/type
  // pages "A Xxx instance is …" (the standing corpus form).
  contentQuality: Object.freeze({
    cjkForbidden: true,
    firstSentencePattern: '^This operation\\b',
    firstSentencePatterns: Object.freeze(['^A \\w+ instance\\b']),
    returnsResponseFieldsRequired: true,
    paramDescRequired: true,
    bareNotesSectionForbidden: true,
    // 2026-10-07 operator ruling (py-v30 CollectionSchema review, durable
    // rule request): SDK-defined class mentions inside parameter/method
    // description prose must render as jump links. The renderer resolves
    // `Alias` inline code against the KB type-url index; this rule fails the
    // preview while an alias stays unresolved. Tokens that are language
    // primitives or vendor proper nouns — not SDK classes — are exempt here.
    descriptionTypeLinksRequired: true,
    descriptionTypeLinkDenylist: Object.freeze([
      'True', 'False', 'None', 'Python', 'Milvus', 'Zilliz', 'MilvusClient',
      'AWS', 'IAM', 'S3', 'ARN', 'URI', 'URL', 'JSON', 'SDK', 'HTTP', 'HTTPS', 'API', 'ID',
      // 2026-10-07 operator ruling (py-v30 search_iterator surgical plan):
      // metric-type literals rendered code-styled on operator-authored pages
      // are index-algorithm names, not SDK classes.
      'L2', 'IP', 'COSINE',
    ]),
  }),
});

// 2026-10-06 python ruling (operator doc review, py-v30 unit 1): request
// payloads render one parameter per line in the bare call form; parameter
// types are italic only; templated example intros ("Shows a typical …") are
// forbidden. Deterministic page facts enforced with the five global rules.
const PYTHON_LAYOUT_RULES = Object.freeze({
  ...GLOBAL_LAYOUT_RULES,
  contentQuality: Object.freeze({
    ...GLOBAL_LAYOUT_RULES.contentQuality,
    requestSignatureOneParamPerLine: true,
    parameterTypeEmphasisForbidden: true,
    templatedExampleIntroForbidden: true,
  }),
});

const CPP_LAYOUT_RULES = Object.freeze({
  ...GLOBAL_LAYOUT_RULES,
  builderSignature: Object.freeze({ prefixForbidden: Object.freeze(['Request& (With|Add)']) }),
});

// Java declares the 2026-10-01 return-section rules (semantic ruling: the
// return type and the RETURNS prose live in two separate labeled sections,
// the type token never repeats inside RETURNS, RETURNS carries prose). The
// 2026-10-03 global ruling puts the five content rules in the GLOBAL base
// every track declares, so only the split-section family stays java-only
// until other tracks adopt it with their repolish batches.
const JAVA_LAYOUT_RULES = Object.freeze({
  ...GLOBAL_LAYOUT_RULES,
  version: 4,
  returnSections: Object.freeze({ split: true }),
  returnsProseRequired: true,
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
    returnSections: rules.returnSections ? Object.freeze({ ...rules.returnSections }) : undefined,
    contentQuality: rules.contentQuality ? Object.freeze({ ...rules.contentQuality }) : undefined,
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
    layoutRules: PYTHON_LAYOUT_RULES,
  }),
  java: freezeProfile({
    id: 'java', version: 2, bodyTitle: 'omit', canonicalSignature: 'when-distinct',
    order: ['summary', 'audience', 'canonical-signature', 'request', 'parameters', 'members', 'result-type', 'returns', 'exceptions', 'examples', 'extensions', 'notes', 'related'],
    fences: { 'canonical-signature': 'Java', 'request-signature': 'Java', 'example-code': 'Java' },
    cardinality: { 'canonical-signature': [0, 1], 'request-signature': [0, Number.POSITIVE_INFINITY] },
    layoutRules: JAVA_LAYOUT_RULES,
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

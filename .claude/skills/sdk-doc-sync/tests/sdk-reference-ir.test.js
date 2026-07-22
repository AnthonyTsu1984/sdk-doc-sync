'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const schema = require('../src/sdk-reference-ir/schema');
const { validateReferenceDocument } = require('../src/sdk-reference-ir/validate');

const {
  DOCUMENT_KINDS,
  LANGUAGES,
  MEMBER_KINDS,
  EVIDENCE_KINDS,
  CONFIDENCE_LEVELS,
  createReferenceDocument,
  createField,
  createEvidence,
  createSignature,
  createRequestVariant,
  createCallableMember,
  createResult,
  createError,
  createExample,
  createTypeReference,
} = schema;

function sourceEvidence(overrides = {}) {
  return createEvidence({
    kind: 'source',
    locator: 'src/client.ts#L10-L30',
    revision: 'v2.6.0',
    confidence: 'direct',
    ...overrides,
  });
}

function completeMethod(overrides = {}) {
  return createReferenceDocument({
    identity: {
      kind: 'method',
      language: 'node',
      name: 'search',
      title: 'search()',
      stableId: 'node.MilvusClient.search',
    },
    source: {
      repository: 'milvus-sdk-node',
      revision: 'v2.6.0',
      file: 'src/milvus/MilvusClient.ts',
      line: 120,
    },
    summary: 'Searches a collection and returns matching entities.',
    signatures: [createSignature({
      display: 'search(params: SearchReq): Promise<SearchResults>',
      inputs: [createField({
        name: 'params',
        type: {
          display: 'SearchReq',
          references: [createTypeReference({ id: 'node.SearchReq', display: 'SearchReq' })],
        },
        required: true,
        description: 'Search request parameters.',
        children: [createField({
          name: 'collection_name',
          type: { display: 'string', references: [] },
          required: true,
          description: 'Collection to search.',
        })],
      })],
    })],
    requestVariants: [],
    callableMembers: [],
    result: createResult({
      type: { display: 'SearchResults', references: [] },
      description: 'The matched rows and scores.',
      fields: [createField({
        name: 'results',
        type: { display: 'SearchResult[]', references: [] },
        required: true,
        description: 'Matched entities.',
      })],
    }),
    errors: [createError({
      name: 'MilvusException',
      condition: 'The server rejects the request.',
      description: 'Contains the server error code and message.',
    })],
    examples: [createExample({
      title: 'Search a collection',
      description: 'Runs a vector search against the books collection.',
      language: 'node',
      code: 'await client.search({ collection_name: "books", data: [[0.1, 0.2]] });',
    })],
    notes: ['Use the same vector dimension as the target field.'],
    related: [{ title: 'Search guide', url: 'https://docs.example.test/search' }],
    audienceVariants: [{ audience: 'milvus', summary: 'Available in Milvus.' }],
    evidence: [sourceEvidence()],
    ...overrides,
  });
}

test('exports frozen schema enums with the complete supported vocabulary', () => {
  assert.deepEqual(DOCUMENT_KINDS, [
    'method', 'function', 'class', 'enum', 'struct', 'interface', 'command', 'rest-operation',
  ]);
  assert.deepEqual(LANGUAGES, ['python', 'java', 'node', 'go', 'cpp', 'zilliz-cli', 'rest']);
  assert.deepEqual(MEMBER_KINDS, ['builder', 'option', 'request']);
  assert.deepEqual(EVIDENCE_KINDS, ['source', 'openapi', 'existing-doc', 'curated']);
  assert.deepEqual(CONFIDENCE_LEVELS, ['direct', 'derived', 'reviewed']);
  for (const value of [DOCUMENT_KINDS, LANGUAGES, MEMBER_KINDS, EVIDENCE_KINDS, CONFIDENCE_LEVELS]) {
    assert.equal(Object.isFrozen(value), true);
  }
});

test('constructors deep-clone and freeze nested SDK reference data without freezing inputs', () => {
  const child = { name: 'limit', type: { display: 'number', references: [] }, constraints: ['positive'] };
  const input = {
    identity: { kind: 'method', language: 'node', name: 'list', title: 'list()', stableId: 'node.list' },
    source: { repository: 'repo', revision: 'v1', file: 'client.js', line: 10 },
    signatures: [{ display: 'list(options)', inputs: [child] }],
  };

  const doc = createReferenceDocument(input);
  child.constraints.push('bounded');
  input.identity.name = 'mutated';

  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.identity.name, 'list');
  assert.deepEqual(doc.signatures[0].inputs[0].constraints, ['positive']);
  assert.equal(Object.isFrozen(doc), true);
  assert.equal(Object.isFrozen(doc.signatures[0].inputs[0].type), true);
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(child), false);
  assert.throws(() => {
    doc.identity.name = 'cannot-change';
  }, TypeError);
});

test('constructors preserve supplied boolean values for validation instead of coercing them', () => {
  const reference = createTypeReference({ id: 'node.Filter', external: 'false' });
  const field = createField({
    name: 'filter',
    type: { display: 'Filter', references: [reference] },
    required: 'false',
    allowRequiredDefault: 'false',
  });
  const doc = completeMethod({
    signatures: [createSignature({ display: 'search(filter)', inputs: [field] })],
    exampleOptional: 'false',
  });

  assert.equal(reference.external, 'false');
  assert.equal(field.required, 'false');
  assert.equal(field.allowRequiredDefault, 'false');
  assert.equal(doc.exampleOptional, 'false');
  assert.equal(createTypeReference({ id: 'node.Filter' }).external, false);
  assert.equal(createField({ name: 'filter' }).required, false);
  assert.equal(createField({ name: 'filter' }).allowRequiredDefault, false);
  assert.equal(createReferenceDocument().exampleOptional, false);

  const errors = validateReferenceDocument(doc).errors;
  for (const path of [
    '$.signatures[0].inputs[0].type.references[0].external',
    '$.signatures[0].inputs[0].required',
    '$.signatures[0].inputs[0].allowRequiredDefault',
    '$.exampleOptional',
  ]) {
    assert.ok(errors.some((error) => error.path === path), path);
  }
});

test('production Python examples require one argument per line in multi-argument keyword calls', () => {
  const compact = completeMethod({
    identity: {
      kind: 'method', language: 'python', name: 'hybrid_search',
      title: 'hybrid_search()', stableId: 'python:Vector:hybrid_search',
    },
    examples: [createExample({
      title: 'Hybrid search',
      description: 'Runs a hybrid search.',
      language: 'python',
      code: 'request = AnnSearchRequest(data=[[0.1]], anns_field="vector", limit=10)',
    })],
  });
  const compactErrors = validateReferenceDocument(compact, {
    production: true,
    knownTypeIds: ['node.SearchReq'],
  }).errors;
  assert.ok(compactErrors.some((error) => error.code === 'PYTHON_CALL_ARGUMENTS_NOT_MULTILINE'));

  const readable = completeMethod({
    identity: compact.identity,
    examples: [createExample({
      title: 'Hybrid search',
      description: 'Runs a hybrid search.',
      language: 'python',
      code: [
        'request = AnnSearchRequest(',
        '    data=[[0.1]],',
        '    anns_field="vector",',
        '    limit=10,',
        ')',
      ].join('\n'),
    })],
  });
  const readableErrors = validateReferenceDocument(readable, {
    production: true,
    knownTypeIds: ['node.SearchReq'],
  }).errors;
  assert.equal(readableErrors.some((error) => error.code === 'PYTHON_CALL_ARGUMENTS_NOT_MULTILINE'), false);
});

test('optional raw boolean flags treat undefined as false but reject supplied non-booleans', () => {
  const original = completeMethod();
  const input = { ...original.signatures[0].inputs[0] };
  delete input.allowRequiredDefault;
  const doc = {
    ...original,
    signatures: [{ ...original.signatures[0], inputs: [input] }],
  };
  delete doc.exampleOptional;

  const omittedErrors = validateReferenceDocument(doc).errors;
  assert.equal(omittedErrors.some((error) => error.path
    === '$.signatures[0].inputs[0].allowRequiredDefault'), false);
  assert.equal(omittedErrors.some((error) => error.path === '$.exampleOptional'), false);

  const malformed = {
    ...doc,
    exampleOptional: 'false',
    signatures: [{
      ...doc.signatures[0],
      inputs: [{ ...input, allowRequiredDefault: 'false' }],
    }],
  };
  const malformedErrors = validateReferenceDocument(malformed).errors;
  assert.ok(malformedErrors.some((error) => error.path
    === '$.signatures[0].inputs[0].allowRequiredDefault'));
  assert.ok(malformedErrors.some((error) => error.path === '$.exampleOptional'));
});

test('validates one complete production method with recursive result and input fields', () => {
  const result = validateReferenceDocument(completeMethod(), {
    production: true,
    knownTypeIds: ['node.SearchReq'],
  });

  assert.deepEqual(result, { valid: true, errors: [], warnings: [] });
});

test('supports two unique Node request variants and rejects duplicate variant IDs and inputs', () => {
  const variant = (id, inputs) => createRequestVariant({
    id,
    title: id,
    description: `The ${id} request shape.`,
    signature: createSignature({ display: `search(${id})`, inputs }),
    inputs,
  });
  const baseInputs = [createField({
    name: 'collection_name',
    type: { display: 'string', references: [] },
    required: true,
    description: 'Collection name.',
  })];
  const valid = completeMethod({
    requestVariants: [variant('promise', baseInputs), variant('callback', baseInputs)],
  });
  assert.equal(validateReferenceDocument(valid).valid, true);

  const malformed = {
    ...valid,
    requestVariants: [
      variant('promise', baseInputs),
      variant('promise', [...baseInputs, { ...baseInputs[0] }]),
    ],
  };
  const errors = validateReferenceDocument(malformed).errors;
  assert.ok(errors.some((error) => error.code === 'DUPLICATE_VARIANT_ID'
    && error.path === '$.requestVariants[1].id'));
  assert.ok(errors.some((error) => error.code === 'DUPLICATE_FIELD_NAME'
    && error.path === '$.requestVariants[1].inputs[1].name'));
});

function platformPythonMethod(overrides = {}) {
  const url = createField({
    name: 'url',
    type: { display: 'str', references: [] },
    required: true,
    audience: 'shared',
    descriptions: {
      milvus: 'The Milvus server endpoint, such as `http://localhost:19530`.',
      zilliz: 'The Zilliz Cloud API server endpoint, which is `https://api.cloud.zilliz.com`.',
    },
  });
  const files = createField({
    name: 'files',
    type: { display: 'list[str]', references: [] },
    audience: 'milvus',
    description: 'The files containing the data to import.',
  });
  const projectId = createField({
    name: 'project_id',
    type: { display: 'str', references: [] },
    audience: 'zilliz',
    description: 'The ID of the Zilliz Cloud project containing the target database.',
  });
  const fields = [url, files, projectId];
  const variant = (audience, parameters) => createRequestVariant({
    id: audience,
    title: `${audience} request`,
    audience,
    parameters,
    signature: createSignature({
      display: `submit(${parameters.join(', ')})`,
      inputs: fields.filter((field) => parameters.includes(field.name)),
    }),
    inputs: fields.filter((field) => parameters.includes(field.name)),
  });
  return createReferenceDocument({
    identity: {
      kind: 'function', language: 'python', name: 'submit', title: 'submit()', stableId: 'python.submit',
    },
    source: {
      repository: 'milvus-io/pymilvus', revision: 'v2.6.0', file: 'client.py', line: 10,
    },
    summary: 'Submits data to the configured service.',
    signatures: [createSignature({ display: 'submit(url, files=None, project_id="")', inputs: fields })],
    requestVariants: [
      variant('milvus', ['url', 'files']),
      variant('zilliz', ['url', 'project_id']),
    ],
    result: createResult({
      type: { display: 'Response', references: [] },
      description: 'The service response.',
      fields: [],
    }),
    examples: [
      createExample({
        title: 'Milvus example', audience: 'milvus', language: 'python',
        code: 'submit(url="http://localhost:19530", files=["data.json"])',
      }),
      createExample({
        title: 'Zilliz Cloud example', audience: 'zilliz', language: 'python',
        code: 'submit(url="https://api.cloud.zilliz.com", project_id="project")',
      }),
    ],
    evidence: [sourceEvidence({ locator: 'client.py#L10-L30' })],
    ...overrides,
  });
}

test('production rejects invalid audience description shapes', () => {
  const doc = platformPythonMethod();
  const malformedUrl = {
    ...doc.signatures[0].inputs[0],
    description: 'The server endpoint.',
  };
  const malformed = {
    ...doc,
    signatures: [{ ...doc.signatures[0], inputs: [malformedUrl, ...doc.signatures[0].inputs.slice(1)] }],
  };

  const errors = validateReferenceDocument(malformed, { production: true }).errors;
  assert.ok(errors.some((error) => error.code === 'INVALID_AUDIENCE_DESCRIPTION_SHAPE'
    && error.path === '$.signatures[0].inputs[0]'));
});

test('production rejects unknown and cross-audience request parameters', () => {
  const doc = platformPythonMethod();
  const invalid = {
    ...doc,
    requestVariants: [{
      ...doc.requestVariants[0],
      parameters: ['url', 'project_id', 'missing'],
      inputs: [doc.signatures[0].inputs[0], doc.signatures[0].inputs[2], createField({
        name: 'missing', type: { display: 'str', references: [] }, description: 'The missing value.',
      })],
    }, doc.requestVariants[1]],
  };

  const errors = validateReferenceDocument(invalid, { production: true }).errors;
  assert.ok(errors.some((error) => error.code === 'UNKNOWN_VARIANT_PARAMETER'));
  assert.ok(errors.some((error) => error.code === 'AUDIENCE_PARAMETER_LEAK'));
});

test('production requires request and example coverage for every platform audience', () => {
  const doc = platformPythonMethod({
    requestVariants: [platformPythonMethod().requestVariants[0]],
    examples: [platformPythonMethod().examples[0]],
  });

  const errors = validateReferenceDocument(doc, { production: true }).errors;
  assert.ok(errors.some((error) => error.code === 'MISSING_REQUEST_AUDIENCE'
    && error.path === '$.requestVariants'));
  assert.ok(errors.some((error) => error.code === 'MISSING_EXAMPLE_AUDIENCE'
    && error.path === '$.examples'));
});

test('production enforces platform-correct example endpoints', () => {
  const doc = platformPythonMethod();
  const invalid = {
    ...doc,
    examples: [
      { ...doc.examples[0], code: 'submit(url="https://api.cloud.zilliz.com", files=["data.json"])' },
      { ...doc.examples[1], code: 'submit(url="https://cloud.example.test", project_id="project")' },
    ],
  };

  const errors = validateReferenceDocument(invalid, { production: true }).errors;
  assert.equal(errors.filter((error) => error.code === 'INVALID_PLATFORM_ENDPOINT').length, 2);
});

test('preserves recursive field details and reports duplicate sibling field names at exact paths', () => {
  const field = createField({
    name: 'options',
    type: { display: 'object', references: [] },
    required: false,
    defaultValue: null,
    description: 'Optional search controls.',
    constraints: ['At most 100 results.'],
    appliesWhen: 'search mode is vector',
    evidence: [sourceEvidence()],
    children: [
      createField({ name: 'limit', type: { display: 'number', references: [] }, description: 'Maximum results.' }),
      createField({ name: 'limit', type: { display: 'number', references: [] }, description: 'Duplicate.' }),
    ],
  });
  assert.equal(field.appliesWhen, 'search mode is vector');
  assert.equal(field.evidence[0].kind, 'source');

  const doc = completeMethod({
    signatures: [createSignature({ display: 'search(options)', inputs: [field] })],
  });
  const duplicate = validateReferenceDocument(doc).errors.find(
    (error) => error.code === 'DUPLICATE_FIELD_NAME',
  );
  assert.equal(duplicate.path, '$.signatures[0].inputs[0].children[1].name');
});

test('validates callable member kinds and signatures with path-aware errors', () => {
  const doc = completeMethod({
    callableMembers: [
      createCallableMember({
        kind: 'builder',
        name: 'withLimit',
        signature: createSignature({ display: 'withLimit(limit: number): SearchReq', inputs: [] }),
      }),
      { kind: 'unknown', name: 'broken', signature: null },
    ],
  });
  const errors = validateReferenceDocument(doc).errors;

  assert.ok(errors.some((error) => error.path === '$.callableMembers[1].kind'));
  assert.ok(errors.some((error) => error.path === '$.callableMembers[1].signature'));
});

test('rejects duplicate callable member kind and name keys at the second member', () => {
  const member = (kind, name) => createCallableMember({
    kind,
    name,
    signature: createSignature({ display: `${name}()`, inputs: [] }),
  });
  const errors = validateReferenceDocument(completeMethod({
    callableMembers: [member('builder', 'withLimit'), member('builder', 'withLimit')],
  })).errors;

  assert.deepEqual(errors.find((error) => error.code === 'DUPLICATE_CALLABLE_MEMBER'), {
    path: '$.callableMembers[1]',
    message: 'callable member builder:withLimit duplicates $.callableMembers[0]',
    code: 'DUPLICATE_CALLABLE_MEMBER',
  });
});

test('allows callable members with distinct kinds or names', () => {
  const member = (kind, name) => createCallableMember({
    kind,
    name,
    signature: createSignature({ display: `${name}()`, inputs: [] }),
  });
  const doc = completeMethod({
    callableMembers: [
      member('builder', 'withLimit'),
      member('option', 'withLimit'),
      member('builder', 'withTimeout'),
    ],
  });

  assert.equal(validateReferenceDocument(doc).valid, true);
});

test('enforces command and enum forbidden-section policies in production', () => {
  const command = completeMethod({
    identity: {
      kind: 'command', language: 'zilliz-cli', name: 'cluster list',
      title: 'zilliz cluster list', stableId: 'cli.cluster.list',
    },
  });
  const commandErrors = validateReferenceDocument(command, { production: true }).errors;
  assert.ok(commandErrors.some((error) => error.code === 'COMMAND_FORBIDDEN_RESULT'));
  assert.ok(commandErrors.some((error) => error.code === 'COMMAND_FORBIDDEN_ERRORS'));

  const enumDoc = completeMethod({
    identity: {
      kind: 'enum', language: 'node', name: 'MetricType',
      title: 'MetricType', stableId: 'node.MetricType',
    },
    requestVariants: [createRequestVariant({
      id: 'invalid-enum-variant',
      title: 'Invalid variant',
      description: 'Enums cannot have request variants.',
      signature: createSignature({ display: 'MetricType()', inputs: [] }),
      inputs: [],
    })],
    callableMembers: [createCallableMember({
      kind: 'builder',
      name: 'invalidMember',
      signature: createSignature({ display: 'invalidMember()', inputs: [] }),
    })],
  });
  const enumErrors = validateReferenceDocument(enumDoc, { production: true }).errors;
  assert.ok(enumErrors.some((error) => error.code === 'ENUM_FORBIDDEN_VARIANTS'));
  assert.ok(enumErrors.some((error) => error.code === 'ENUM_FORBIDDEN_MEMBERS'));
});

test('production rejects every placeholder pattern anywhere in authored content', () => {
  const placeholders = [
    'TODO explain this',
    'tBd after review',
    'todo:',
    'ToDo-later',
    'todo fix this',
    'todo pending approval',
    'todo replace this value',
    'todo add validation',
    'todo update the example',
    'todo review this path',
    'todo implement retries',
    'todo document the result',
    'todo describe the error',
    'todo example',
    'Brief description of the method',
    'Usage example goes here',
    'List relevant exceptions',
    '<!-- TODO: document the response -->',
  ];

  for (const placeholder of placeholders) {
    const result = validateReferenceDocument(completeMethod({
      notes: [`Safe note before ${placeholder} safe note after.`],
    }), { production: true, knownTypeIds: ['node.SearchReq'] });
    const error = result.errors.find((item) => item.code === 'PLACEHOLDER_CONTENT');
    assert.ok(error, placeholder);
    assert.equal(error.path, '$.notes[0]');
  }
});

test('placeholder scanning permits Todo identifiers and type names but rejects exact lowercase tokens', () => {
  const todoType = createField({
    name: 'item',
    type: {
      display: 'Todo',
      references: [createTypeReference({ id: 'java.Todo', display: 'Todo' })],
    },
    description: 'The item managed by the Todo client.',
  });
  const legitimate = completeMethod({
    identity: {
      kind: 'method', language: 'java', name: 'Todo',
      title: 'Todo', stableId: 'java.Todo.search',
    },
    source: {
      repository: 'milvus-sdk-java', revision: 'v2.6.0', file: 'Todo.java', line: 10,
    },
    summary: 'Todo clients manage task records.',
    signatures: [createSignature({ display: 'Todo search(Todo item)', inputs: [todoType] })],
  });
  const legitimateErrors = validateReferenceDocument(legitimate, {
    production: true,
    knownTypeIds: ['java.Todo'],
  }).errors;
  assert.equal(legitimateErrors.some((error) => error.code === 'PLACEHOLDER_CONTENT'), false);

  const placeholderErrors = validateReferenceDocument(completeMethod({ notes: ['todo'] }), {
    production: true,
    knownTypeIds: ['node.SearchReq'],
  }).errors;
  assert.ok(placeholderErrors.some((error) => error.code === 'PLACEHOLDER_CONTENT'
    && error.path === '$.notes[0]'));
});

test('production requires summaries, signatures, and examples', () => {
  const missing = completeMethod({ summary: '', signatures: [], examples: [] });
  const errors = validateReferenceDocument(missing, { production: true }).errors;
  assert.ok(errors.some((error) => error.path === '$.summary'));
  assert.ok(errors.some((error) => error.path === '$.signatures'));
  assert.ok(errors.some((error) => error.path === '$.examples'));
});

test('production classes without examples fail with MISSING_EXAMPLE', () => {
  const classDoc = completeMethod({
    identity: {
      kind: 'class', language: 'python', name: 'Collection',
      title: 'Collection', stableId: 'python.Collection',
    },
    signatures: [],
    examples: [],
  });

  assert.ok(validateReferenceDocument(classDoc, { production: true }).errors
    .some((error) => error.code === 'MISSING_EXAMPLE' && error.path === '$.examples'));
});

test('production classes may explicitly opt out of examples', () => {
  const classDoc = completeMethod({
    identity: {
      kind: 'class', language: 'python', name: 'Collection',
      title: 'Collection', stableId: 'python.Collection',
    },
    signatures: [],
    examples: [],
    exampleOptional: true,
  });

  assert.equal(validateReferenceDocument(classDoc, { production: true }).errors
    .some((error) => error.code === 'MISSING_EXAMPLE'), false);
});

test('production validates evidence confidence and requires reviewed support for derived content', () => {
  const invalidEvidence = completeMethod({
    evidence: [{ kind: 'source', locator: '', revision: '', confidence: 'guess' }],
  });
  const structural = validateReferenceDocument(invalidEvidence);
  assert.ok(structural.errors.some((error) => error.path === '$.evidence[0].locator'));
  assert.ok(structural.errors.some((error) => error.path === '$.evidence[0].confidence'));

  const derived = completeMethod({ evidence: [sourceEvidence({ confidence: 'derived' })] });
  assert.ok(validateReferenceDocument(derived, { production: true, knownTypeIds: ['node.SearchReq'] })
    .errors.some((error) => error.code === 'MISSING_REVIEWED_EVIDENCE'));

  const reviewed = completeMethod({
    evidence: [createEvidence({
      kind: 'curated', locator: 'review/sdk-reference-123', revision: '2026-07-18', confidence: 'reviewed',
    })],
  });
  assert.equal(validateReferenceDocument(reviewed, {
    production: true,
    knownTypeIds: ['node.SearchReq'],
  }).valid, true);
});

test('production evidence scope prefers node evidence and uses document reviews only as approval', () => {
  const derived = sourceEvidence({ confidence: 'derived' });
  const reviewed = createEvidence({
    kind: 'curated', locator: 'review/sdk-reference-456', revision: '2026-07-18', confidence: 'reviewed',
  });
  const signature = (evidence) => createSignature({ display: 'search()', inputs: [], evidence });
  const signatureEvidencePath = '$.signatures[0].evidence';

  const directNode = validateReferenceDocument(completeMethod({
    signatures: [signature([sourceEvidence()])],
    evidence: [derived],
  }), { production: true }).errors;
  assert.equal(directNode.some((error) => error.path === signatureEvidencePath), false);

  const reviewedDerivedNode = validateReferenceDocument(completeMethod({
    signatures: [signature([derived])],
    evidence: [reviewed],
  }), { production: true }).errors;
  assert.equal(reviewedDerivedNode.some((error) => error.path === signatureEvidencePath), false);

  const reviewedCuratedDirectNode = validateReferenceDocument(completeMethod({
    signatures: [signature([createEvidence({
      kind: 'curated', locator: 'curated/sdk-reference-456', revision: '2026-07-18', confidence: 'direct',
    })])],
    evidence: [reviewed],
  }), { production: true }).errors;
  assert.equal(reviewedCuratedDirectNode.some((error) => error.path === signatureEvidencePath), false);

  const unrelatedDerived = validateReferenceDocument(completeMethod({
    signatures: [signature([derived])],
    evidence: [derived],
  }), { production: true }).errors;
  assert.ok(unrelatedDerived.some((error) => error.code === 'MISSING_REVIEWED_EVIDENCE'
    && error.path === signatureEvidencePath));

  const inheritedDirect = validateReferenceDocument(completeMethod({
    signatures: [signature([])],
    evidence: [sourceEvidence()],
  }), { production: true }).errors;
  assert.equal(inheritedDirect.some((error) => error.path === signatureEvidencePath), false);

  const inheritedDerived = validateReferenceDocument(completeMethod({
    signatures: [signature([])],
    evidence: [derived],
  }), { production: true }).errors;
  assert.ok(inheritedDerived.some((error) => error.code === 'MISSING_REVIEWED_EVIDENCE'
    && error.path === signatureEvidencePath));
});

test('production enforces document family and language compatibility', () => {
  const incompatible = [
    ['command', 'node'],
    ['rest-operation', 'python'],
    ['method', 'rest'],
  ];
  for (const [kind, language] of incompatible) {
    const doc = completeMethod({
      identity: { kind, language, name: 'search', title: 'search', stableId: `${language}.search` },
    });
    assert.ok(validateReferenceDocument(doc, {
      production: true,
      knownTypeIds: ['node.SearchReq'],
    }).errors.some((error) => error.code === 'INCOMPATIBLE_DOCUMENT_LANGUAGE'
      && error.path === '$.identity.language'), `${kind}/${language}`);
  }

  for (const [kind, language] of [['command', 'zilliz-cli'], ['rest-operation', 'rest'], ['method', 'cpp']]) {
    const doc = completeMethod({
      identity: { kind, language, name: 'search', title: 'search', stableId: `${language}.search` },
      ...(kind === 'command' ? { result: null, errors: [] } : {}),
    });
    assert.equal(validateReferenceDocument(doc, {
      production: true,
      knownTypeIds: ['node.SearchReq'],
    }).errors.some((error) => error.code === 'INCOMPATIBLE_DOCUMENT_LANGUAGE'), false, `${kind}/${language}`);
  }
});

test('production enforces language-specific callable member kinds', () => {
  const member = (kind) => createCallableMember({
    kind,
    name: `with-${kind}`,
    signature: createSignature({ display: `${kind}()`, inputs: [] }),
  });
  for (const [language, kind] of [['java', 'builder'], ['go', 'option'], ['cpp', 'request']]) {
    const doc = completeMethod({
      identity: { kind: 'method', language, name: 'search', title: 'search', stableId: `${language}.search` },
      callableMembers: [member(kind)],
    });
    assert.equal(validateReferenceDocument(doc, {
      production: true,
      knownTypeIds: ['node.SearchReq'],
    }).errors.some((error) => error.code === 'INCOMPATIBLE_MEMBER_KIND'), false, `${language}/${kind}`);
  }

  for (const [language, kind] of [['java', 'option'], ['go', 'request'], ['cpp', 'builder'], ['node', 'builder']]) {
    const doc = completeMethod({
      identity: { kind: 'method', language, name: 'search', title: 'search', stableId: `${language}.search` },
      callableMembers: [member(kind)],
    });
    assert.ok(validateReferenceDocument(doc, {
      production: true,
      knownTypeIds: ['node.SearchReq'],
    }).errors.some((error) => error.code === 'INCOMPATIBLE_MEMBER_KIND'
      && error.path === '$.callableMembers[0].kind'), `${language}/${kind}`);
  }
});

test('production rejects required defaults and unresolved internal type references', () => {
  const requiredWithDefault = createField({
    name: 'timeout',
    type: {
      display: 'Duration',
      references: [createTypeReference({ id: 'common.Duration', display: 'Duration' })],
    },
    required: true,
    defaultValue: 30,
    description: 'Request timeout.',
  });
  const doc = completeMethod({
    signatures: [createSignature({ display: 'search(timeout)', inputs: [requiredWithDefault] })],
  });
  const errors = validateReferenceDocument(doc, { production: true, knownTypeIds: [] }).errors;
  assert.ok(errors.some((error) => error.code === 'REQUIRED_FIELD_DEFAULT'
    && error.path === '$.signatures[0].inputs[0].defaultValue'));
  assert.ok(errors.some((error) => error.code === 'UNRESOLVED_TYPE_REFERENCE'
    && error.path === '$.signatures[0].inputs[0].type.references[0].id'));

  const allowed = {
    ...doc,
    signatures: [{
      ...doc.signatures[0],
      inputs: [{ ...requiredWithDefault, allowRequiredDefault: true }],
    }],
  };
  assert.equal(validateReferenceDocument(allowed, {
    production: true,
    knownTypeIds: ['common.Duration'],
  }).errors.some((error) => error.code === 'REQUIRED_FIELD_DEFAULT'), false);
});

test('validation is cycle-safe for recursive field graphs', () => {
  const field = {
    name: 'recursive',
    type: { display: 'Recursive', references: [] },
    required: false,
    defaultValue: null,
    description: 'A malformed recursive field.',
    constraints: [],
    children: [],
    appliesWhen: null,
    evidence: [],
  };
  field.children.push(field);
  const doc = completeMethod({
    signatures: [{ display: 'search(recursive)', inputs: [field], evidence: [] }],
  });

  const result = validateReferenceDocument(doc);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'FIELD_CYCLE'
    && error.path === '$.signatures[0].inputs[0].children[0]'));
});

test('production validates result, error, example, source, and audience node shapes', () => {
  const doc = completeMethod({
    source: { repository: '', revision: '', file: '', line: 0 },
    result: { type: null, description: '', fields: 'bad', evidence: [] },
    errors: [{ name: '', condition: '', description: '', evidence: 'bad' }],
    examples: [{ title: '', description: '', language: 'ruby', code: '', evidence: [] }],
    audienceVariants: [{ audience: '', summary: 10 }, { audience: 'milvus', summary: 'one' }, { audience: 'milvus', summary: 'two' }],
  });
  const result = validateReferenceDocument(doc, { production: true });

  for (const path of [
    '$.source.repository', '$.source.revision', '$.source.file', '$.source.line',
    '$.result.type', '$.result.fields', '$.errors[0].name', '$.examples[0].code',
    '$.examples[0].language', '$.audienceVariants[0].audience',
    '$.audienceVariants[2].audience',
  ]) {
    assert.ok(result.errors.some((error) => error.path === path), path);
  }
});

test('warnings cover external references, missing related links, and shallow examples without invalidating', () => {
  const doc = completeMethod({
    signatures: [createSignature({
      display: 'search(options)',
      inputs: [createField({
        name: 'options',
        type: {
          display: 'ExternalOptions',
          references: [createTypeReference({ id: 'vendor.ExternalOptions', display: 'ExternalOptions', external: true })],
        },
        description: 'Vendor-defined options.',
      })],
    })],
    examples: [createExample({ title: 'Short', description: 'A minimal call.', language: 'node', code: 'search();' })],
    related: [],
  });

  const result = validateReferenceDocument(doc);

  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((warning) => warning.code === 'EXTERNAL_TYPE_REFERENCE'
    && warning.path === '$.signatures[0].inputs[0].type.references[0]'));
  assert.ok(result.warnings.some((warning) => warning.code === 'MISSING_RELATED_LINKS'
    && warning.path === '$.related'));
  assert.ok(result.warnings.some((warning) => warning.code === 'SHALLOW_EXAMPLE'
    && warning.path === '$.examples[0].code'));
});

test('type references reject duplicate IDs and warn only for structurally valid external references', () => {
  const doc = completeMethod({
    signatures: [createSignature({
      display: 'search(options)',
      inputs: [createField({
        name: 'options',
        type: {
          display: 'Options',
          references: [
            createTypeReference({ id: 'vendor.Options', external: true }),
            createTypeReference({ id: 'vendor.Options', external: true }),
            createTypeReference({ id: '', display: 10, external: true }),
          ],
        },
      })],
    })],
  });
  const result = validateReferenceDocument(doc);

  assert.ok(result.errors.some((error) => error.code === 'DUPLICATE_TYPE_REFERENCE_ID'
    && error.path === '$.signatures[0].inputs[0].type.references[1].id'));
  assert.equal(result.warnings.filter((warning) => warning.code === 'EXTERNAL_TYPE_REFERENCE').length, 1);
  assert.ok(result.warnings.some((warning) => warning.path
    === '$.signatures[0].inputs[0].type.references[0]'));
  assert.equal(result.warnings.some((warning) => warning.path
    === '$.signatures[0].inputs[0].type.references[1]'), false);
  assert.equal(result.warnings.some((warning) => warning.path
    === '$.signatures[0].inputs[0].type.references[2]'), false);
});

test('related links reject protocol-relative URLs and retain supported destinations', () => {
  const urls = [
    '/guide', './guide', '../guide', '#search',
    'http://docs.example.test/search', 'https://docs.example.test/search',
    'mailto:docs@example.test', '//attacker.example.test/search',
    ' https://docs.example.test/search', 'https://docs.example.test/search ',
    'mailto:', 'mailto:?subject=search',
  ];
  const result = validateReferenceDocument(completeMethod({
    related: urls.map((url) => ({ title: url, url })),
  }));

  assert.deepEqual(result.errors.filter((error) => error.code === 'INVALID_RELATED_LINK')
    .map((error) => error.path), [
      '$.related[7].url', '$.related[8].url', '$.related[9].url',
      '$.related[10].url', '$.related[11].url',
    ]);
});

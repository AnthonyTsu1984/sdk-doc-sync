const test = require('node:test');
const assert = require('node:assert/strict');

const { FEISHU_LABEL_MAP, planApplyOperations, summarizeApplyResults } = require('../src/apply');

test('planApplyOperations chooses replace or insert per section and language order', () => {
  const sections = [
    {
      heading: 'Create Collection',
      operationKey: 'collections/create_collection',
      codeBlocks: [
        { blockId: 'blk-python', languageLabel: 'Python', code: 'old python' },
        { blockId: 'blk-node', languageLabel: 'JavaScript', code: 'old node' },
      ],
    },
  ];

  const candidates = [
    { operationKey: 'collections/create_collection', language: 'python' },
    { operationKey: 'collections/create_collection', language: 'java' },
    { operationKey: 'collections/create_collection', language: 'node' },
    { operationKey: 'collections/drop_collection', language: 'go' },
  ];

  const planned = planApplyOperations({
    sections,
    candidates,
    languageOrder: ['python', 'java', 'node', 'go'],
  });

  assert.equal(FEISHU_LABEL_MAP.python, 'Python');
  assert.equal(FEISHU_LABEL_MAP.node, 'JavaScript');
  assert.equal(FEISHU_LABEL_MAP.rest, 'Bash');
  assert.equal(FEISHU_LABEL_MAP.cli, 'Shell');

  assert.deepEqual(planned.results, [
    {
      status: 'patched',
      type: 'replace',
      operationKey: 'collections/create_collection',
      language: 'python',
      sectionHeading: 'Create Collection',
      blockId: 'blk-python',
      targetLanguageLabel: 'Python',
    },
    {
      status: 'patched',
      type: 'insert',
      operationKey: 'collections/create_collection',
      language: 'java',
      sectionHeading: 'Create Collection',
      afterBlockId: 'blk-python',
      targetLanguageLabel: 'Java',
    },
    {
      status: 'patched',
      type: 'replace',
      operationKey: 'collections/create_collection',
      language: 'node',
      sectionHeading: 'Create Collection',
      blockId: 'blk-node',
      targetLanguageLabel: 'JavaScript',
    },
    {
      status: 'skipped',
      reason: 'section_not_found',
      operationKey: 'collections/drop_collection',
      language: 'go',
      targetLanguageLabel: 'Go',
    },
  ]);

  assert.deepEqual(planned.summary, { patched: 3, skipped: 1, failed: 0, unknown: 0 });
});

test('planApplyOperations keeps rest/cli detection isolated to avoid cross-language replacements', () => {
  const sections = [
    {
      heading: 'Search',
      operationKey: 'vectors/search',
      codeBlocks: [{ blockId: 'blk-bash', languageLabel: 'Bash', code: 'old rest block' }],
    },
    {
      heading: 'Query',
      operationKey: 'vectors/query',
      codeBlocks: [{ blockId: 'blk-shell', languageLabel: 'Shell', code: 'old cli block' }],
    },
  ];

  const candidates = [
    { operationKey: 'vectors/search', language: 'cli' },
    { operationKey: 'vectors/query', language: 'rest' },
  ];

  const planned = planApplyOperations({
    sections,
    candidates,
    languageOrder: ['rest', 'cli'],
  });

  assert.deepEqual(planned.results, [
    {
      status: 'patched',
      type: 'insert',
      operationKey: 'vectors/search',
      language: 'cli',
      sectionHeading: 'Search',
      afterBlockId: 'blk-bash',
      targetLanguageLabel: 'Shell',
    },
    {
      status: 'patched',
      type: 'insert',
      operationKey: 'vectors/query',
      language: 'rest',
      sectionHeading: 'Query',
      beforeBlockId: 'blk-shell',
      targetLanguageLabel: 'Bash',
    },
  ]);

  assert.deepEqual(planned.summary, { patched: 2, skipped: 0, failed: 0, unknown: 0 });
});

test('summarizeApplyResults counts patched/skipped/failed', () => {
  const summary = summarizeApplyResults([
    { status: 'patched' },
    { status: 'patched' },
    { status: 'skipped' },
    { status: 'failed' },
  ]);

  assert.deepEqual(summary, { patched: 2, skipped: 1, failed: 1, unknown: 0 });
});

test('summarizeApplyResults tracks unknown status explicitly', () => {
  const summary = summarizeApplyResults([
    { status: 'patched' },
    { status: 'mystery' },
    { status: null },
  ]);

  assert.deepEqual(summary, { patched: 1, skipped: 0, failed: 0, unknown: 2 });
});

test('planApplyOperations inserts before first block when no predecessor exists', () => {
  const sections = [
    {
      heading: 'Describe Collection',
      operationKey: 'collections/describe_collection',
      codeBlocks: [{ blockId: 'blk-node', languageLabel: 'JavaScript', code: 'old node' }],
    },
  ];

  const candidates = [{ operationKey: 'collections/describe_collection', language: 'python' }];

  const planned = planApplyOperations({
    sections,
    candidates,
    languageOrder: ['python', 'node'],
  });

  assert.deepEqual(planned.results, [
    {
      status: 'patched',
      type: 'insert',
      operationKey: 'collections/describe_collection',
      language: 'python',
      sectionHeading: 'Describe Collection',
      beforeBlockId: 'blk-node',
      targetLanguageLabel: 'Python',
    },
  ]);

  assert.deepEqual(planned.summary, { patched: 1, skipped: 0, failed: 0, unknown: 0 });
});

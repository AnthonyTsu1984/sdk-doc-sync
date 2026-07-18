'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { exportDocument } = require('../bin/export-doc');
const { parseArgs, runCliFetchAndDiff } = require('../scripts/cli-fetch-and-diff');
const FeishuDocTranslator = require('../src/feishu-doc-translator');

test('exportDocument reads through an injected Document IR markdown reader and writes once', async () => {
  const calls = [];
  const result = await exportDocument({
    input: 'https://example.feishu.cn/docx/doc-token',
    outputFile: '/tmp/exported.md',
    documentReader: {
      async readMarkdown(token) {
        calls.push(['readMarkdown', token]);
        return '# Exported\n';
      },
    },
    writeFile(file, content) {
      calls.push(['writeFile', file, content]);
    },
    log() {},
  });

  assert.equal(result.token, 'doc-token');
  assert.equal(result.markdown, '# Exported\n');
  assert.deepEqual(calls, [
    ['readMarkdown', 'doc-token'],
    ['writeFile', '/tmp/exported.md', '# Exported\n'],
  ]);
});

test('runCliFetchAndDiff classifies identical, different, fetch-only, scanner-only, and failed docs', async () => {
  const written = [];
  const summary = await runCliFetchAndDiff({
    indexReader: {
      async listDocuments() {
        return [
          { id: 'rec-identical', parent: 'parent', metadata: { type: 'Function', title: 'same', slug: 'Cluster-same' } },
          { id: 'rec-different', parent: 'parent', metadata: { type: 'Function', title: 'diff', slug: 'Cluster-diff' } },
          { id: 'rec-fetch-only', parent: 'parent', metadata: { type: 'Function', title: 'fetchOnly', slug: 'Cluster-fetchOnly' } },
          { id: 'rec-failed', parent: 'parent', metadata: { type: 'Function', title: 'failed', slug: 'Cluster-failed' } },
          { id: 'parent', metadata: { type: 'VirtualNode', title: 'Cluster', slug: 'Cluster' } },
        ];
      },
    },
    documentReader: {
      async readMarkdown(record) {
        if (record.metadata.title === 'failed') throw new Error('fetch failed');
        return `${record.metadata.title}\n`;
      },
    },
    scanner: {
      async scan() {
        return [
          { parentClass: 'Cluster', name: 'same' },
          { parentClass: 'Cluster', name: 'diff' },
          { parentClass: 'Cluster', name: 'scannerOnly' },
        ];
      },
    },
    generator: {
      generate(symbol) {
        return symbol.name === 'diff' ? 'generated diff\n' : `${symbol.name}\n`;
      },
    },
    outputDir: '/tmp/cli-docs',
    mkdir() {},
    writeFile(file, content) { written.push([file, content]); },
    log() {},
    delay: async () => {},
  });

  assert.equal(summary.identical, 1);
  assert.equal(summary.different, 1);
  assert.equal(summary.fetchOnly, 1);
  assert.equal(summary.scannerOnly, 1);
  assert.equal(summary.failed, 1);
  assert.deepEqual(summary.results.map((entry) => entry.status).sort(), [
    'different', 'failed', 'fetch-only', 'identical', 'scanner-only',
  ]);
  assert.ok(written.some(([file]) => file.endsWith('/Cluster-same/feishu.md')));
  assert.ok(written.some(([file]) => file.endsWith('/Cluster-diff/generated.md')));
});

test('cli-fetch-and-diff accepts table-id alongside base token and SDK inputs', () => {
  const options = parseArgs([
    '--base-token=base123',
    '--table-id=tbl123',
    '--sdk-dir=/tmp/zilliz-cli',
    '--sdk-version=v0.2.x',
  ]);

  assert.equal(options.baseToken, 'base123');
  assert.equal(options.tableId, 'tbl123');
  assert.equal(options.sdkDir, '/tmp/zilliz-cli');
  assert.equal(options.sdkVersion, 'v0.2.x');
});

test('FeishuDocTranslator reads source Markdown through an injected reader pipeline', async () => {
  const calls = [];
  const translator = new FeishuDocTranslator({
    sourceBitable: 'source-base',
    targetBitable: 'target-base',
    sourceRoot: 'source-root',
    targetRoot: 'target-root',
    dryRun: true,
    translator: {
      async translateMarkdown(markdown) { return markdown; },
    },
    sourceDocumentReader: {
      async readMarkdown(record) {
        calls.push(record.metadata.slug);
        return '# translated source\n';
      },
    },
  });

  const markdown = await translator._fetchSourceMarkdown({
    metadata: { slug: 'Collections-createCollection', token: 'doc-source' },
  });

  assert.equal(markdown, '# translated source\n');
  assert.deepEqual(calls, ['Collections-createCollection']);
});

test('FeishuDocTranslator default source Markdown fallback uses the shared document reader pipeline', async () => {
  const calls = [];
  const translator = new FeishuDocTranslator({
    sourceBitable: 'source-base',
    targetBitable: 'target-base',
    sourceRoot: 'source-root',
    targetRoot: 'target-root',
    dryRun: true,
    translator: {
      async translateMarkdown(markdown) { return markdown; },
    },
    createSourceDocumentReader() {
      return {
        async readMarkdown(token) {
          calls.push(['readMarkdown', token]);
          return '# shared reader source\n';
        },
      };
    },
  });

  const markdown = await translator._fetchSourceMarkdown({
    id: 'rec-source',
    metadata: {
      slug: 'Collections-createCollection',
      token: 'doc-source',
      link: 'https://example.feishu.cn/docx/doc-source',
    },
  });

  assert.equal(markdown, '# shared reader source\n');
  assert.deepEqual(calls, [['readMarkdown', 'doc-source']]);
});

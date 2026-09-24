'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createApprovalEnvelope } = require('../../doc-ops-core/src/approval-guard');
const { WriterGovernance } = require('../../doc-ops-core/src/writer-governance');
const {
  collectRelativeMarkdownLinks,
  resolveRelativeLinks,
  slugResolverFromRecords,
} = require('../src/sdk-doc-sync/markdown-link-resolution');

function loadMarkdownToFeishuWithFetch(mockFetch) {
  const modulePath = require.resolve('../src/markdown-to-feishu');
  const fetchPath = require.resolve('node-fetch');
  const originalFetch = require.cache[fetchPath];
  delete require.cache[modulePath];
  require.cache[fetchPath] = { id: fetchPath, filename: fetchPath, loaded: true, exports: mockFetch };
  const MarkdownToFeishu = require('../src/markdown-to-feishu');
  delete require.cache[modulePath];
  if (originalFetch) require.cache[fetchPath] = originalFetch;
  else delete require.cache[fetchPath];
  return MarkdownToFeishu;
}

function boundGovernance() {
  const governance = new WriterGovernance({ skill: 'api-reference-sync', operation: 'execute' });
  const batchDigest = 'sha256:' + 'b'.repeat(64);
  governance.bindApproval({
    batchDigest,
    actionCount: 1,
    targets: ['doc-1'],
    sideEffects: ['docx.patch'],
    approval: createApprovalEnvelope({
      skill: 'api-reference-sync',
      operation: 'execute',
      batchDigest,
      actionCount: 1,
      targets: ['doc-1'],
      sideEffects: ['docx.patch'],
      decision: 'approved',
    }),
    invariantAttestations: [],
  });
  return governance;
}

const slugMap = {
  'Vector-Search': 'https://zilliverse.feishu.cn/docx/AAA',
  'Collections-DataType': 'https://zilliverse.feishu.cn/docx/BBB',
};
const resolveSlug = (slug) => slugMap[slug] || null;

test('resolver rewrites cross-track, category-prefixed, and same-directory links', () => {
  const out = resolveRelativeLinks(
    [
      'cross [Search](../Vector/Search.md)',
      'prefixed [DataType](Collections/DataType.md)',
      'same dir [DataType](DataType.md)',
    ].join('\n'),
    { resolveSlug, currentCategory: 'Collections' },
  );
  assert.ok(out.includes('[Search](https://zilliverse.feishu.cn/docx/AAA)'));
  assert.ok(out.includes('[DataType](https://zilliverse.feishu.cn/docx/BBB)'));
  assert.equal(out.match(/docx\/BBB/g).length, 2);
});

test('resolver preserves anchors on rewritten links', () => {
  const out = resolveRelativeLinks('[Search](../Vector/Search.md#section)', {
    resolveSlug,
    currentCategory: 'Vector',
  });
  assert.equal(out, '[Search](https://zilliverse.feishu.cn/docx/AAA#section)');
});

test('unresolved links throw RELATIVE_LINK_UNRESOLVED listing every miss', () => {
  try {
    resolveRelativeLinks('[Ghost](Ghost.md) and [Also](../Ghost/Also.md)', {
      resolveSlug,
      currentCategory: 'Collections',
    });
    assert.fail('expected RELATIVE_LINK_UNRESOLVED');
  } catch (error) {
    assert.equal(error.code, 'RELATIVE_LINK_UNRESOLVED');
    assert.deepEqual(error.links, ['Ghost.md', '../Ghost/Also.md']);
  }
});

test('de-link mode degrades unresolved links to their plain text', () => {
  const out = resolveRelativeLinks('before [Ghost](Ghost.md) after', {
    resolveSlug,
    currentCategory: 'Collections',
    onUnresolved: 'de-link',
  });
  assert.equal(out, 'before Ghost after');
});

test('absolute links are left untouched and collected as such', () => {
  const markdown = '[in KB](https://zilliverse.feishu.cn/docx/AAA)';
  assert.deepEqual(
    collectRelativeMarkdownLinks('[in KB](https://zilliverse.feishu.cn/docx/AAA) and [rel](Ghost.md)').map((link) => link.target),
    ['Ghost.md'],
  );
  assert.equal(
    resolveRelativeLinks(markdown, { resolveSlug, currentCategory: 'Collections' }),
    markdown,
  );
});

function blockWithLink(url) {
  return [{
    block_type: 2,
    text: {
      elements: [{ text_run: { content: 'x', text_element_style: { link: { url } } } }],
      style: {},
    },
  }];
}

test('envelope-bound block mutations refuse relative link URLs before any network call', async () => {
  const calls = [];
  const MarkdownToFeishu = loadMarkdownToFeishuWithFetch(async (url, options) => {
    calls.push({ url, options });
    return { async json() { return { code: 0, data: {} }; } };
  });
  const ref = encodeURIComponent('../Vector/Search.md');
  const writer = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: null,
    baseToken: 'base-1',
    governance: boundGovernance(),
  });
  writer.tokenFetcher = { token: async () => { calls.push('token'); return 't'; } };

  await assert.rejects(
    writer.create_blocks({ document_id: 'doc-1', blocks: blockWithLink(ref) }),
    (error) => error.code === 'RELATIVE_LINK_URL_REJECTED' && error.urls.length === 1,
  );
  await assert.rejects(
    writer.patch_document({ document_id: 'doc-1', blocks: blockWithLink('./FunctionChain.md') }),
    (error) => error.code === 'RELATIVE_LINK_URL_REJECTED',
  );
  assert.deepEqual(calls, [], 'rejections must happen before the first network call');
});

test('absolute http(s) link URLs pass the pre-write guard through to the transport', async () => {
  const calls = [];
  const MarkdownToFeishu = loadMarkdownToFeishuWithFetch(async (url, options) => {
    calls.push({ url, options });
    return {
      async json() {
        return { code: 0, data: { items: [], document: { document_id: 'doc-1' } } };
      },
    };
  });
  const writer = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: null,
    baseToken: 'base-1',
    governance: boundGovernance(),
  });
  writer.tokenFetcher = { token: async () => 'tenant-token' };

  await writer.create_blocks({
    document_id: 'doc-1',
    blocks: blockWithLink('https://zilliverse.feishu.cn/docx/AAA'),
    parentBlockId: 'parent-1',
  });
  assert.equal(calls.length > 0, true, 'absolute links must not be blocked');
});

test('slugResolverFromRecords resolves slugs from raw Bitable index records', () => {
  const resolveSlug = slugResolverFromRecords([
    { fields: { Slug: 'Vector-Search', Docs: { text: 'Search', link: 'https://zilliverse.feishu.cn/docx/AAA' } } },
    { fields: { Slug: 'Collections-DataType', Docs: { text: 'DataType', link: 'https://zilliverse.feishu.cn/docx/BBB' } } },
  ]);
  const out = resolveRelativeLinks('[Search](../Vector/Search.md) and [DataType](DataType.md)', {
    resolveSlug,
    currentCategory: 'Collections',
  });
  assert.ok(out.includes('[Search](https://zilliverse.feishu.cn/docx/AAA)'));
  assert.equal(out.match(/docx\/BBB/g).length, 1);
});

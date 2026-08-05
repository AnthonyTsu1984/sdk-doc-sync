'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function loadWithFetch(mockFetch) {
  const modulePath = require.resolve('../src/markdown-to-feishu');
  const fetchPath = require.resolve('node-fetch');
  const originalFetch = require.cache[fetchPath];
  delete require.cache[modulePath];
  require.cache[fetchPath] = {
    id: fetchPath,
    filename: fetchPath,
    loaded: true,
    exports: mockFetch,
  };
  const MarkdownToFeishu = require('../src/markdown-to-feishu');
  delete require.cache[modulePath];
  if (originalFetch) {
    require.cache[fetchPath] = originalFetch;
  } else {
    delete require.cache[fetchPath];
  }
  return MarkdownToFeishu;
}

test('copyDocument copies a drive docx file into the target folder', async () => {
  const calls = [];
  const MarkdownToFeishu = loadWithFetch(async (url, options) => {
    calls.push({ url, options });
    return {
      async json() {
        return {
          code: 0,
          data: {
            file: {
              token: 'new-doc-token',
              url: 'https://zilliverse.feishu.cn/docx/new-doc-token',
              name: 'create_user()',
              type: 'docx',
              parent_token: 'target-folder',
            },
          },
        };
      },
    };
  });
  const previousHost = process.env.FEISHU_HOST;
  process.env.FEISHU_HOST = 'https://zilliverse.feishu.cn';

  const writer = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null });
  writer.tokenFetcher = { token: async () => 'tenant-token' };

  const result = await writer.copyDocument({
    sourceDocumentToken: 'old-doc-token',
    title: 'create_user()',
    folderToken: 'target-folder',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://zilliverse.feishu.cn/open-apis/drive/v1/files/old-doc-token/copy');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tenant-token');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    name: 'create_user()',
    type: 'docx',
    folder_token: 'target-folder',
  });
  assert.deepEqual(result, {
    token: 'new-doc-token',
    documentToken: 'new-doc-token',
    url: 'https://zilliverse.feishu.cn/docx/new-doc-token',
    title: 'create_user()',
    type: 'docx',
    folderToken: 'target-folder',
  });

  if (previousHost === undefined) {
    delete process.env.FEISHU_HOST;
  } else {
    process.env.FEISHU_HOST = previousHost;
  }
});

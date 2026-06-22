const test = require('node:test');
const assert = require('node:assert/strict');
const { checkLocalizationLinks, extractMarkdownLinks, extractMentionDocs } = require('../src/localization-link-check');

test('extractMarkdownLinks finds markdown and bare links', () => {
  const links = extractMarkdownLinks('See [ok](https://example.com/a) and https://example.com/b.');
  assert.deepEqual(links.map(link => link.url), ['https://example.com/a', 'https://example.com/b']);
});

test('extractMentionDocs finds mention_doc references', () => {
  const mentions = extractMentionDocs('<!-- feishu-block: mention_doc https://zilliverse.feishu.cn/docx/AbCd -->');
  assert.equal(mentions[0].type, 'mention_doc');
  assert.match(mentions[0].url, /feishu/);
});

test('checkLocalizationLinks reports broken mention_doc and external links', async () => {
  const records = [{ metadata: { title: 'Doc', link: 'doc-main' } }];
  const markdownByDoc = {
    'doc-main': '<!-- mention_doc docx_missing -->\nSee [bad](https://bad.example/link)',
  };
  const report = await checkLocalizationLinks({
    records,
    config: { surfaces: { localization: { linkCheck: { enabled: true, checkMentionDoc: true, checkExternalLinks: true } } } },
    fetchDocMarkdown: async (doc) => {
      if (!markdownByDoc[doc]) throw new Error('not found');
      return markdownByDoc[doc];
    },
    verifyHttpLink: async () => ({ ok: false, status: 404 }),
  });
  assert.equal(report.summary.brokenMentionDocs, 1);
  assert.equal(report.summary.brokenLinks, 1);
});

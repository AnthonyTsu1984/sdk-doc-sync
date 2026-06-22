const test = require('node:test');
const assert = require('node:assert/strict');
const { diffLocalizationRecords } = require('../src/localization-diff');
const { renderMarkdownReport } = require('../src/report-renderer');

function record(slug, title, modified, extra = {}) {
  return {
    id: `${slug}-id`,
    metadata: {
      slug,
      title,
      link: `https://example.com/${slug}`,
      type: 'Doc',
      last_modified: modified,
      deprecate_since: extra.deprecate_since || '',
    },
  };
}

test('diffLocalizationRecords classifies NEW UPDATE SKIP ORPHAN', () => {
  const source = [
    record('new-doc', 'New Doc', '2026-06-22'),
    record('changed-doc', 'Changed Doc', '2026-06-22'),
    record('same-doc', 'Same Doc', '2026-06-01'),
  ];
  const target = [
    record('changed-doc', 'Changed Doc', '2026-06-01'),
    record('same-doc', 'Same Doc', '2026-06-01'),
    record('old-doc', 'Old Doc', '2026-05-01'),
  ];
  const result = diffLocalizationRecords(source, target);
  assert.equal(result.summary.NEW, 1);
  assert.equal(result.summary.UPDATE, 1);
  assert.equal(result.summary.SKIP, 1);
  assert.equal(result.summary.ORPHAN, 1);
});

test('diffLocalizationRecords diffs mapped table pairs independently', () => {
  const result = diffLocalizationRecords({
    tableResults: [
      {
        sourceTableId: 'src_a',
        targetTableId: 'tgt_a',
        sourceRecords: [record('same-slug', 'A Source', '2026-06-22')],
        targetRecords: [],
      },
      {
        sourceTableId: 'src_b',
        targetTableId: 'tgt_b',
        sourceRecords: [],
        targetRecords: [record('same-slug', 'B Target', '2026-06-22')],
      },
    ],
  });
  assert.equal(result.summary.NEW, 1);
  assert.equal(result.summary.ORPHAN, 1);
});

test('renderMarkdownReport includes actionable items and link findings', () => {
  const source = [record('new-doc', 'New Doc', '2026-06-22')];
  const result = diffLocalizationRecords(source, []);
  const report = renderMarkdownReport({
    task: { id: 'task-1', createdAt: '2026-06-22T00:00:00Z' },
    ...result,
    linkReport: {
      summary: { brokenLinks: 1, brokenMentionDocs: 1 },
      findings: [{ type: 'broken_link', title: 'New Doc', target: 'https://bad.example', status: 404 }],
    },
  });
  assert.match(report, /NEW/);
  assert.match(report, /new-doc/);
  assert.match(report, /Broken links: 1/);
  assert.match(report, /https:\/\/bad\.example/);
});

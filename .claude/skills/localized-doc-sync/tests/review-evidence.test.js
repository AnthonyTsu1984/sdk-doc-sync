'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MODULE_PATH = path.resolve(__dirname, '../src/review-evidence.js');

test('review findings authorize correction only with same-unit evidence and locale-contract compliance', () => {
  assert.equal(fs.existsSync(MODULE_PATH), true, 'review-evidence.js must implement correction authorization');
  const { parseAndAuthorizeReview } = require(MODULE_PATH);
  const sourceUnits = [
    { id: 'unit:1', text: 'Compaction plans merge sealed segments.' },
    { id: 'unit:2', text: 'Use the compact() API.' },
  ];
  const draftUnits = [
    { id: 'unit:1', text: 'Compaction 计划会合并已封存的 Segment。' },
    { id: 'unit:2', text: '使用 compact() API。' },
  ];
  const review = JSON.stringify({
    pass: false,
    issues: [
      {
        severity: 'medium',
        type: 'accuracy_mistranslation',
        location: 'unit:2',
        source_quote: 'compact() API',
        draft_quote: 'compact() API',
        comment: 'API identifiers are unchanged, so this allegation has no differing evidence.',
      },
      {
        severity: 'medium',
        type: 'terminology',
        location: 'unit:1',
        source_quote: 'Compaction plans',
        draft_quote: 'Compaction 计划',
        comment: 'Translate Compaction as 压实.',
      },
      {
        severity: 'low',
        type: 'locale_style',
        location: 'unit:1',
        source_quote: 'merge sealed segments',
        draft_quote: '合并已封存的 Segment',
        comment: 'Use 合并密封 Segment for the documented style.',
      },
    ],
  });
  const localeContract = {
    mandatoryTerms: [{ source: 'Compaction', target: 'Compaction', caseSensitive: true }],
    forbiddenTranslations: [{ source: 'Compaction', targets: ['压实', '压缩'] }],
  };

  const result = parseAndAuthorizeReview(review, { sourceUnits, draftUnits, localeContract });
  assert.deepEqual(result.authorizedUnitIds, ['unit:1']);
  assert.equal(result.correctionAuthorized, true);
  assert.equal(result.effectivePass, false);
  assert.equal(result.authorizedIssues.length, 1);
  assert.equal(result.authorizedIssues[0].comment, 'Use 合并密封 Segment for the documented style.');
  assert.equal(result.unsupportedIssues.length, 2);
  assert.match(result.unsupportedIssues.map((entry) => entry.reason).join('\n'), /identical|locale contract/i);
});

test('review response uses an exact schema and contiguous quotes', () => {
  assert.equal(fs.existsSync(MODULE_PATH), true, 'review-evidence.js must implement correction authorization');
  const { parseAndAuthorizeReview } = require(MODULE_PATH);
  const context = {
    sourceUnits: [{ id: 'unit:1', text: 'Create a Collection.' }],
    draftUnits: [{ id: 'unit:1', text: '创建 Collection。' }],
    localeContract: { mandatoryTerms: [], forbiddenTranslations: [] },
  };
  assert.throws(
    () => parseAndAuthorizeReview(JSON.stringify({ pass: false, issues: [], summary: 'extra' }), context),
    /exact schema/i,
  );
  const result = parseAndAuthorizeReview(JSON.stringify({
    pass: false,
    issues: [{
      severity: 'high', type: 'accuracy_omission', location: 'unit:1',
      source_quote: 'not present', draft_quote: '创建', comment: 'Missing content.',
    }],
  }), context);
  assert.equal(result.authorizedIssues.length, 0);
  assert.equal(result.correctionAuthorized, false);
  assert.equal(result.effectivePass, true);
  assert.match(result.unsupportedIssues[0].reason, /contiguous source quote/i);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { TranslationReceiptStore, classifyTranslationDrift } = require('../src/translation-state');

const A = 'sha256:' + 'a'.repeat(64);
const B = 'sha256:' + 'b'.repeat(64);
const C = 'sha256:' + 'c'.repeat(64);

test('translation receipts drive four-way drift without Bitable date fields', () => {
  const receipt = { englishSourceDigest: A, chineseTargetDigest: B };
  assert.equal(classifyTranslationDrift({ englishSourceDigest: A, chineseTargetDigest: B, receipt }), 'NOOP');
  assert.equal(classifyTranslationDrift({ englishSourceDigest: C, chineseTargetDigest: B, receipt }), 'UPDATE_CONTENT');
  assert.equal(classifyTranslationDrift({ englishSourceDigest: A, chineseTargetDigest: C, receipt }), 'TARGET_LOCAL_EDIT');
  assert.equal(classifyTranslationDrift({ englishSourceDigest: C, chineseTargetDigest: C, receipt }), 'TRANSLATION_DIVERGED');
  assert.equal(classifyTranslationDrift({ englishSourceDigest: A, chineseTargetDigest: B, receipt: null }), 'TRANSLATION_BASELINE_REQUIRED');
});

test('receipt store appends only accepted live-verified canonical lineage', () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'translation-receipts-')), 'receipts.jsonl');
  const store = new TranslationReceiptStore({ filePath });
  const base = {
    schemaVersion: 1,
    translationPairId: 'translation-pair:development:database',
    englishDocumentIdentity: { recordId: 'en' },
    chineseDocumentIdentity: { recordId: 'zh' },
    englishSourceDigest: A,
    chineseTargetDigest: B,
    englishMetaDigest: A,
    chineseMetaDigest: B,
    acceptedExecutionJournalDigest: C,
    acceptedDecisionDigest: A,
  };
  assert.throws(() => store.append(base, { liveVerified: false, accepted: true }), /live verification/i);
  const saved = store.append(base, { liveVerified: true, accepted: true });
  assert.equal(saved.translationPairId, base.translationPairId);
  assert.equal(store.latest(base.translationPairId).acceptedExecutionJournalDigest, C);
});

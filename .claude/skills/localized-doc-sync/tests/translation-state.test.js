'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  TranslationReceiptStore,
  assertTranslationRecoveryCompatible,
  classifyTranslationDrift,
} = require('../src/translation-state');

const A = 'sha256:' + 'a'.repeat(64);
const B = 'sha256:' + 'b'.repeat(64);
const C = 'sha256:' + 'c'.repeat(64);
const D = 'sha256:' + 'd'.repeat(64);

test('translation receipts drive four-way drift without Bitable date fields', () => {
  const receipt = { englishSourceDigest: A, chineseTargetDigest: B, translationContractDigest: D };
  const current = { englishSourceDigest: A, chineseTargetDigest: B, translationContractDigest: D };
  assert.equal(classifyTranslationDrift({ ...current, receipt }), 'NOOP');
  assert.equal(classifyTranslationDrift({ ...current, englishSourceDigest: C, receipt }), 'UPDATE_CONTENT');
  assert.equal(classifyTranslationDrift({ ...current, chineseTargetDigest: C, receipt }), 'TARGET_LOCAL_EDIT');
  assert.equal(classifyTranslationDrift({ ...current, englishSourceDigest: C, chineseTargetDigest: C, receipt }), 'TRANSLATION_DIVERGED');
  assert.equal(classifyTranslationDrift({ ...current, translationContractDigest: C, receipt }), 'TRANSLATION_CONTRACT_STALE');
  assert.equal(classifyTranslationDrift({ ...current, receipt: null }), 'TRANSLATION_BASELINE_REQUIRED');
});

test('receipt store appends only accepted live-verified canonical lineage', () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'translation-receipts-')), 'receipts.jsonl');
  const store = new TranslationReceiptStore({ filePath });
  const base = {
    schemaVersion: 2,
    translationPairId: 'translation-pair:development:database',
    englishDocumentIdentity: { recordId: 'en' },
    chineseDocumentIdentity: { recordId: 'zh' },
    englishSourceDigest: A,
    chineseTargetDigest: B,
    englishMetaDigest: A,
    chineseMetaDigest: B,
    acceptedExecutionJournalDigest: C,
    acceptedDecisionDigest: A,
    sourceRevision: 'rev-en-1',
    targetRevision: 'rev-zh-1',
    semanticUnitsDigest: C,
    translationContractDigest: D,
    promptContractDigest: D,
    translatorAdapterVersion: 'feishu-doc-translator@1',
    model: 'gpt-test',
  };
  assert.throws(() => store.append(base, { liveVerified: false, accepted: true }), /live verification/i);
  assert.throws(
    () => store.append({ ...base, schemaVersion: 1 }, { liveVerified: true, accepted: true }),
    /schema v2/i,
  );
  const saved = store.append(base, { liveVerified: true, accepted: true });
  assert.equal(saved.translationPairId, base.translationPairId);
  assert.equal(store.latest(base.translationPairId).acceptedExecutionJournalDigest, C);
  assert.equal(assertTranslationRecoveryCompatible({ receipt: saved, expected: saved }), true);
  assert.throws(
    () => assertTranslationRecoveryCompatible({
      receipt: saved,
      expected: { ...saved, translationContractDigest: C },
    }),
    /translationContractDigest/i,
  );
  assert.throws(
    () => assertTranslationRecoveryCompatible({
      receipt: { ...saved, englishSourceDigest: C },
      expected: saved,
    }),
    /receipt digest/i,
  );
});

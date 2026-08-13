'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalStringify, canonicalize } = require('../../doc-ops-core/src/canonical-json');
const { digestSemantic } = require('../../doc-ops-core/src/digest');

const RECEIPT_IDENTITY_FIELDS = Object.freeze([
  'translationPairId', 'englishDocumentIdentity', 'chineseDocumentIdentity',
  'englishSourceDigest', 'chineseTargetDigest', 'englishMetaDigest', 'chineseMetaDigest',
  'acceptedExecutionJournalDigest', 'acceptedDecisionDigest',
  'sourceRevision', 'targetRevision', 'semanticUnitsDigest', 'translationContractDigest',
  'promptContractDigest', 'translatorAdapterVersion', 'model',
]);

function classifyTranslationDrift({ englishSourceDigest, chineseTargetDigest, translationContractDigest, receipt }) {
  if (!receipt) return 'TRANSLATION_BASELINE_REQUIRED';
  if (!translationContractDigest || translationContractDigest !== receipt.translationContractDigest) return 'TRANSLATION_CONTRACT_STALE';
  const englishChanged = englishSourceDigest !== receipt.englishSourceDigest;
  const chineseChanged = chineseTargetDigest !== receipt.chineseTargetDigest;
  if (!englishChanged && !chineseChanged) return 'NOOP';
  if (englishChanged && !chineseChanged) return 'UPDATE_CONTENT';
  if (!englishChanged && chineseChanged) return 'TARGET_LOCAL_EDIT';
  return 'TRANSLATION_DIVERGED';
}

class TranslationReceiptStore {
  constructor({ filePath }) {
    if (!filePath) throw new TypeError('filePath is required');
    this.filePath = path.resolve(filePath);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.receipts = this.read();
  }

  read() {
    if (!fs.existsSync(this.filePath)) return [];
    const text = fs.readFileSync(this.filePath, 'utf8').trim();
    return text ? text.split('\n').map((line) => JSON.parse(line)) : [];
  }

  latest(translationPairId) {
    return [...this.receipts].reverse().find((receipt) => receipt.translationPairId === translationPairId) || null;
  }

  append(receipt, { liveVerified, accepted }) {
    if (liveVerified !== true) throw new Error('Translation receipt requires live verification');
    if (accepted !== true) throw new Error('Translation receipt requires accepted decision');
    if (receipt?.schemaVersion !== 2) throw new Error('Translation receipt must be schema v2 before append');
    for (const field of RECEIPT_IDENTITY_FIELDS) if (!receipt?.[field]) throw new Error(`Translation receipt requires ${field}`);
    const { receiptDigest: ignoredReceiptDigest, ...receiptInput } = receipt;
    const semantic = canonicalize(receiptInput);
    const normalized = { ...semantic, receiptDigest: digestSemantic(semantic) };
    const fd = fs.openSync(this.filePath, 'a');
    try { fs.writeSync(fd, canonicalStringify(normalized)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    this.receipts.push(normalized);
    return normalized;
  }
}

function assertTranslationRecoveryCompatible({ receipt, expected }) {
  if (receipt?.schemaVersion !== 2) throw new Error('Translation recovery requires a schema v2 receipt');
  if (!receipt.receiptDigest) throw new Error('Translation recovery requires receipt digest');
  const { receiptDigest, ...semanticInput } = receipt;
  if (digestSemantic(canonicalize(semanticInput)) !== receiptDigest) {
    throw new Error('Translation recovery receipt digest is invalid');
  }
  if (expected?.schemaVersion !== 2) throw new Error('Translation recovery expected identity must be schema v2');
  for (const field of RECEIPT_IDENTITY_FIELDS) {
    if (digestSemantic(receipt[field]) !== digestSemantic(expected[field])) {
      throw new Error(`Translation recovery identity mismatch: ${field}`);
    }
  }
  return true;
}

module.exports = {
  TranslationReceiptStore,
  assertTranslationRecoveryCompatible,
  classifyTranslationDrift,
};

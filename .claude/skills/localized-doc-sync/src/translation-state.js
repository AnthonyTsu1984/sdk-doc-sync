'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalStringify, canonicalize } = require('../../doc-ops-core/src/canonical-json');
const { digestSemantic } = require('../../doc-ops-core/src/digest');

function classifyTranslationDrift({ englishSourceDigest, chineseTargetDigest, receipt }) {
  if (!receipt) return 'TRANSLATION_BASELINE_REQUIRED';
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
    const required = [
      'translationPairId', 'englishDocumentIdentity', 'chineseDocumentIdentity',
      'englishSourceDigest', 'chineseTargetDigest', 'englishMetaDigest', 'chineseMetaDigest',
      'acceptedExecutionJournalDigest', 'acceptedDecisionDigest',
    ];
    for (const field of required) if (!receipt?.[field]) throw new Error(`Translation receipt requires ${field}`);
    const semantic = canonicalize({ ...receipt, schemaVersion: 1 });
    const normalized = { ...semantic, receiptDigest: digestSemantic(semantic) };
    const fd = fs.openSync(this.filePath, 'a');
    try { fs.writeSync(fd, canonicalStringify(normalized)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    this.receipts.push(normalized);
    return normalized;
  }
}

module.exports = { TranslationReceiptStore, classifyTranslationDrift };

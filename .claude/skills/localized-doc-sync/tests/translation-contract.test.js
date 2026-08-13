'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MODULE_PATH = path.join(ROOT, 'src/translation-contract.js');

test('translation contract digest binds prompts, locale policy, audience, product profile, and adapter version', () => {
  assert.equal(fs.existsSync(MODULE_PATH), true, 'translation-contract.js must build the runtime contract identity');
  const { loadTranslationContract, validateLocaleContractUnits } = require(MODULE_PATH);
  assert.equal(typeof validateLocaleContractUnits, 'function', 'locale contract must have deterministic unit validation');
  const formal = loadTranslationContract({
    skillRoot: ROOT,
    locale: 'zh-CN',
    audienceProfile: 'formal-guide',
    productProfile: 'china-saas',
    translatorAdapterVersion: 'feishu-doc-translator@1',
  });
  const tool = loadTranslationContract({
    skillRoot: ROOT,
    locale: 'zh-CN',
    audienceProfile: 'developer-tool',
    productProfile: 'china-saas',
    translatorAdapterVersion: 'feishu-doc-translator@1',
  });
  assert.match(formal.contractDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(formal.translationContractDigest, formal.contractDigest);
  assert.match(formal.promptContractDigest, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(formal.contractDigest, tool.contractDigest);
  assert.equal(formal.localeContract.audienceProfiles['formal-guide'].readerPronoun, '您');
  assert.equal(tool.localeContract.audienceProfiles['developer-tool'].readerPronoun, '你');
  assert.ok(formal.prompts.translation.includes('<semantic_units>'));
  assert.ok(formal.prompts.review.includes('contiguous'));
  assert.ok(formal.prompts.correction.includes('authorized'));

  const issues = validateLocaleContractUnits(
    [{ id: 'unit:1', text: 'Compaction plans enable compression.' }],
    [{ id: 'unit:1', text: '压实计划会启用压缩。' }],
    formal.localeContract,
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].unitId, 'unit:1');
  assert.match(issues[0].message, /Compaction/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const FeishuDocTranslator = require('../../api-reference-sync/src/feishu-doc-translator');
const ClaudeTranslator = require('../../api-reference-sync/src/feishu-doc-translator/translators/claude-translator');
const { parseArgs, buildTranslatorOptions } = require('../../api-reference-sync/bin/feishu-doc-translator');
const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { loadTranslationContract } = require('../src/translation-contract');
const { buildLocalizationDryRun } = require('../src/translator-adapter');

const SKILL_ROOT = path.resolve(__dirname, '..');

function record({ id, token, modified }) {
  return {
    id,
    parent: null,
    metadata: {
      title: 'Configure Compaction',
      link: `https://example.feishu.cn/wiki/${token}`,
      slug: 'configure-compaction',
      token,
      type: 'Document',
      last_modified: modified,
      revision: id === 'source-record' ? 'rev-en-2' : 'rev-zh-1',
    },
  };
}

test('npm translate dry-run produces a contract-bound semantic-unit preview without Feishu writes', async () => {
  const sourceRecord = record({ id: 'source-record', token: 'doc-en', modified: '2026-08-07' });
  const targetRecord = record({ id: 'target-record', token: 'doc-zh', modified: '2026-08-01' });
  const sourceMarkdown = '# Configure Compaction\n\nUse `compact()` before deployment.\n';
  const targetMarkdown = '# 配置 Compaction\n\n在部署前使用 `compact()`。\n';
  const adapterVersion = 'feishu-doc-translator@contract-test';
  const contract = loadTranslationContract({
    skillRoot: SKILL_ROOT,
    locale: 'zh-CN',
    audienceProfile: 'formal-guide',
    productProfile: 'china-saas',
    translatorAdapterVersion: adapterVersion,
  });
  const calls = [];
  let reviewCalls = 0;

  const translator = new FeishuDocTranslator({
    sourceBitable: 'source-base',
    targetBitable: 'target-base',
    sourceTableId: 'source-table',
    targetTableId: 'target-table',
    sourceRoot: 'source-root',
    targetRoot: 'target-root',
    sourceLang: 'en',
    targetLang: 'zh-CN',
    dryRun: true,
    localizationMode: true,
    localizationSkillRoot: SKILL_ROOT,
    audienceProfile: 'formal-guide',
    productProfile: 'china-saas',
    translatorAdapterVersion: adapterVersion,
    sourceDocumentReader: {
      async readMarkdown(value) {
        calls.push(['read-source', value.id]);
        return sourceMarkdown;
      },
    },
    targetDocumentReader: {
      async readMarkdown(value) {
        calls.push(['read-target', value.id]);
        return targetMarkdown;
      },
    },
    translationReceiptStore: {
      latest(translationPairId) {
        calls.push(['receipt', translationPairId]);
        return {
          schemaVersion: 2,
          translationPairId,
          englishSourceDigest: digestSemantic('# Configure Compaction\n'),
          chineseTargetDigest: digestSemantic(targetMarkdown),
          translationContractDigest: contract.translationContractDigest,
        };
      },
    },
    translator: {
      model: 'contract-test-model',
      async translateMarkdown() {
        throw new Error('whole-document translation must not be used in localization contract mode');
      },
      async translateSemanticUnits({ units, translationContractDigest, promptContractDigest }) {
        calls.push(['translate-units', units.map((unit) => unit.id)]);
        assert.equal(translationContractDigest, contract.translationContractDigest);
        assert.equal(promptContractDigest, contract.promptContractDigest);
        return {
          translations: units.map((unit) => ({
            id: unit.id,
            text: unit.text
              .replace('Configure', '配置')
              .replace('Use', '请使用')
              .replace('before deployment.', '后再部署。'),
          })),
        };
      },
      async reviewSemanticUnits({ sourceUnits, draftUnits }) {
        reviewCalls += 1;
        const sourceUnit = sourceUnits.find((unit) => unit.text.includes('Use'));
        const draftUnit = draftUnits.find((unit) => unit.id === sourceUnit.id);
        calls.push(['review-units', sourceUnits.map((unit) => unit.id)]);
        if (reviewCalls > 1) return JSON.stringify({ pass: true, issues: [] });
        return JSON.stringify({
          pass: false,
          issues: [{
            severity: 'low',
            type: 'locale_style',
            location: sourceUnit.id,
            source_quote: 'Use',
            draft_quote: '请使用',
            comment: 'Use direct procedural wording without the added politeness marker.',
          }],
        });
      },
      async correctSemanticUnits({ authorizedUnitIds, units }) {
        calls.push(['correct-units', authorizedUnitIds]);
        assert.equal(units.length, 1);
        assert.deepEqual(authorizedUnitIds, [units[0].id]);
        return {
          corrections: [{ id: units[0].id, text: units[0].text.replace('请使用', '使用') }],
        };
      },
    },
  });
  translator.sourceReader = { async listRecords() { return [sourceRecord]; } };
  translator.targetReader = { async listRecords() { return [targetRecord]; } };
  translator.targetWriter = {
    async createRecord() { calls.push(['WRITE-record-create']); },
    async updateRecord() { calls.push(['WRITE-record-update']); },
  };
  translator.targetWriter_md = {
    async push_markdown() { calls.push(['WRITE-doc-create']); },
    async update_document() { calls.push(['WRITE-doc-update']); },
  };

  const result = await translator.run();

  assert.equal(result.localizationMode, true);
  assert.equal(result.localizationActions.length, 1);
  const action = result.localizationActions[0];
  assert.equal(action.code, 'UPDATE_CONTENT');
  assert.equal(action.disposition, 'PROPOSED');
  assert.equal(action.translationPairId, 'translation-pair:configure-compaction');
  assert.equal(action.sourceRevision, 'rev-en-2');
  assert.equal(action.targetRevision, 'rev-zh-1');
  assert.equal(action.sourceContentDigest, digestSemantic(sourceMarkdown));
  assert.equal(action.targetContentDigest, digestSemantic(targetMarkdown));
  assert.equal(action.translationContractDigest, contract.translationContractDigest);
  assert.equal(action.promptContractDigest, contract.promptContractDigest);
  assert.match(action.semanticUnitsDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(action.translatorAdapterVersion, adapterVersion);
  assert.equal(action.model, 'contract-test-model');
  assert.equal(action.sourceDocumentIdentity.recordId, 'source-record');
  assert.equal(action.targetDocumentIdentity.recordId, 'target-record');
  assert.match(action.candidateMarkdown, /^# 配置 Compaction$/m);
  assert.match(action.candidateMarkdown, /使用 `compact\(\)` 后再部署。/);
  assert.equal(action.reviewEvidence.initial.correctionAuthorized, true);
  assert.equal(action.reviewEvidence.initial.authorizedIssues.length, 1);
  assert.equal(action.reviewEvidence.initial.authorizedUnitIds.length, 1);
  assert.equal(action.reviewEvidence.final.effectivePass, true);
  assert.equal(result.localizationBatch.skill, 'localized-doc-sync');
  assert.equal(result.localizationBatch.operation, 'sync');
  assert.match(result.localizationBatch.batchDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.localizationBatch.actions.length, 1);
  const batchAction = result.localizationBatch.actions[0];
  assert.equal(batchAction.actionId, 'translation-pair:configure-compaction:content');
  assert.equal(batchAction.target, 'feishu-document:doc-zh');
  assert.equal(batchAction.state, 'UPDATE_CONTENT');
  assert.deepEqual(batchAction.sourceDocumentIdentity, action.sourceDocumentIdentity);
  assert.deepEqual(batchAction.targetDocumentIdentity, action.targetDocumentIdentity);
  assert.equal(batchAction.sourceRevision, action.sourceRevision);
  assert.equal(batchAction.targetRevision, action.targetRevision);
  assert.equal(batchAction.sourceContentDigest, action.sourceContentDigest);
  assert.equal(batchAction.targetContentDigest, action.targetContentDigest);
  assert.equal(batchAction.candidateContentDigest, digestSemantic(action.candidateMarkdown));
  assert.equal(batchAction.semanticUnitsDigest, action.semanticUnitsDigest);
  assert.equal(batchAction.translationContractDigest, action.translationContractDigest);
  assert.equal(batchAction.promptContractDigest, action.promptContractDigest);
  assert.equal(batchAction.translatorAdapterVersion, action.translatorAdapterVersion);
  assert.equal(batchAction.model, action.model);
  assert.deepEqual(calls.filter(([name]) => name.startsWith('WRITE-')), []);
  assert.deepEqual(calls.slice(0, 3), [
    ['read-source', 'source-record'],
    ['read-target', 'target-record'],
    ['receipt', 'translation-pair:configure-compaction'],
  ]);
  assert.deepEqual(calls.slice(3).map(([name]) => name), ['translate-units', 'review-units', 'correct-units', 'review-units']);
});

test('npm translate CLI exposes localization contract mode only as an explicit dry-run path', () => {
  const args = parseArgs([
    'node', 'feishu-doc-translator',
    '--source-bitable', 'source-base',
    '--target-bitable', 'target-base',
    '--source-table', 'source-table',
    '--target-table', 'target-table',
    '--source-root', 'source-root',
    '--target-root', 'target-root',
    '--source-lang', 'en',
    '--target-lang', 'zh-CN',
    '--localization-contract',
    '--audience-profile', 'formal-guide',
    '--product-profile', 'china-saas',
    '--translator-adapter-version', 'feishu-doc-translator@2',
    '--translation-receipts', '/tmp/translation-receipts.jsonl',
    '--auto-approve',
    '--dry-run',
  ]);
  const receiptStore = { latest() { return null; } };
  const options = buildTranslatorOptions(args, {
    localizationSkillRoot: SKILL_ROOT,
    createTranslationReceiptStore(filePath) {
      assert.equal(filePath, '/tmp/translation-receipts.jsonl');
      return receiptStore;
    },
  });

  assert.equal(options.localizationMode, true);
  assert.equal(options.dryRun, true);
  assert.equal(options.localizationSkillRoot, SKILL_ROOT);
  assert.equal(options.audienceProfile, 'formal-guide');
  assert.equal(options.productProfile, 'china-saas');
  assert.equal(options.translatorAdapterVersion, 'feishu-doc-translator@2');
  assert.equal(options.translationReceiptStore, receiptStore);
  assert.throws(
    () => buildTranslatorOptions({ ...args, dryRun: false }, { localizationSkillRoot: SKILL_ROOT }),
    /localization contract mode is dry-run only/i,
  );
});

test('default Claude translator sends semantic units under the localization contract prompt', async () => {
  const translator = Object.create(ClaudeTranslator.prototype);
  translator.model = 'claude-contract-test';
  let request = null;
  translator.client = {
    messages: {
      async create(value) {
        request = value;
        return {
          content: [{
            text: JSON.stringify({
              translations: [{ id: 'pair.unit.0001', text: '配置 Compaction' }],
            }),
          }],
        };
      },
    },
  };

  const result = await translator.translateSemanticUnits({
    sourceContent: '# Configure Compaction\n',
    units: [{ id: 'pair.unit.0001', kind: 'heading', text: 'Configure Compaction' }],
    localeContract: { locale: 'zh-CN', mandatoryTerms: [{ source: 'Compaction', target: 'Compaction' }] },
    audienceProfile: 'formal-guide',
    productProfile: 'china-saas',
    translationContractDigest: `sha256:${'a'.repeat(64)}`,
    promptContractDigest: `sha256:${'b'.repeat(64)}`,
    prompts: { translation: 'TRANSLATE ONLY SEMANTIC UNITS' },
  });

  assert.deepEqual(result, {
    translations: [{ id: 'pair.unit.0001', text: '配置 Compaction' }],
  });
  assert.equal(request.model, 'claude-contract-test');
  assert.match(request.messages[0].content, /TRANSLATE ONLY SEMANTIC UNITS/);
  assert.match(request.messages[0].content, /<document_context>/);
  assert.match(request.messages[0].content, /<semantic_units>/);
  assert.match(request.messages[0].content, /formal-guide/);
  assert.match(request.messages[0].content, /china-saas/);
  assert.doesNotMatch(request.messages[0].content, /whole-document translation/i);
});

test('default Claude translator exposes evidence review and authorized correction prompts', async () => {
  const translator = Object.create(ClaudeTranslator.prototype);
  translator.model = 'claude-contract-test';
  const requests = [];
  translator.client = {
    messages: {
      async create(value) {
        requests.push(value);
        if (value.messages[0].content.includes('REVIEW STRICTLY')) {
          return { content: [{ text: '{"pass":true,"issues":[]}' }] };
        }
        return { content: [{ text: '{"corrections":[{"id":"pair.unit.0001","text":"配置 Compaction"}]}' }] };
      },
    },
  };
  const shared = {
    sourceUnits: [{ id: 'pair.unit.0001', kind: 'heading', text: 'Configure Compaction' }],
    units: [{ id: 'pair.unit.0001', kind: 'heading', text: '配置 Compaction' }],
    draftUnits: [{ id: 'pair.unit.0001', kind: 'heading', text: '配置 Compaction' }],
    localeContract: { locale: 'zh-CN' },
    audienceProfile: 'formal-guide',
    productProfile: 'china-saas',
    translationContractDigest: `sha256:${'a'.repeat(64)}`,
    promptContractDigest: `sha256:${'b'.repeat(64)}`,
  };

  const review = await translator.reviewSemanticUnits({ ...shared, prompt: 'REVIEW STRICTLY' });
  const correction = await translator.correctSemanticUnits({
    ...shared,
    prompt: 'CORRECT AUTHORIZED',
    authorizedUnitIds: ['pair.unit.0001'],
    authorizedIssues: [{ location: 'pair.unit.0001', comment: 'Remove added meaning.' }],
  });

  assert.equal(review, '{"pass":true,"issues":[]}');
  assert.deepEqual(correction, {
    corrections: [{ id: 'pair.unit.0001', text: '配置 Compaction' }],
  });
  assert.match(requests[0].messages[0].content, /<source_units>/);
  assert.match(requests[0].messages[0].content, /<draft_units>/);
  assert.match(requests[1].messages[0].content, /<authorized_unit_ids>/);
  assert.match(requests[1].messages[0].content, /<authorized_issues>/);
});

test('localization dry-run blocks TARGET_LOCAL_EDIT without invoking translation', async () => {
  const sourceRecord = record({ id: 'source-record', token: 'doc-en', modified: '2026-08-07' });
  const targetRecord = record({ id: 'target-record', token: 'doc-zh', modified: '2026-08-01' });
  const sourceMarkdown = '# Configure Compaction\n';
  const targetMarkdown = '# 人工调整后的 Compaction 配置\n';
  const adapterVersion = 'feishu-doc-translator@contract-test';
  const contract = loadTranslationContract({
    skillRoot: SKILL_ROOT,
    locale: 'zh-CN',
    audienceProfile: 'formal-guide',
    productProfile: 'china-saas',
    translatorAdapterVersion: adapterVersion,
  });
  let translateCalls = 0;

  const actions = await buildLocalizationDryRun({
    legacyActions: [{ type: 'UPDATE', slug: 'configure-compaction', source: sourceRecord, target: targetRecord }],
    sourceBitable: 'source-base',
    targetBitable: 'target-base',
    sourceTableId: 'source-table',
    targetTableId: 'target-table',
    sourceRoot: 'source-root',
    targetRoot: 'target-root',
    locale: 'zh-CN',
    audienceProfile: 'formal-guide',
    productProfile: 'china-saas',
    translatorAdapterVersion: adapterVersion,
    localizationSkillRoot: SKILL_ROOT,
    translator: {
      model: 'contract-test-model',
      async translateSemanticUnits() { translateCalls += 1; },
    },
    translationReceiptStore: {
      latest(translationPairId) {
        return {
          schemaVersion: 2,
          translationPairId,
          englishSourceDigest: digestSemantic(sourceMarkdown),
          chineseTargetDigest: digestSemantic('# 配置 Compaction\n'),
          translationContractDigest: contract.translationContractDigest,
        };
      },
    },
    readSourceMarkdown: async () => sourceMarkdown,
    readTargetMarkdown: async () => targetMarkdown,
  });

  assert.equal(actions.length, 1);
  assert.equal(actions[0].code, 'TARGET_LOCAL_EDIT');
  assert.equal(actions[0].disposition, 'BLOCKED');
  assert.equal(actions[0].candidateMarkdown, null);
  assert.deepEqual(actions[0].blockingReasons, ['TARGET_LOCAL_EDIT']);
  assert.deepEqual(actions[0].driftEvidence, {
    sourceChanged: false,
    targetChanged: true,
    contractStale: false,
  });
  assert.equal(translateCalls, 0);
});

test('localization snapshots fall back to exact content digests when provider revisions are unavailable', async () => {
  const sourceRecord = record({ id: 'source-record', token: 'doc-en', modified: '2026-08-07' });
  const targetRecord = record({ id: 'target-record', token: 'doc-zh', modified: '2026-08-01' });
  delete sourceRecord.metadata.revision;
  delete targetRecord.metadata.revision;
  const sourceMarkdown = '# Configure Compaction\n';
  const targetMarkdown = '# 人工调整后的 Compaction 配置\n';
  const adapterVersion = 'feishu-doc-translator@contract-test';
  const contract = loadTranslationContract({
    skillRoot: SKILL_ROOT,
    locale: 'zh-CN',
    audienceProfile: 'formal-guide',
    productProfile: 'china-saas',
    translatorAdapterVersion: adapterVersion,
  });

  const actions = await buildLocalizationDryRun({
    legacyActions: [{ type: 'UPDATE', slug: 'configure-compaction', source: sourceRecord, target: targetRecord }],
    sourceBitable: 'source-base', targetBitable: 'target-base',
    sourceTableId: 'source-table', targetTableId: 'target-table',
    sourceRoot: 'source-root', targetRoot: 'target-root',
    locale: 'zh-CN', audienceProfile: 'formal-guide', productProfile: 'china-saas',
    translatorAdapterVersion: adapterVersion, localizationSkillRoot: SKILL_ROOT,
    translator: { model: 'unused', async translateSemanticUnits() { throw new Error('must stay blocked'); } },
    translationReceiptStore: {
      latest(translationPairId) {
        return {
          schemaVersion: 2,
          translationPairId,
          englishSourceDigest: digestSemantic(sourceMarkdown),
          chineseTargetDigest: digestSemantic('# 配置 Compaction\n'),
          translationContractDigest: contract.translationContractDigest,
        };
      },
    },
    readSourceMarkdown: async () => sourceMarkdown,
    readTargetMarkdown: async () => targetMarkdown,
  });

  assert.equal(actions[0].sourceRevision, `content:${digestSemantic(sourceMarkdown)}`);
  assert.equal(actions[0].targetRevision, `content:${digestSemantic(targetMarkdown)}`);
  assert.equal(actions[0].sourceRevisionKind, 'content-digest');
  assert.equal(actions[0].targetRevisionKind, 'content-digest');
});

test('localization dry-run blocks TRANSLATION_DIVERGED when source and target both changed', async () => {
  const sourceRecord = record({ id: 'source-record', token: 'doc-en', modified: '2026-08-07' });
  const targetRecord = record({ id: 'target-record', token: 'doc-zh', modified: '2026-08-01' });
  const sourceMarkdown = '# Configure Compaction safely\n';
  const targetMarkdown = '# 人工调整后的 Compaction 配置\n';
  const adapterVersion = 'feishu-doc-translator@contract-test';
  const contract = loadTranslationContract({
    skillRoot: SKILL_ROOT,
    locale: 'zh-CN',
    audienceProfile: 'formal-guide',
    productProfile: 'china-saas',
    translatorAdapterVersion: adapterVersion,
  });
  let translateCalls = 0;

  const actions = await buildLocalizationDryRun({
    legacyActions: [{ type: 'UPDATE', slug: 'configure-compaction', source: sourceRecord, target: targetRecord }],
    sourceBitable: 'source-base', targetBitable: 'target-base',
    sourceTableId: 'source-table', targetTableId: 'target-table',
    sourceRoot: 'source-root', targetRoot: 'target-root',
    locale: 'zh-CN', audienceProfile: 'formal-guide', productProfile: 'china-saas',
    translatorAdapterVersion: adapterVersion, localizationSkillRoot: SKILL_ROOT,
    translator: {
      model: 'contract-test-model',
      async translateSemanticUnits() { translateCalls += 1; },
    },
    translationReceiptStore: {
      latest(translationPairId) {
        return {
          schemaVersion: 2,
          translationPairId,
          englishSourceDigest: digestSemantic('# Configure Compaction\n'),
          chineseTargetDigest: digestSemantic('# 配置 Compaction\n'),
          translationContractDigest: contract.translationContractDigest,
        };
      },
    },
    readSourceMarkdown: async () => sourceMarkdown,
    readTargetMarkdown: async () => targetMarkdown,
  });

  assert.equal(actions[0].code, 'TRANSLATION_DIVERGED');
  assert.equal(actions[0].disposition, 'BLOCKED');
  assert.equal(actions[0].candidateMarkdown, null);
  assert.deepEqual(actions[0].blockingReasons, ['TRANSLATION_DIVERGED']);
  assert.deepEqual(actions[0].driftEvidence, {
    sourceChanged: true,
    targetChanged: true,
    contractStale: false,
  });
  assert.equal(translateCalls, 0);
});

test('localization dry-run retranslates TRANSLATION_CONTRACT_STALE and invalidates recovery', async () => {
  const sourceRecord = record({ id: 'source-record', token: 'doc-en', modified: '2026-08-07' });
  const targetRecord = record({ id: 'target-record', token: 'doc-zh', modified: '2026-08-01' });
  const sourceMarkdown = '# Configure Compaction\n';
  const targetMarkdown = '# 配置 Compaction\n';
  const adapterVersion = 'feishu-doc-translator@contract-test';
  let translateCalls = 0;

  const actions = await buildLocalizationDryRun({
    legacyActions: [{ type: 'UPDATE', slug: 'configure-compaction', source: sourceRecord, target: targetRecord }],
    sourceBitable: 'source-base', targetBitable: 'target-base',
    sourceTableId: 'source-table', targetTableId: 'target-table',
    sourceRoot: 'source-root', targetRoot: 'target-root',
    locale: 'zh-CN', audienceProfile: 'formal-guide', productProfile: 'china-saas',
    translatorAdapterVersion: adapterVersion, localizationSkillRoot: SKILL_ROOT,
    translator: {
      model: 'contract-test-model',
      async translateSemanticUnits({ units }) {
        translateCalls += 1;
        return {
          translations: units.map((unit) => ({ id: unit.id, text: unit.text.replace('Configure', '配置') })),
        };
      },
      async reviewSemanticUnits() {
        return JSON.stringify({ pass: true, issues: [] });
      },
    },
    translationReceiptStore: {
      latest(translationPairId) {
        return {
          schemaVersion: 2,
          receiptDigest: `sha256:${'e'.repeat(64)}`,
          translationPairId,
          englishSourceDigest: digestSemantic(sourceMarkdown),
          chineseTargetDigest: digestSemantic(targetMarkdown),
          translationContractDigest: `sha256:${'d'.repeat(64)}`,
        };
      },
    },
    readSourceMarkdown: async () => sourceMarkdown,
    readTargetMarkdown: async () => targetMarkdown,
  });

  assert.equal(actions[0].code, 'TRANSLATION_CONTRACT_STALE');
  assert.equal(actions[0].disposition, 'PROPOSED');
  assert.equal(actions[0].recoveryAllowed, false);
  assert.deepEqual(actions[0].invalidationReasons, ['TRANSLATION_CONTRACT_STALE']);
  assert.equal(actions[0].invalidatedReceiptDigest, `sha256:${'e'.repeat(64)}`);
  assert.match(actions[0].candidateMarkdown, /^# 配置 Compaction$/m);
  assert.equal(translateCalls, 1);
});

test('stale contract plus target local edits becomes a blocked divergence', async () => {
  const sourceRecord = record({ id: 'source-record', token: 'doc-en', modified: '2026-08-07' });
  const targetRecord = record({ id: 'target-record', token: 'doc-zh', modified: '2026-08-01' });
  const sourceMarkdown = '# Configure Compaction\n';
  const targetMarkdown = '# 人工调整后的 Compaction 配置\n';
  let translateCalls = 0;

  const actions = await buildLocalizationDryRun({
    legacyActions: [{ type: 'UPDATE', slug: 'configure-compaction', source: sourceRecord, target: targetRecord }],
    sourceBitable: 'source-base', targetBitable: 'target-base',
    sourceTableId: 'source-table', targetTableId: 'target-table',
    sourceRoot: 'source-root', targetRoot: 'target-root',
    locale: 'zh-CN', audienceProfile: 'formal-guide', productProfile: 'china-saas',
    translatorAdapterVersion: 'feishu-doc-translator@contract-test', localizationSkillRoot: SKILL_ROOT,
    translator: {
      model: 'contract-test-model',
      async translateSemanticUnits() { translateCalls += 1; },
    },
    translationReceiptStore: {
      latest(translationPairId) {
        return {
          schemaVersion: 2,
          receiptDigest: `sha256:${'e'.repeat(64)}`,
          translationPairId,
          englishSourceDigest: digestSemantic(sourceMarkdown),
          chineseTargetDigest: digestSemantic('# 配置 Compaction\n'),
          translationContractDigest: `sha256:${'d'.repeat(64)}`,
        };
      },
    },
    readSourceMarkdown: async () => sourceMarkdown,
    readTargetMarkdown: async () => targetMarkdown,
  });

  assert.equal(actions[0].code, 'TRANSLATION_DIVERGED');
  assert.equal(actions[0].disposition, 'BLOCKED');
  assert.deepEqual(actions[0].blockingReasons, ['TRANSLATION_CONTRACT_STALE', 'TARGET_LOCAL_EDIT']);
  assert.equal(actions[0].recoveryAllowed, false);
  assert.equal(actions[0].invalidatedReceiptDigest, `sha256:${'e'.repeat(64)}`);
  assert.deepEqual(actions[0].driftEvidence, {
    sourceChanged: false,
    targetChanged: true,
    contractStale: true,
  });
  assert.equal(actions[0].candidateMarkdown, null);
  assert.equal(translateCalls, 0);
});
